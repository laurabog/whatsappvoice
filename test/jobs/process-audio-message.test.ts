import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PendingSenderLabelRecord } from '../../src/db/repositories/pending-sender-labels.js';
import type { InsertSummaryInput, SummaryRecord } from '../../src/db/repositories/summaries.js';
import type { InsertTranscriptInput, TranscriptRecord } from '../../src/db/repositories/transcripts.js';
import type { AudioJobContext } from '../../src/jobs/job-store.js';
import {
  createAudioMessageProcessor,
  type ProcessAudioMessageDependencies
} from '../../src/jobs/process-audio-message.js';
import type { AudioSource } from '../../src/services/media-downloader.js';
import type { SummaryOutput } from '../../src/services/reply-formatter.js';
import { FakeSummarizer, type Summarizer } from '../../src/services/summarizer.js';
import { FakeTranscriber, type Transcriber } from '../../src/services/transcriber.js';
import type { SendTextInput } from '../../src/services/whatsapp-client.js';
import { createInMemoryOutboundMessages } from '../helpers/in-memory-outbound.js';

const now = new Date('2026-08-03T12:00:00.000Z');

afterEach(() => {
  vi.useRealTimers();
});

function makeContext(): AudioJobContext {
  return {
    job: {
      id: 'job-1',
      inboundMessageId: 'inbound-1',
      status: 'processing',
      attemptCount: 1,
      maxAttempts: 3,
      nextAttemptAt: now,
      lockedAt: now,
      lockedBy: 'worker-1',
      startedAt: now,
      completedAt: null,
      downloadLatencyMs: null,
      transcriptionLatencyMs: null,
      summaryLatencyMs: null,
      totalLatencyMs: null,
      errorCode: null,
      errorDetailSanitized: null,
      createdAt: now,
      updatedAt: now
    },
    inboundMessage: {
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
      status: 'processing',
      errorCode: null
    },
    user: {
      id: 'user-1',
      whatsappUserId: '15551234567',
      displayName: 'Laura',
      createdAt: now,
      lastSeenAt: now,
      isBlocked: false
    }
  };
}

function makePendingLabel(): PendingSenderLabelRecord {
  return {
    id: 'label-1',
    userId: 'user-1',
    targetInboundMessageId: null,
    label: 'Alex',
    normalizedLabel: 'alex',
    createdAt: now,
    expiresAt: new Date('2026-08-03T12:30:00.000Z'),
    consumedAt: now
  };
}

function makeSummary(input: InsertSummaryInput, inserted: boolean): SummaryRecord {
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

function makeDependencies(): {
  dependencies: ProcessAudioMessageDependencies;
  sentMessages: SendTextInput[];
} {
  let pendingLabel: PendingSenderLabelRecord | null = makePendingLabel();
  let storedSummary: SummaryRecord | null = null;
  let storedTranscript: TranscriptRecord | null = null;
  const sentMessages: SendTextInput[] = [];
  const dependencies: ProcessAudioMessageDependencies = {
    config: {
      SUMMARY_RETENTION_DAYS: 30,
      TRANSCRIPT_RETENTION_DAYS: 30,
      SLOW_JOB_PROGRESS_MS: 30_000
    },
    jobStore: {
      findJobContext: vi.fn(async () => makeContext()),
      markCompleted: vi.fn(async () => ({}))
    },
    pendingSenderLabels: {
      consumeLatestForInboundMessage: vi.fn(async () => {
        const label = pendingLabel;
        pendingLabel = null;
        return label;
      })
    },
    summaries: {
      insertIfNew: vi.fn(async (input: InsertSummaryInput) => {
        if (storedSummary) {
          return {
            record: storedSummary,
            inserted: false
          };
        }

        storedSummary = makeSummary(input, true);
        return {
          record: storedSummary,
          inserted: true
        };
      })
    },
    transcripts: {
      insertIfNew: vi.fn(async (input: InsertTranscriptInput) => {
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
    outboundMessages: createInMemoryOutboundMessages(),
    whatsapp: {
      sendText: vi.fn(async (input: SendTextInput) => {
        sentMessages.push(input);
        return { whatsappMessageId: `wamid.out.${sentMessages.length}` };
      })
    },
    transcriber: new FakeTranscriber(),
    summarizer: new FakeSummarizer(),
    now: () => now
  };

  return {
    dependencies,
    sentMessages
  };
}

describe('createAudioMessageProcessor', () => {
  it('turns a queued fake audio job into a stored summary, transcript, and reply', async () => {
    const { dependencies, sentMessages } = makeDependencies();
    const processor = createAudioMessageProcessor(dependencies);

    await expect(processor.processAudioMessage('job-1')).resolves.toEqual({
      processed: true,
      summaryId: 'summary-1',
      transcriptId: 'transcript-1',
      replyCount: 2
    });

    expect(dependencies.pendingSenderLabels.consumeLatestForInboundMessage).toHaveBeenCalledWith(
      'user-1',
      'inbound-1',
      now
    );
    expect(dependencies.summaries.insertIfNew).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        inboundMessageId: 'inbound-1',
        fromLabel: 'Alex',
        fromLabelConfidence: 'user_provided'
      })
    );
    expect(dependencies.transcripts.insertIfNew).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        inboundMessageId: 'inbound-1',
        summaryId: 'summary-1'
      })
    );
    expect(sentMessages).toHaveLength(2);
    expect(sentMessages[0]?.to).toBe('15551234567');
    expect(sentMessages[0]?.body).toContain('🎧 Voice note from Alex\n🕒 today at 14:00');
    expect(sentMessages[1]?.body).toBe(
      ['💬 Copy-paste reply', '', 'Thanks Alex, got your voice note. I’ll check this and reply properly soon.'].join(
        '\n'
      )
    );
    expect(dependencies.jobStore.markCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        inboundMessageId: 'inbound-1',
        completedAt: now,
        downloadLatencyMs: null,
        transcriptionLatencyMs: expect.any(Number),
        summaryLatencyMs: expect.any(Number),
        totalLatencyMs: expect.any(Number)
      })
    );
  });

  it('passes prepared audio files into transcription and cleans them up after success', async () => {
    const { dependencies } = makeDependencies();
    const cleanup = vi.fn(async () => undefined);
    const audioSource: AudioSource = {
      prepareAudio: vi.fn(async () => ({
        audioPath: '/tmp/media-audio.ogg',
        mimeType: 'audio/ogg; codecs=opus',
        bytes: 5,
        cleanup
      }))
    };
    const transcriber: Transcriber = {
      transcribe: vi.fn(async () => {
        const text = 'Please review the plan and reply when convenient.';

        return {
          text,
          provider: 'openai' as const,
          model: 'gpt-4o-mini-transcribe',
          latencyMs: 42,
          characterCount: text.length
        };
      })
    };
    dependencies.audioSource = audioSource;
    dependencies.transcriber = transcriber;
    const processor = createAudioMessageProcessor(dependencies);

    await processor.processAudioMessage('job-1');

    expect(audioSource.prepareAudio).toHaveBeenCalledWith({
      jobId: 'job-1',
      mediaId: 'media_audio_123',
      mimeType: 'audio/ogg; codecs=opus'
    });
    expect(transcriber.transcribe).toHaveBeenCalledWith({
      mediaId: 'media_audio_123',
      audioPath: '/tmp/media-audio.ogg',
      mimeType: 'audio/ogg; codecs=opus',
      language: 'en'
    });
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('cleans prepared audio files when summarization fails', async () => {
    const { dependencies } = makeDependencies();
    const cleanup = vi.fn(async () => undefined);
    const audioSource: AudioSource = {
      prepareAudio: vi.fn(async () => ({
        audioPath: '/tmp/media-audio.ogg',
        mimeType: 'audio/ogg; codecs=opus',
        bytes: 5,
        cleanup
      }))
    };
    const summarizer: Summarizer = {
      summarize: vi.fn(async () => {
        throw new Error('summary failed');
      })
    };
    dependencies.audioSource = audioSource;
    dependencies.summarizer = summarizer;
    const processor = createAudioMessageProcessor(dependencies);

    await expect(processor.processAudioMessage('job-1')).rejects.toThrow('summary failed');

    expect(cleanup).toHaveBeenCalledOnce();
    expect(dependencies.pendingSenderLabels.consumeLatestForInboundMessage).not.toHaveBeenCalled();
    expect(dependencies.jobStore.markCompleted).not.toHaveBeenCalled();
  });

  it('does not send a duplicate summary reply on a repeated processor run', async () => {
    const { dependencies, sentMessages } = makeDependencies();
    const processor = createAudioMessageProcessor(dependencies);

    await processor.processAudioMessage('job-1');
    await processor.processAudioMessage('job-1');

    expect(sentMessages).toHaveLength(2);
  });

  it('sends one progress message when processing takes longer than the slow-job threshold', async () => {
    vi.useFakeTimers();
    const { dependencies, sentMessages } = makeDependencies();
    dependencies.config.SLOW_JOB_PROGRESS_MS = 1000;
    const fakeSummary = await new FakeSummarizer().summarize({
      transcript: 'Please reply when you can.'
    });
    dependencies.summarizer = {
      summarize: vi.fn(
        (): Promise<SummaryOutput> =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve(fakeSummary);
            }, 2000);
          })
      )
    };
    const processor = createAudioMessageProcessor(dependencies);
    const run = processor.processAudioMessage('job-1');

    await vi.advanceTimersByTimeAsync(1000);

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.body).toBe(
      'Still working - this voice note is taking a little longer than usual ✨'
    );

    await vi.advanceTimersByTimeAsync(1000);
    await expect(run).resolves.toMatchObject({
      processed: true,
      replyCount: 2
    });

    expect(sentMessages).toHaveLength(3);
    expect(sentMessages[1]?.body).toContain('🎧 Voice note from Alex');
    expect(sentMessages[2]?.body).toContain('💬 Copy-paste reply');
  });
});
