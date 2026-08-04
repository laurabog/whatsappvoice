# Voiceicorn Worker Reliability Implementation Plan

## Goal

Make Voiceicorn reliable enough for friend beta.

After a user sends a WhatsApp voice note and receives the processing acknowledgement, the system must always do one of two things:

1. Send the summary and optional copy-paste reply.
2. Send a clear friendly failure message.

The system should not silently leave jobs queued.

## Current Problem

The current production flow is:

```text
WhatsApp webhook
-> API stores inbound message
-> API queues summary job in Postgres
-> API sends "Got it"
-> background worker timer inside API process should poll Postgres
-> worker processes job
```

This worked for MVP, but it is fragile in production. We have already seen jobs reach Postgres and remain stuck as:

```text
job_status = queued
attempt_count = 0
started_at = null
```

That means:

- WhatsApp reached us.
- The API was alive.
- The job was queued.
- OpenAI was not reached.
- The worker did not claim the job.

This is the worst user-facing failure mode because the user receives "Got it" but never receives a summary.

## Architecture Decision

Use Prisma Compute for the HTTP API, but stop relying on an in-process background timer for job processing.

Recommended architecture:

```text
WhatsApp
-> Prisma Compute API
-> store inbound message + queued job in Postgres
-> send "Got it"
-> schedule delayed job trigger
-> QStash calls protected internal drain endpoint
-> drain endpoint claims due jobs from Postgres
-> download audio
-> transcribe
-> summarize
-> send summary + optional copy-paste reply
```

## Why This Architecture

### Keep Prisma Compute For The API

Prisma Compute is already working well for:

- public HTTPS health checks
- WhatsApp webhook verification
- signed webhook POST requests
- command replies
- storing inbound jobs
- sending immediate processing acknowledgements

### Add QStash For Reliable Job Triggers

QStash is a better match for this stage than an always-on worker host because it provides:

- delayed HTTP delivery
- retries
- dead-letter/log visibility
- enough free-tier capacity for friend beta
- no need to run another always-on server yet

### Keep Postgres As The Source Of Truth

Postgres remains the queue source of truth:

- one row per accepted audio job
- transactional job claiming
- retry and terminal failure state
- idempotent outbound replies
- inspectable production state

QStash does not replace our job table. It only wakes the app reliably.

## Main Tradeoff

This adds one external service: QStash.

In exchange, we remove the fragile behavior where queued jobs depend on an API-process timer that may not run reliably in hosted production.

For friend beta, this is the right tradeoff.

## Phase P0: Internal Job Drain Endpoint

Add:

```text
POST /internal/jobs/drain
```

### Authentication

Protect the endpoint with:

```text
Authorization: Bearer INTERNAL_JOB_TOKEN
```

If the token is missing or wrong:

```http
401 Unauthorized
```

Response:

```json
{
  "ok": false,
  "error": "unauthorized"
}
```

### Behavior

The endpoint should:

1. Verify the internal token.
2. Claim due queued or retryable jobs from Postgres.
3. Process up to `maxJobs`.
4. Return a compact structured result.

Default:

```text
maxJobs = 1
```

Hard cap:

```text
maxJobs = 3
```

Example success response:

```json
{
  "ok": true,
  "processed": 1,
  "completed": 1,
  "failed": 0,
  "empty": false
}
```

Example empty response:

```json
{
  "ok": true,
  "processed": 0,
  "completed": 0,
  "failed": 0,
  "empty": true
}
```

### Logging

Log:

- drain request received
- number of jobs attempted
- job IDs
- final job statuses
- latency totals
- errors using sanitized details only

Do not log:

- transcript text
- summary text
- WhatsApp access tokens
- OpenAI API keys
- full phone numbers
- raw audio URLs

## Phase P1: QStash Trigger

Add a small scheduler service:

```ts
scheduleJobDrain({ delaySeconds: number }): Promise<void>
```

Production behavior:

```text
POST https://qstash.upstash.io/v2/publish/{PUBLIC_APP_URL}/internal/jobs/drain
```

With headers:

```text
Authorization: Bearer QSTASH_TOKEN
Content-Type: application/json
Upstash-Delay: 2s
Upstash-Retries: 3
Upstash-Timeout: 120s
Upstash-Deduplication-Id: audio-drain:{inboundMessageId}
Upstash-Label: voiceicorn,audio-drain
Upstash-Redact-Fields: body,header[Authorization]
Upstash-Forward-Authorization: Bearer INTERNAL_JOB_TOKEN
```

The request body sent to the drain endpoint can stay minimal:

```json
{
  "source": "audio-intake",
  "maxJobs": 1
}
```

QStash must call our drain endpoint with:

```text
Authorization: Bearer INTERNAL_JOB_TOKEN
```

Important: `Authorization: Bearer QSTASH_TOKEN` authenticates our publish request to QStash. It does not authenticate the delivery request to our app. For app auth, use `Upstash-Forward-Authorization`, which QStash forwards to our endpoint as `Authorization`.

## Phase P2: Audio Intake Changes

Current behavior:

```text
queue job
-> send processing acknowledgement
-> hope background worker timer picks it up
```

New behavior:

```text
queue job
-> send processing acknowledgement
-> schedule delayed QStash drain
```

### Important Rules

The webhook should return `200` after:

- the inbound message is stored
- the job is queued
- the processing acknowledgement is attempted idempotently

If QStash scheduling fails:

- log the failure loudly
- do not create duplicate inbound jobs
- do not expose technical details to the user
- rely on the safety drain as backup once implemented

## Phase P3: Keep In-Process Worker During Rollout

Currently `src/api.ts` starts the audio worker runtime.

Keep that enabled until the QStash one-off trigger and safety drain pass production smoke tests.

Rollout default:

```text
RUN_IN_PROCESS_WORKER=true
```

Later production target:

```text
RUN_IN_PROCESS_WORKER=false
```

Keep:

```text
src/worker.ts
npm run dev:worker
npm run start:worker
```

After the QStash path is proven, treat those as local development or emergency tools, not the primary production path.

## Phase P4: User-Facing Failure Message

When a job becomes terminally failed, send one user-friendly WhatsApp message:

```text
I could not finish this one — the audio magic fizzled halfway through. Please try forwarding the voice note again ✨
```

Rules:

- send at most once per inbound audio message
- use outbound idempotency with `replyKind = failure`
- do not reveal OpenAI, WhatsApp, database, or network errors to users
- keep sanitized error detail in the database for debugging

This removes the silent-failure product risk.

## Phase P5: Manual Admin Drain Command

Add:

```bash
npm run admin:drain-jobs
```

Behavior:

- uses production/local `DATABASE_URL`
- processes due jobs through the same job processor
- prints a compact result
- does not print transcript or summary text

This gives us an emergency recovery path without needing the long-running watcher.

Example output:

```text
Processed: 1
Completed: 1
Failed: 0
Remaining queued: 0
```

## Phase P6: Safety Drain

Add a periodic safety trigger in the first reliability deployment:

```text
QStash schedule every 1 minute
-> POST /internal/jobs/drain
```

Purpose:

- recover jobs missed by a one-off trigger failure
- handle transient database/API errors
- reduce manual babysitting

This should use the same protected drain endpoint.

The scheduled payload should include:

```json
{
  "source": "safety-drain",
  "maxJobs": 3,
  "runCleanup": true
}
```

This also preserves retention cleanup after the in-process worker is disabled.

## Phase P7: Latency Improvements

After reliability is fixed, improve speed and perceived responsiveness.

### Reduce Label Grace Period

Current:

```text
AUDIO_LABEL_GRACE_PERIOD_MS=4000
```

Recommended beta value:

```text
AUDIO_LABEL_GRACE_PERIOD_MS=2000
```

Tradeoff:

- faster summaries
- slightly less time for users to send after-note labels like "Eva sent this"

### Add Latency Breakdown

Expose latency in admin/debug output:

```text
queue wait: 2.1s
media download: 1.4s
transcription: 3.8s
summary: 4.9s
total: 12.2s
```

### Add Long-Note Progress Message

Product backlog item:

If a job is still processing after 25 seconds, send:

```text
Still working on this one — longer voice notes take a little more magic ✨
```

Rules:

- send at most once per audio note
- do not send for jobs that already completed
- use outbound idempotency
- likely schedule through QStash

## Environment Variables

Add:

```text
INTERNAL_JOB_TOKEN=...
JOB_TRIGGER_MODE=qstash
PUBLIC_APP_URL=https://kwh33ty8oarfagbfd5cmztwo.fra.prisma.build
QSTASH_TOKEN=...
QSTASH_DRAIN_DELAY_SECONDS=2
QSTASH_DRAIN_MAX_JOBS=1
QSTASH_TIMEOUT_SECONDS=120
RUN_IN_PROCESS_WORKER=true
```

Optional later:

```text
LONG_NOTE_PROGRESS_AFTER_SECONDS=25
SAFETY_DRAIN_INTERVAL_SECONDS=60
```

## Test Plan

### Unit Tests

Add tests for:

- internal drain rejects missing token
- internal drain rejects invalid token
- internal drain returns empty when no jobs are due
- internal drain processes one queued job
- internal drain respects `maxJobs`
- internal drain hard-caps `maxJobs`
- audio intake schedules a drain after queueing audio
- audio intake still sends the processing acknowledgement
- scheduler sends correct QStash URL
- scheduler sends correct delay header
- scheduler sends internal auth correctly
- QStash scheduling failure is logged
- drain endpoint can run retention cleanup
- terminal failed job sends one friendly failure message
- duplicate drain calls do not duplicate summaries
- duplicate drain calls do not duplicate copy-paste replies
- duplicate drain calls do not duplicate failure messages

### Flow Tests

Add fake end-to-end tests:

```text
fake WhatsApp audio webhook
-> inbound row created
-> summary job queued
-> processing ack sent
-> drain endpoint called
-> fake transcript generated
-> fake summary generated
-> summary message sent
-> copy-paste reply sent when needed
-> job completed
```

Duplicate flow:

```text
same webhook arrives twice
-> one inbound row
-> one job
-> one processing ack
-> one summary
```

Retry flow:

```text
drain endpoint called twice
-> first call completes
-> second call returns empty
-> no duplicate WhatsApp messages
```

Failure flow:

```text
processor throws until max attempts
-> job becomes terminal_failed
-> inbound message becomes failed
-> one friendly failure message sent
```

## Verification Commands

Before deployment:

```bash
npm run typecheck
npm test
npm run build
```

After deployment:

```bash
curl -s https://kwh33ty8oarfagbfd5cmztwo.fra.prisma.build/health
```

Production smoke test:

1. Send a short English WhatsApp voice note.
2. Confirm immediate processing acknowledgement arrives.
3. Confirm summary arrives.
4. Confirm DB job status becomes `completed`.
5. Confirm no new jobs are stuck as `queued` with `attempt_count = 0`.

## Deployment Plan

1. Add code and tests.
2. Run local verification.
3. Commit and push to `main`.
4. Add production env vars:
   ```text
   INTERNAL_JOB_TOKEN
   JOB_TRIGGER_MODE
   PUBLIC_APP_URL
   QSTASH_TOKEN
   QSTASH_DRAIN_DELAY_SECONDS
   QSTASH_DRAIN_MAX_JOBS
   RUN_IN_PROCESS_WORKER
   ```
5. Deploy to Prisma Compute.
6. Run health check.
7. Send a real WhatsApp voice-note smoke test.
8. Check latest job state.
9. Invite the next small beta group only after two or three clean production smoke tests.

## What Laura Needs To Provide

To implement the recommended version, Laura needs to create or connect a free Upstash account and provide:

```text
QSTASH_TOKEN
```

The implementation can generate:

```text
INTERNAL_JOB_TOKEN
```

and provide exact commands for adding both to Prisma Compute production env.

## Open Questions For Review

1. Should QStash be the chosen trigger service, or should we move immediately to a separate always-on worker host?
2. Should the drain endpoint process only one job per call, or up to three?
3. Should we reduce the label grace period to 2 seconds immediately?
4. Should the safety drain run every minute from day one?
5. Should the long-note progress message be included in the same build or kept as a follow-up?

## Recommendation

Build P0 through P4 first:

1. Protected internal drain endpoint.
2. QStash delayed trigger after audio intake.
3. Disable in-process worker in production.
4. Friendly terminal failure message.
5. Tests around idempotency and duplicate drain calls.

Then add P5 through P7:

1. Manual admin drain command.
2. Periodic safety drain.
3. Latency improvements.
4. Long-note progress message.

This is the smallest architecture change that directly fixes the current reliability problem while keeping the system understandable and cheap for friend beta.
