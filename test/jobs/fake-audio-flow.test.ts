import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { InboundMessageRecord } from '../../src/db/repositories/inbound-messages.js';
import type { PendingSenderLabelRecord } from '../../src/db/repositories/pending-sender-labels.js';
import type { SummaryJobRecord } from '../../src/db/repositories/summary-jobs.js';
import type { InsertSummaryInput, SummaryRecord } from '../../src/db/repositories/summaries.js';
import type { InsertTranscriptInput, TranscriptRecord } from '../../src/db/repositories/transcripts.js';
import type { UserRecord } from '../../src/db/repositories/users.js';
import { createAudioIntakeHandler } from '../../src/jobs/audio-intake.js';
import type { AudioJobContext } from '../../src/jobs/job-store.js';
import { createAudioMessageProcessor } from '../../src/jobs/process-audio-message.js';
import { parseWhatsAppWebhookPayload } from '../../src/routes/whatsapp-payload.js';
import { FakeSummarizer } from '../../src/services/summarizer.js';
import { FakeTranscriber } from '../../src/services/transcriber.js';
import type { SendTextInput } from '../../src/services/whatsapp-client.js';
import { createInMemoryOutboundMessages } from '../helpers/in-memory-outbound.js';

const now = new Date('2026-08-03T12:00:00.000Z');

function makeUser(): UserRecord {
  return {
    id: 'user-1',
    whatsappUserId: '31612345678',
    displayName: 'Laura',
    createdAt: now,
    lastSeenAt: now,
    isBlocked: false
  };
}

function makeJob(inboundMessageId: string): SummaryJobRecord {
  return {
    id: 'job-1',
    inboundMessageId,
    status: 'queued',
    attemptCount: 0,
    maxAttempts: 3,
    nextAttemptAt: now,
    lockedAt: null,
    lockedBy: null,
    startedAt: null,
    completedAt: null,
    downloadLatencyMs: null,
    transcriptionLatencyMs: null,
    summaryLatencyMs: null,
    totalLatencyMs: null,
    errorCode: null,
    errorDetailSanitized: null,
    createdAt: now,
    updatedAt: now
  };
}

function makeSummary(input: InsertSummaryInput): SummaryRecord {
  return {
    id: 'summary-1',
    userId: input.userId,
    inboundMessageId: input.inboundMessageId,
    referenceCode: input.referenceCode ?? null,
    fromLabel: input.fromLabel,
    fromLabelConfidence: input.fromLabelConfidence,
    oneSentenceSummary: input.oneSentenceSummary,
    shortSummary: input.shortSummary,
    importantPoints: input.importantPoints,
    questionsOrRequests: input.questionsOrRequests,
    datesOrCommitments: input.datesOrCommitments,
    replyNeeded: input.replyNeeded,
    listeningRecommendation: input.listeningRecommendation,
    createdAt: now,
    expiresAt: input.expiresAt,
    deletedAt: null
  };
}

function makeTranscript(input: InsertTranscriptInput): TranscriptRecord {
  return {
    id: 'transcript-1',
    userId: input.userId,
    inboundMessageId: input.inboundMessageId,
    summaryId: input.summaryId,
    text: input.text,
    characterCount: input.text.length,
    createdAt: now,
    expiresAt: input.expiresAt,
    deletedAt: null
  };
}

describe('fake audio flow', () => {
  it('turns a fake audio webhook into one fake summary reply idempotently', async () => {
    const payload = JSON.parse(await readFile('test/fixtures/whatsapp-audio-webhook.json', 'utf8'));
    const event = parseWhatsAppWebhookPayload(payload).find((candidate) => candidate.kind === 'message');
    if (!event || event.kind !== 'message') {
      throw new Error('Expected fake audio fixture to include a message event');
    }

    const user = makeUser();
    const inboundByWhatsAppId = new Map<string, InboundMessageRecord>();
    const jobsByInboundId = new Map<string, SummaryJobRecord>();
    let storedSummary: SummaryRecord | null = null;
    let storedTranscript: TranscriptRecord | null = null;
    let pendingLabel: PendingSenderLabelRecord | null = null;
    const outboundMessages = createInMemoryOutboundMessages();
    const sentMessages: SendTextInput[] = [];
    const whatsapp = {
      sendText: vi.fn(async (input: SendTextInput) => {
        sentMessages.push(input);
        return { whatsappMessageId: `wamid.out.${sentMessages.length}` };
      })
    };

    const intake = createAudioIntakeHandler({
      config: {
        MAX_DAILY_MESSAGES_PER_USER: 10,
        AUDIO_LABEL_GRACE_PERIOD_MS: 4000,
        QSTASH_DRAIN_DELAY_SECONDS: 2,
        QSTASH_DRAIN_MAX_JOBS: 1
      },
      whatsapp,
      users: {
        upsertFromWhatsApp: vi.fn(async () => user)
      },
      inboundMessages: {
        insertIfNew: vi.fn(async (input) => {
          const existing = inboundByWhatsAppId.get(input.whatsappMessageId);
          if (existing) {
            return {
              record: existing,
              inserted: false
            };
          }

          const inbound: InboundMessageRecord = {
            id: 'inbound-1',
            whatsappMessageId: input.whatsappMessageId,
            userId: input.userId,
            messageType: input.messageType,
            receivedAt: now,
            whatsappTimestamp: input.whatsappTimestamp ?? null,
            mediaId: input.mediaId ?? null,
            mimeType: input.mimeType ?? null,
            isVoiceNote: input.isVoiceNote ?? null,
            textBody: input.textBody ?? null,
            status: input.status ?? 'received',
            errorCode: null
          };
          inboundByWhatsAppId.set(input.whatsappMessageId, inbound);

          return {
            record: inbound,
            inserted: true
          };
        }),
        updateStatus: vi.fn(async (id, status, errorCode) => {
          const inbound = [...inboundByWhatsAppId.values()].find((candidate) => candidate.id === id);
          if (!inbound) {
            throw new Error(`Inbound ${id} not found`);
          }

          inbound.status = status;
          inbound.errorCode = errorCode ?? null;
          return inbound;
        }),
        countAcceptedAudioForUserSince: vi.fn(async () =>
          [...inboundByWhatsAppId.values()].filter((candidate) =>
            ['queued', 'processing', 'completed'].includes(candidate.status)
          ).length
        )
      },
      summaryJobs: {
        createForInboundMessage: vi.fn(async (inboundMessageId, nextAttemptAt) => {
          const existing = jobsByInboundId.get(inboundMessageId);
          if (existing) {
            return existing;
          }

          const job = makeJob(inboundMessageId);
          job.nextAttemptAt = nextAttemptAt ?? now;
          jobsByInboundId.set(inboundMessageId, job);
          return job;
        })
      },
      outboundMessages,
      now: () => now
    });

    const processor = createAudioMessageProcessor({
      config: {
        SUMMARY_RETENTION_DAYS: 30,
        TRANSCRIPT_RETENTION_DAYS: 30
      },
      jobStore: {
        findJobContext: vi.fn(async (jobId): Promise<AudioJobContext | null> => {
          const job = [...jobsByInboundId.values()].find((candidate) => candidate.id === jobId);
          const inbound = job
            ? [...inboundByWhatsAppId.values()].find(
                (candidate) => candidate.id === job.inboundMessageId
              )
            : null;

          return job && inbound
            ? {
                job,
                inboundMessage: inbound,
                user
              }
            : null;
        }),
        markCompleted: vi.fn(async ({ jobId }) => {
          const job = [...jobsByInboundId.values()].find((candidate) => candidate.id === jobId);
          if (job) {
            job.status = 'completed';
            job.completedAt = now;
          }
        })
      },
      pendingSenderLabels: {
        consumeLatestForInboundMessage: vi.fn(async (_userId, inboundMessageId) => {
          if (pendingLabel?.targetInboundMessageId && pendingLabel.targetInboundMessageId !== inboundMessageId) {
            return null;
          }
          const label = pendingLabel;
          pendingLabel = null;
          return label;
        })
      },
      summaries: {
        insertIfNew: vi.fn(async (input) => {
          if (storedSummary) {
            return {
              record: storedSummary,
              inserted: false
            };
          }

          storedSummary = makeSummary(input);
          return {
            record: storedSummary,
            inserted: true
          };
        })
      },
      transcripts: {
        insertIfNew: vi.fn(async (input) => {
          if (storedTranscript) {
            return {
              record: storedTranscript,
              inserted: false
            };
          }

          storedTranscript = makeTranscript(input);
          return {
            record: storedTranscript,
            inserted: true
          };
        })
      },
      outboundMessages,
      whatsapp,
      transcriber: new FakeTranscriber(),
      summarizer: new FakeSummarizer(),
      now: () => now
    });

    const intakeResult = await intake.handleMessage(event.message);
    expect(intakeResult).toMatchObject({
      handled: true,
      queued: true
    });

    await processor.processAudioMessage('job-1');
    await intake.handleMessage(event.message);
    await processor.processAudioMessage('job-1');

    expect(jobsByInboundId).toHaveLength(1);
    expect(sentMessages).toHaveLength(3);
    expect(sentMessages[0]?.body).toBe('Got it — working a little voice-note magic ✨');
    expect(sentMessages[1]?.body).toContain('🎧 Voice note from unknown sender');
    expect(sentMessages[2]?.body).toContain('💬 Copy-paste reply');
  });
});
