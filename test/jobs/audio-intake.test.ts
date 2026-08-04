import { describe, expect, it, vi } from 'vitest';
import {
  createAudioIntakeHandler,
  dailyLimitMessage,
  processingAckMessage
} from '../../src/jobs/audio-intake.js';
import type { InboundMessageRecord } from '../../src/db/repositories/inbound-messages.js';
import type { SummaryJobRecord } from '../../src/db/repositories/summary-jobs.js';
import type { UserRecord } from '../../src/db/repositories/users.js';
import type { ParsedWhatsAppMessage } from '../../src/routes/whatsapp-payload.js';
import type { SendTextInput } from '../../src/services/whatsapp-client.js';
import { createInMemoryOutboundMessages } from '../helpers/in-memory-outbound.js';

const now = new Date('2026-08-03T12:00:00.000Z');

function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'user-1',
    whatsappUserId: '15551234567',
    displayName: 'Laura',
    createdAt: now,
    lastSeenAt: now,
    isBlocked: false,
    ...overrides
  };
}

function makeInbound(overrides: Partial<InboundMessageRecord> = {}): InboundMessageRecord {
  return {
    id: 'inbound-1',
    whatsappMessageId: 'wamid.audio-123',
    userId: 'user-1',
    messageType: 'audio',
    receivedAt: now,
    whatsappTimestamp: now,
    mediaId: 'media_audio_123',
    mimeType: 'audio/ogg; codecs=opus',
    isVoiceNote: true,
    textBody: null,
    status: 'received',
    errorCode: null,
    ...overrides
  };
}

function makeJob(): SummaryJobRecord {
  return {
    id: 'job-1',
    inboundMessageId: 'inbound-1',
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

function makeAudioMessage(): ParsedWhatsAppMessage {
  return {
    whatsappMessageId: 'wamid.audio-123',
    from: '15551234567',
    displayName: 'Laura',
    timestamp: now,
    messageType: 'audio',
    textBody: null,
    audio: {
      mediaId: 'media_audio_123',
      mimeType: 'audio/ogg; codecs=opus',
      isVoiceNote: true
    }
  };
}

function makeDependencies(overrides: {
  user?: UserRecord;
  inserted?: boolean;
  acceptedCount?: number;
} = {}) {
  const sentMessages: SendTextInput[] = [];
  const inbound = makeInbound();
  const job = makeJob();
  const dependencies = {
    config: {
      MAX_DAILY_MESSAGES_PER_USER: 10,
      AUDIO_LABEL_GRACE_PERIOD_MS: 4000,
      QSTASH_DRAIN_DELAY_SECONDS: 2,
      QSTASH_DRAIN_MAX_JOBS: 1
    },
    whatsapp: {
      sendText: vi.fn(async (input: SendTextInput) => {
        sentMessages.push(input);
        return { whatsappMessageId: `wamid.out.${sentMessages.length}` };
      })
    },
    users: {
      upsertFromWhatsApp: vi.fn(async () => overrides.user ?? makeUser())
    },
    inboundMessages: {
      insertIfNew: vi.fn(async () => ({
        record: inbound,
        inserted: overrides.inserted ?? true
      })),
      updateStatus: vi.fn(async (_id: string, status: InboundMessageRecord['status'], errorCode?: string | null) =>
        makeInbound({
          status,
          errorCode: errorCode ?? null
        })
      ),
      countAcceptedAudioForUserSince: vi.fn(async () => overrides.acceptedCount ?? 0)
    },
    summaryJobs: {
      createForInboundMessage: vi.fn(async () => job)
    },
    outboundMessages: createInMemoryOutboundMessages(),
    now: () => now
  };

  return {
    dependencies,
    sentMessages,
    inbound,
    job
  };
}

describe('createAudioIntakeHandler', () => {
  it('queues new audio messages and sends one processing acknowledgement', async () => {
    const { dependencies, sentMessages, inbound, job } = makeDependencies();
    const handler = createAudioIntakeHandler(dependencies);

    await expect(handler.handleMessage(makeAudioMessage())).resolves.toEqual({
      handled: true,
      queued: true,
      inboundMessage: makeInbound({ status: 'queued' }),
      job
    });

    expect(dependencies.inboundMessages.insertIfNew).toHaveBeenCalledWith({
      whatsappMessageId: 'wamid.audio-123',
      userId: 'user-1',
      messageType: 'audio',
      whatsappTimestamp: now,
      mediaId: 'media_audio_123',
      mimeType: 'audio/ogg; codecs=opus',
      isVoiceNote: true,
      status: 'received'
    });
    expect(dependencies.summaryJobs.createForInboundMessage).toHaveBeenCalledWith(
      inbound.id,
      new Date(now.getTime() + 4000)
    );
    expect(sentMessages).toEqual([
      {
        to: '15551234567',
        body: processingAckMessage,
        contextMessageId: 'wamid.audio-123'
      }
    ]);
  });

  it('schedules a delayed job drain after queueing audio', async () => {
    const { dependencies, inbound } = makeDependencies();
    const jobDrainTrigger = {
      scheduleDrain: vi.fn(async () => ({
        scheduled: true as const,
        mode: 'qstash' as const,
        messageId: 'msg-1',
        deduplicated: false
      }))
    };
    const handler = createAudioIntakeHandler({
      ...dependencies,
      jobDrainTrigger
    });

    await handler.handleMessage(makeAudioMessage());

    expect(jobDrainTrigger.scheduleDrain).toHaveBeenCalledWith({
      inboundMessageId: inbound.id,
      delaySeconds: 2,
      maxJobs: 1
    });
  });

  it('logs but does not fail intake when scheduling a drain fails', async () => {
    const { dependencies } = makeDependencies();
    const error = new Error('qstash unavailable');
    const onJobDrainTriggerError = vi.fn();
    const handler = createAudioIntakeHandler({
      ...dependencies,
      jobDrainTrigger: {
        scheduleDrain: vi.fn(async () => {
          throw error;
        })
      },
      onJobDrainTriggerError
    });

    await expect(handler.handleMessage(makeAudioMessage())).resolves.toMatchObject({
      handled: true,
      queued: true
    });
    expect(onJobDrainTriggerError).toHaveBeenCalledWith(error, {
      inboundMessageId: 'inbound-1'
    });
  });

  it('does not enqueue duplicate audio messages', async () => {
    const { dependencies, sentMessages, inbound } = makeDependencies({ inserted: false });
    const handler = createAudioIntakeHandler(dependencies);

    await expect(handler.handleMessage(makeAudioMessage())).resolves.toEqual({
      handled: true,
      queued: false,
      reason: 'duplicate',
      inboundMessage: inbound
    });

    expect(dependencies.summaryJobs.createForInboundMessage).not.toHaveBeenCalled();
    expect(sentMessages).toEqual([]);
  });

  it('sends one daily-limit reply without queuing work', async () => {
    const { dependencies, sentMessages } = makeDependencies({ acceptedCount: 10 });
    const handler = createAudioIntakeHandler(dependencies);

    await expect(handler.handleMessage(makeAudioMessage())).resolves.toMatchObject({
      handled: true,
      queued: false,
      reason: 'daily_limit'
    });

    expect(dependencies.summaryJobs.createForInboundMessage).not.toHaveBeenCalled();
    expect(sentMessages[0]?.body).toBe(dailyLimitMessage(10));
  });
});
