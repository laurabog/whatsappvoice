import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config.js';
import type { DbPool } from '../db/client.js';
import { createOutboundMessagesRepository } from '../db/repositories/outbound-messages.js';
import { createPendingSenderLabelsRepository } from '../db/repositories/pending-sender-labels.js';
import { createSummaryJobsRepository } from '../db/repositories/summary-jobs.js';
import { createSummariesRepository } from '../db/repositories/summaries.js';
import { createTranscriptsRepository } from '../db/repositories/transcripts.js';
import {
  createRetentionCleanup,
  type RetentionCleanupResult
} from '../services/retention-cleanup.js';
import { FfprobeAudioDurationProbe } from '../services/audio-validator.js';
import { createWhatsAppMediaAudioSource } from '../services/media-downloader.js';
import { MetaWhatsAppClient } from '../services/meta-whatsapp-client.js';
import { FakeSummarizer, OpenAISummarizer } from '../services/summarizer.js';
import { sendWhatsAppTextOnce } from '../services/idempotent-whatsapp-sender.js';
import { FakeTranscriber, OpenAITranscriber } from '../services/transcriber.js';
import type {
  DownloadMediaInput,
  DownloadMediaResult,
  SendTextInput,
  SendTextResult,
  WhatsAppMediaClient,
  WhatsAppMediaUrl,
  WhatsAppTextSender
} from '../services/whatsapp-client.js';
import { createJobStore } from './job-store.js';
import { createAudioMessageProcessor } from './process-audio-message.js';
import { createJobWorker } from './worker.js';

type RuntimeLogger = {
  info: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

class PlaceholderWhatsAppClient implements WhatsAppTextSender, WhatsAppMediaClient {
  async sendText(_input: SendTextInput): Promise<SendTextResult> {
    throw new Error('WhatsApp send credentials are not configured');
  }

  async getMediaUrl(_mediaId: string): Promise<WhatsAppMediaUrl> {
    throw new Error('WhatsApp media credentials are not configured');
  }

  async downloadMediaToFile(_input: DownloadMediaInput): Promise<DownloadMediaResult> {
    throw new Error('WhatsApp media credentials are not configured');
  }
}

export type AudioWorkerRuntime = {
  start(): void;
  stop(): void;
  drainJobs(input?: { maxJobs?: number }): Promise<AudioDrainResult>;
  runRetentionCleanup(): Promise<RetentionCleanupResult>;
};

export type AudioDrainResult = {
  ok: true;
  processed: number;
  completed: number;
  retryableFailed: number;
  terminalFailed: number;
  empty: boolean;
};

export const terminalFailureMessage =
  'I could not finish this one — the audio magic fizzled halfway through. Please try forwarding the voice note again ✨';

export type CreateAudioWorkerRuntimeOptions = {
  config: AppConfig;
  db: DbPool;
  logger?: RuntimeLogger;
};

function reportAsyncError(logger: RuntimeLogger | undefined, message: string) {
  return (error: unknown) => {
    logger?.error({ error }, message);
  };
}

export function createAudioWorkerRuntime({
  config,
  db,
  logger
}: CreateAudioWorkerRuntimeOptions): AudioWorkerRuntime {
  const jobStore = createJobStore(db);
  const pendingSenderLabels = createPendingSenderLabelsRepository(db);
  const summaries = createSummariesRepository(db);
  const transcripts = createTranscriptsRepository(db);
  const outboundMessages = createOutboundMessagesRepository(db);
  const summaryJobs = createSummaryJobsRepository(db);
  const hasWhatsAppSendCredentials = Boolean(
    config.WHATSAPP_ACCESS_TOKEN && config.WHATSAPP_PHONE_NUMBER_ID
  );
  const whatsapp = hasWhatsAppSendCredentials
    ? new MetaWhatsAppClient(config)
    : new PlaceholderWhatsAppClient();
  const useOpenAIProcessing = Boolean(config.OPENAI_API_KEY && hasWhatsAppSendCredentials);
  const durationProbe =
    config.AUDIO_DURATION_PROBE === 'ffprobe' ? new FfprobeAudioDurationProbe() : undefined;
  const logAudioProgress = (event: unknown) => {
    logger?.info(event, 'Audio job step updated');
  };
  const processor = createAudioMessageProcessor({
    config,
    jobStore,
    pendingSenderLabels,
    summaries,
    transcripts,
    outboundMessages,
    whatsapp,
    transcriber: useOpenAIProcessing ? new OpenAITranscriber(config) : new FakeTranscriber(),
    summarizer: useOpenAIProcessing ? new OpenAISummarizer(config) : new FakeSummarizer(),
    audioSource: useOpenAIProcessing
      ? createWhatsAppMediaAudioSource({
          config,
          mediaClient: whatsapp,
          durationProbe,
          onProgress: logAudioProgress
        })
      : undefined,
    onProgress: logAudioProgress
  });
  const processAudioJob = async (jobId: string) => {
    logger?.info({ jobId }, 'Audio job processing started');

    try {
      const result = await processor.processAudioMessage(jobId);
      logger?.info({ jobId, result }, 'Audio job processing completed');
      return result;
    } catch (error) {
      logger?.error({ error, jobId }, 'Audio job processing failed');
      throw error;
    }
  };
  const notifyTerminalFailure = async (job: { id: string }) => {
    const context = await jobStore.findJobContext(job.id);
    if (!context) {
      logger?.error(
        { jobId: job.id },
        'Could not send terminal failure reply because job context was missing'
      );
      return;
    }

    await sendWhatsAppTextOnce({
      outboundMessages,
      whatsapp,
      inboundMessageId: context.inboundMessage.id,
      userId: context.user.id,
      replyKind: 'failure',
      to: context.user.whatsappUserId,
      body: terminalFailureMessage,
      contextMessageId: context.inboundMessage.whatsappMessageId
    });
  };
  const cleanup = createRetentionCleanup({
    config,
    summaries,
    transcripts,
    pendingSenderLabels,
    summaryJobs
  });
  const worker = createJobWorker({
    jobStore,
    workerId: `worker-${randomUUID()}`,
    processJob: processAudioJob,
    pollIntervalMs: config.WORKER_POLL_INTERVAL_MS,
    activeJobTimeoutMs: config.ACTIVE_JOB_TIMEOUT_MS,
    processingJobTimeoutMs: config.PROCESSING_JOB_TIMEOUT_MS,
    onTerminalJobFailed: notifyTerminalFailure,
    onError: reportAsyncError(logger, 'Audio worker poll failed')
  });
  let cleanupTimer: NodeJS.Timeout | null = null;
  let started = false;

  async function runRetentionCleanup(): Promise<RetentionCleanupResult> {
    try {
      const result = await cleanup.runOnce();
      logger?.info({ result }, 'Retention cleanup finished');
      return result;
    } catch (error) {
      logger?.error({ error }, 'Retention cleanup failed');
      throw error;
    }
  }

  async function drainJobs(input: { maxJobs?: number } = {}): Promise<AudioDrainResult> {
    const maxJobs = Math.min(Math.max(input.maxJobs ?? 1, 1), 3);
    const result: AudioDrainResult = {
      ok: true,
      processed: 0,
      completed: 0,
      retryableFailed: 0,
      terminalFailed: 0,
      empty: false
    };

    for (let index = 0; index < maxJobs; index += 1) {
      const jobResult = await worker.runOnceDetailed();
      if (!jobResult.attempted) {
        result.empty = result.processed === 0;
        break;
      }

      result.processed += 1;

      if (jobResult.outcome === 'completed') {
        result.completed += 1;
      } else if (jobResult.outcome === 'terminal_failed') {
        result.terminalFailed += 1;
      } else {
        result.retryableFailed += 1;
      }
    }

    logger?.info({ result }, 'Audio job drain completed');
    return result;
  }

  return {
    start() {
      if (started) {
        return;
      }

      started = true;
      if (config.RUN_IN_PROCESS_WORKER) {
        worker.start();
        void worker.runOnce().catch(reportAsyncError(logger, 'Initial audio worker poll failed'));
      }
      void runRetentionCleanup();
      cleanupTimer = setInterval(() => {
        void runRetentionCleanup();
      }, config.RETENTION_CLEANUP_INTERVAL_MS);
      logger?.info(
        { useOpenAIProcessing, runInProcessWorker: config.RUN_IN_PROCESS_WORKER },
        'Audio worker runtime started'
      );
    },

    stop() {
      if (!started) {
        return;
      }

      started = false;
      worker.stop();
      if (cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
      }
      logger?.info('Audio worker runtime stopped');
    },

    drainJobs,

    runRetentionCleanup
  };
}
