# WhatsApp Voice Summary Technical Plan v2

## Product Direction

Build a WhatsApp-only personal beta that lets friends forward long voice notes to one bot number and receive a compact summary back in WhatsApp.

The product should feel like a lightweight contact, not a new app:

1. User forwards a WhatsApp voice note to the bot.
2. Bot immediately confirms it is working.
3. Bot returns a short summary in the same chat.
4. Bot labels the original sender only when the label is user-provided or clearly stated.
5. Bot does not store audio.
6. Bot stores summaries and transcripts for 30 days so the user can request the transcript later.
7. Bot deletes stored summaries and transcripts automatically, and immediately on `DELETE`.

Version 0 is English-only, friend-beta-only, and optimized for getting a real end-to-end loop working quickly.

## Guiding Principle

Keep the system small, but test the risky real-world parts early.

This plan does not add a dashboard, billing, complex admin tooling, public launch workflow, or advanced memory. It only moves a few cheap safety rails earlier:

- Real WhatsApp payload capture before too much fake-local work hardens.
- Inbound and outbound idempotency before real users.
- Rate limits before friend beta.
- Explicit retention and deletion behavior.
- Short-lived transcript access for users who want the full text.
- Conservative sender attribution.

## MVP Scope

### Included

- One WhatsApp Business Cloud API test number first.
- Webhook endpoint for inbound WhatsApp messages.
- Real Meta webhook verification and POST signature verification.
- Audio media retrieval and download from Meta.
- Audio validation and optional normalization.
- English speech-to-text.
- Strict structured summary extraction.
- WhatsApp text replies.
- Transcript retrieval for the user's own recent summaries.
- Basic sender label handling.
- Summary and transcript persistence with 30-day expiry.
- Minimal commands: `HELP`, `DELETE`, `STATUS`, `TRANSCRIPT`.
- Simple logs for failures, latency, and rough cost.

### Excluded

- Native mobile app.
- User dashboard.
- Indefinite transcript history.
- Group monitoring.
- Automatic inbox access.
- Speaker identification by voice.
- Multi-language support.
- Combined summaries across multiple notes.
- Payments.
- Public launch compliance workflow.

## Recommended MVP Stack

### Backend

Use TypeScript with Fastify.

### Runtime Components

- `Fastify`: HTTP API and webhook receiver.
- `Postgres`: users, messages, summaries, transcripts, jobs, outbound idempotency.
- Postgres-backed worker loop for version 0.
- `OpenAI audio transcription`: speech-to-text.
- `OpenAI Responses API`: strict structured summary extraction.
- `Meta WhatsApp Cloud API`: inbound/outbound WhatsApp integration.
- `ffprobe` / `ffmpeg`: duration validation and optional format normalization.
- `pino`: structured logs.
- `Sentry`: later, before wider friend beta.

Redis/BullMQ can be added later if the job volume or retry behavior outgrows a simple Postgres job table. For 10-30 friends, Postgres is enough and avoids extra setup.

## Core UX

### First Use / `HELP`

```text
Forward me an English WhatsApp voice note and I will summarize it.

Tip: send "From Alex" before the note if you want me to label who it came from.

I temporarily process audio with AI transcription and summarization. Audio is deleted after processing. Summaries and transcripts are kept for 30 days, then deleted. Send TRANSCRIPT for the latest transcript, or DELETE to remove saved summaries, transcripts, and labels.
```

### Happy Path

User forwards a voice note.

Immediate reply:

```text
Got it - summarizing this one now.
```

Later reply:

```text
Voice note summary
From: probably Alex

Alex says he is changing jobs and will be in Amsterdam next month. He asks if you are free for dinner on Friday.

Important
- New job
- Amsterdam next month
- Dinner invite for Friday

You may want to reply
- Are you free for dinner Friday?

Listen?
Summary is probably enough.

Reply TRANSCRIPT within 30 days if you want the full transcript.
```

If the sender cannot be identified:

```text
From: unknown sender
```

### Transcript Request

Users can request transcripts for their own recent voice-note summaries.

Version 0 behavior:

- `TRANSCRIPT`: return the transcript for the user's most recent completed summary.
- `TRANSCRIPT latest`: same as `TRANSCRIPT`.
- `TRANSCRIPT 2`: optional later shorthand for the user's second-most-recent completed summary.

For the first MVP, `TRANSCRIPT` for the latest summary is enough. Reference codes are useful once users start sending several notes in a row.

If no transcript is available:

```text
I do not have a transcript available for that voice note anymore.
```

If the transcript is too long for one WhatsApp message, split it into numbered chunks:

```text
Transcript 1/3
...
```

### Unsupported Message

```text
I can summarize voice notes only. Forward me an English WhatsApp audio message.
```

### Failure Message

Use one final failure reply per inbound audio message:

```text
I could not summarize this one cleanly. Could you forward it again?
```

Internal logs can distinguish download, validation, transcription, and summary failures.

## Sender Attribution

Original sender metadata may not be available when a personal voice note is forwarded to a business webhook. The MVP should avoid pretending otherwise.

Resolution order:

1. Explicit label sent immediately before the audio, such as `From Alex`.
2. Explicit label attached to the same audio message, if WhatsApp supports that payload shape.
3. Transcript self-identification only when explicit, displayed as `probably`.
4. `unknown sender`.

Do not identify speakers by voice, phone number, or guessed relationship.

### Pending Sender Labels

Use pending labels, not "most recent label forever."

`pending_sender_labels` fields:

- `id`
- `user_id`
- `label`
- `normalized_label`
- `created_at`
- `expires_at`
- `consumed_at`

Version 0 behavior:

- `From Alex` creates a pending label.
- The next audio message from that user consumes it.
- The pending label expires after 30 minutes.
- If no label exists, use `unknown sender` unless the transcript explicitly self-identifies.

Longer-lived sender memory can wait until after the first beta.

## Retention Policy

Make retention explicit from the start.

- Audio files: deleted immediately after processing, including failure paths.
- Transcript text: stored only after a successful summary, available to the same user for 30 days, then auto-deleted.
- Summaries: stored for 30 days, then auto-deleted.
- Pending sender labels: expire after 30 minutes or after one use.
- Job metadata: stored for 90 days without audio or full raw payload.
- Logs: no audio URLs, access tokens, full transcripts, or full raw payloads.

`DELETE` should immediately remove the user's saved summaries, transcripts, and sender labels. Audio should already be gone.

Transcripts are user-facing stored content, not logs. They should not appear in application logs, Sentry payloads, or raw webhook fixtures.

## Message Processing Flow

### 1. Webhook Verification

Routes:

- `GET /webhooks/whatsapp`: Meta verification challenge.
- `POST /webhooks/whatsapp`: inbound events.

Requirements:

- Verify `hub.verify_token` on `GET` and echo `hub.challenge`.
- Verify `x-hub-signature-256` on `POST` using the raw request body and app secret.
- Return quickly.
- Never run transcription inside the webhook request.
- Ignore or separately record message status events.

### 2. Inbound Parsing

Extract only the fields the app needs:

- WhatsApp message ID.
- Forwarding user's WhatsApp ID.
- Forwarding user's display name, if available.
- Message timestamp.
- Message type.
- Audio media ID.
- Audio MIME type.
- Voice-note flag, if present.
- Text body for commands or sender labels.

Do not store full raw webhook payloads in production by default. During the WhatsApp spike, save anonymized fixtures locally so tests match reality.

### 3. Command Handling

Handle commands before creating audio jobs:

- `HELP`: send usage and privacy note.
- `STATUS`: show today's usage and daily limit.
- `TRANSCRIPT`: send the most recent available transcript for that user.
- `DELETE`: delete saved summaries, transcripts, and sender labels.

Optional before broader beta:

- `STOP`: block future processing for that user.
- `START`: unblock processing.

### 4. Audio Intake

For an audio message:

1. Upsert user.
2. Insert `inbound_messages` row with unique `whatsapp_message_id`.
3. If the inbound message already exists, return success without creating duplicate work.
4. Check daily limit.
5. Create one `summary_jobs` row.
6. Send the processing acknowledgement idempotently.

### 5. Worker Processing

Worker steps:

1. Claim a queued job.
2. Retrieve Meta media URL.
3. Download audio promptly with the WhatsApp access token.
4. Validate byte size, MIME type, duration, and non-empty content.
5. Transcribe with OpenAI.
6. Summarize transcript with strict schema.
7. Resolve final sender label outside the model.
8. Store summary and transcript with matching `expires_at`.
9. Send final WhatsApp reply idempotently.
10. Delete temporary audio in a `finally` path.

If transcription succeeds but summary extraction fails, do not persist the transcript. Store transcripts only for successfully completed summaries that the user can request later.

If the media URL expires before download, send a single failure reply asking the user to forward the audio again.

## Idempotency

Inbound dedupe prevents duplicate jobs. Outbound dedupe prevents duplicate replies.

Required constraints:

- `users.whatsapp_user_id` unique.
- `inbound_messages.whatsapp_message_id` unique.
- `summary_jobs.inbound_message_id` unique.
- `summaries.inbound_message_id` unique.
- `transcripts.inbound_message_id` unique.
- `outbound_messages` unique on `(inbound_message_id, reply_kind)`.

`reply_kind` values:

- `processing_ack`
- `summary`
- `transcript`
- `failure`
- `help`
- `status`
- `delete_confirmation`

Before sending, check whether an outbound row for `inbound_message_id` and `reply_kind` already exists with sent status.

## Audio Validation

Version 0 limits:

- Max size: 16 MB.
- Max duration: 10 minutes for first beta.
- Daily accepted audio jobs per user: 10.

After latency and cost are known, raise max duration to 15 minutes and daily jobs to 20 if it still feels safe.

Validation checks:

- File exists.
- File is not empty.
- MIME type/container is accepted.
- Byte size is within limit.
- Duration is within limit.

Try direct transcription first. If transcription fails because of format/container issues, normalize with `ffmpeg` and retry once.

## Transcription

Use OpenAI transcription with:

- `model`: `gpt-4o-mini-transcribe` by default.
- `language`: `en`.
- `response_format`: `json`.

Store only:

- transcription provider.
- transcription model.
- transcription latency.
- transcript character count.
- token or usage metadata if returned.
- transcript text in the `transcripts` table only after a successful summary.

The transcript text expires after 30 days and is deleted by `DELETE`. It must not be logged or copied into job error details.

## Summary Extraction

The summarizer receives transcript text as untrusted content. Transcript content must never be treated as instructions for the system.

The model should not own the final sender label. It may report explicit self-identification found in the transcript, but the app decides how to display it.

Suggested strict schema:

```json
{
  "one_sentence_summary": "string",
  "short_summary": "string",
  "important_points": [
    {
      "label": "string",
      "evidence": "string",
      "confidence": "low|medium|high"
    }
  ],
  "questions_or_requests": ["string"],
  "dates_or_commitments": ["string"],
  "reply_needed": true,
  "listening_recommendation": "summary_enough|listen_when_you_can|listen_soon",
  "explicit_speaker_self_identification": {
    "name": "string",
    "evidence": "string",
    "confidence": "low|medium|high"
  },
  "uncertainties": ["string"]
}
```

Rules:

- Keep the summary neutral and brief.
- Prefer "nothing major stood out" over invented importance.
- Do not infer medical, financial, relationship, or emotional stakes from tone.
- Do not expose chain-of-thought or model-internal reasoning.
- Use evidence strings for internal validation, but do not include evidence in the user-facing reply unless needed.

## Reply Formatting

The formatter converts structured summary output into a WhatsApp-friendly plain text message.

Rules:

- One final summary reply by default.
- Keep under WhatsApp text limits.
- If too long, split into two messages: main summary, then dates/questions.
- Transcript replies may be split into numbered chunks.
- No markdown tables.
- No full transcript in the summary reply by default.
- No unsupported formatting.

Target:

```text
Voice note summary
From: {from_label}

{short_summary}

Important
- {important_point}

You may want to reply
- {question_or_request}

Listen?
{listening_recommendation}
```

If no important points:

```text
Important
Nothing major stood out.
```

If no reply is needed:

```text
Reply needed
Probably not.
```

## Data Model

### `users`

- `id`
- `whatsapp_user_id`
- `display_name`
- `created_at`
- `last_seen_at`
- `is_blocked`

### `pending_sender_labels`

- `id`
- `user_id`
- `label`
- `normalized_label`
- `created_at`
- `expires_at`
- `consumed_at`

### `inbound_messages`

- `id`
- `whatsapp_message_id`
- `user_id`
- `message_type`
- `received_at`
- `media_id`
- `mime_type`
- `status`
- `error_code`

### `summary_jobs`

- `id`
- `inbound_message_id`
- `status`
- `attempt_count`
- `started_at`
- `completed_at`
- `download_latency_ms`
- `transcription_latency_ms`
- `summary_latency_ms`
- `total_latency_ms`
- `error_code`
- `error_detail_sanitized`

### `summaries`

- `id`
- `user_id`
- `inbound_message_id`
- `from_label`
- `from_label_confidence`
- `one_sentence_summary`
- `short_summary`
- `important_points_json`
- `questions_or_requests_json`
- `dates_or_commitments_json`
- `reply_needed`
- `listening_recommendation`
- `created_at`
- `expires_at`
- `deleted_at`

### `transcripts`

- `id`
- `user_id`
- `inbound_message_id`
- `summary_id`
- `text`
- `character_count`
- `created_at`
- `expires_at`
- `deleted_at`

### `outbound_messages`

- `id`
- `inbound_message_id`
- `user_id`
- `reply_kind`
- `whatsapp_message_id`
- `status`
- `created_at`
- `sent_at`
- `error_code`

## Internal Modules

```text
src/
  app.ts
  config.ts
  routes/
    whatsapp-webhook.ts
  services/
    whatsapp-client.ts
    media-downloader.ts
    audio-validator.ts
    transcriber.ts
    summarizer.ts
    sender-label-resolver.ts
    transcript-retriever.ts
    reply-formatter.ts
    retention-cleanup.ts
  jobs/
    job-store.ts
    worker.ts
    process-audio-message.ts
  db/
    schema.ts
    client.ts
  observability/
    logger.ts
    metrics.ts
```

## Environment Variables

```text
NODE_ENV=
PORT=
DATABASE_URL=

WHATSAPP_VERIFY_TOKEN=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_APP_SECRET=
WHATSAPP_PHONE_NUMBER_ID=

OPENAI_API_KEY=
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
OPENAI_SUMMARY_MODEL=

MAX_AUDIO_BYTES=16777216
MAX_AUDIO_DURATION_SECONDS=600
MAX_DAILY_MESSAGES_PER_USER=10
MAX_TRANSCRIPT_REPLY_CHARS=3500

SUMMARY_RETENTION_DAYS=30
TRANSCRIPT_RETENTION_DAYS=30
JOB_METADATA_RETENTION_DAYS=90
PENDING_LABEL_TTL_MINUTES=30

TEMP_AUDIO_DIR=/tmp/whatsapp-summary-audio
SENTRY_DSN=
```

## Observability

Track:

- Inbound messages per day.
- Accepted audio jobs per day.
- Successful summaries.
- Transcript requests.
- Failures by error code.
- Duplicate inbound webhooks.
- Skipped duplicate outbound replies.
- Median and p95 total latency.
- Transcription latency.
- Summary latency.
- Media download failures.
- Average audio duration.
- Estimated cost per summary.

Do not log:

- Access tokens.
- Full media URLs.
- Full transcripts.
- Full raw webhook payloads.
- Full summaries by default.

## Testing Strategy

### Unit Tests

- Sender label parsing and expiry.
- Summary schema validation.
- Reply formatting.
- Audio validation decisions.
- Rate limit decisions.
- Idempotent outbound guard.
- Transcript lookup permissions and expiry.

### Fixture Tests

- Meta `GET` verification challenge.
- Signed `POST` webhook verification using raw body.
- Real anonymized text webhook fixture.
- Real anonymized audio webhook fixture.
- Duplicate inbound webhook does not create duplicate jobs.

### Integration Tests

- Local sample WhatsApp-like audio file becomes a summary.
- Transcript text is persisted only after successful summary creation.
- `TRANSCRIPT` returns the latest transcript for the same user inside the retention window.
- Expired transcripts are not returned.
- `DELETE` removes saved transcript access.
- Temporary audio is deleted after success.
- Temporary audio is deleted after failure.
- Worker retry does not duplicate final replies.

OpenAI-backed tests should be opt-in through environment variables. Normal `npm test` should run with fake transcriber and fake summarizer.

## Development Phases

### Phase 0: Local Skeleton

Goal: local project can receive fake webhook fixtures and produce fake summary replies.

Tasks:

- Initialize TypeScript project.
- Add Fastify server.
- Add config validation.
- Add Postgres schema/migrations.
- Add simple Postgres-backed job store.
- Add webhook routes.
- Add fake WhatsApp client.
- Add fake transcriber and fake summarizer.
- Add fixture tests.

Exit criteria:

- `npm test` passes.
- Fake audio webhook creates one inbound message and one queued job.
- Worker produces one formatted fake reply.
- Duplicate fake webhook does not create duplicate jobs.

### Phase 0.5: WhatsApp Reality Check

Goal: prove Meta setup and capture real payloads before building too much against guesses.

Tasks:

- Create Meta developer app.
- Add WhatsApp product.
- Configure test phone number.
- Configure HTTPS webhook callback URL.
- Set environment variables.
- Verify webhook challenge.
- Receive a real text message.
- Reply to `HELP` with a real WhatsApp text message.
- Receive a real audio or voice-note webhook.
- Save anonymized text and audio webhook fixtures.
- Check whether forwarded voice notes include original-sender metadata.

Exit criteria:

- Test number receives `HELP` and replies.
- Real audio webhook creates an inbound row with media ID.
- Anonymized fixtures are committed for tests.
- Sender metadata assumption is confirmed or downgraded.

### Phase 1: Local OpenAI Audio Processing

Goal: local worker can process a local WhatsApp-like audio file into a summary.

Tasks:

- Add OpenAI transcription client.
- Add strict structured summarizer.
- Add sender-label resolver.
- Add reply formatter.
- Add audio validation.
- Add opt-in integration test with a small sample audio file.

Exit criteria:

- Local audio file becomes a structured summary.
- User-facing reply is formatted.
- Transcript text is stored with a 30-day expiry only after summary success.
- `TRANSCRIPT` can return the latest transcript locally.
- Temporary audio is deleted.

### Phase 2: Real Meta Media Download

Goal: worker can download real WhatsApp audio media and clean it up.

Tasks:

- Retrieve Meta media URL from media ID.
- Download media with WhatsApp access token.
- Validate media size, MIME type, and duration.
- Run fake or optional real transcription.
- Delete temporary audio after success and failure.
- Handle expired media URLs.

Exit criteria:

- Forwarded voice note from test number downloads locally.
- Temp audio is removed.
- Expired/download failures produce one failure reply.

### Phase 3: Tiny End-to-End Audio MVP

Goal: one real forwarded English voice note returns one real useful summary.

Tasks:

- Wire real media download, transcription, summary, and reply.
- Wire `TRANSCRIPT` for the user's latest completed summary.
- Add outbound idempotency for ack, summary, and failure replies.
- Add daily per-user limit.
- Add summary `expires_at`.
- Add transcript `expires_at`.
- Add retention cleanup job.
- Add retry policy with capped attempts.
- Add single failure reply on terminal failure.

Exit criteria:

- A friend can forward an English voice note and receive a useful summary.
- Bot sends at most one processing ack and one final reply per inbound audio.
- Processing failure does not duplicate replies.
- Audio is not retained.
- Summaries and transcripts expire after 30 days.

### Phase 4: Friend Beta Hardening

Goal: safe enough for 10-30 friends.

Tasks:

- Add `DELETE`.
- Add `STATUS`.
- Add transcript reference codes if users send multiple notes close together.
- Add optional `STOP` / `START`.
- Add Sentry.
- Add admin SQL snippets or a tiny CLI for failed jobs.
- Add deployment runbook.
- Add cost/latency review after first 20-50 notes.
- Consider raising duration limit from 10 to 15 minutes.

Exit criteria:

- 10 friends can test without manual intervention for ordinary cases.
- Failures are visible and recoverable.
- Users can delete saved summaries, transcripts, and labels.
- Users can request transcripts during the 30-day retention window.
- Cost and latency are understood.

## Product Decisions Resolved for MVP

- Unknown sender behavior: use `unknown sender` by default; do not block the summary to ask for a label.
- Sender labels: support `From Alex` before the note using one-use pending labels.
- Multiple notes: summarize each note separately.
- Wait time: always send immediate ack; no progress heartbeats in version 0.
- Retention: summaries and transcripts expire after 30 days; `DELETE` removes saved summaries, transcripts, and labels immediately.
- First deployment: use Meta test number before a real business number.
- Duration limit: start with 10 minutes, revisit after latency/cost measurements.

## Main Risks

### Real WhatsApp Payloads Differ From Assumptions

Mitigation: Phase 0.5 captures real anonymized fixtures before full implementation.

### Original Sender Is Unavailable

Mitigation: use pending user-provided labels and conservative `probably` only when transcript self-identification is explicit.

### Duplicate Webhooks or Worker Retries Send Duplicate Replies

Mitigation: unique inbound message IDs plus outbound idempotency by `inbound_message_id` and `reply_kind`.

### Long Audio Feels Slow

Mitigation: immediate acknowledgement, 10-minute first-beta limit, latency tracking, and later limit adjustment.

### Hallucinated Importance

Mitigation: strict schema, conservative prompt rules, confidence fields, and formatting that allows "nothing major stood out."

### Privacy Expectations Are Unclear

Mitigation: first-use/`HELP` disclosure, immediate audio cleanup, 30-day summary/transcript retention, no transcript logging, and `DELETE`.

## Recommended Next Step

Build Phase 0, but keep it thin.

The first useful milestone is not a perfect backend. It is this loop:

```text
fake audio webhook -> inbound row -> queued job -> fake summary -> one formatted fake reply
```

Immediately after that, do Phase 0.5 and capture real WhatsApp fixtures. That keeps the project moving fast while preventing the local mock version from drifting away from WhatsApp reality.

## References

- Meta WhatsApp Cloud API request collection: https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api
- Meta WhatsApp Cloud API media endpoints: https://www.postman.com/meta/whatsapp-business-platform/folder/13382743-ecb27be5-4d27-4763-bbee-6a8002c04bf3
- WhatsApp Business Messaging Policy: https://www.whatsapp.com/legal/business-policy/
- OpenAI audio transcription API: https://platform.openai.com/docs/api-reference/audio/createTranscription
