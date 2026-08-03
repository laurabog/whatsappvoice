import { randomUUID } from 'node:crypto';
import { loadConfig } from './config.js';
import { createDbPool } from './db/client.js';
import { createOutboundMessagesRepository } from './db/repositories/outbound-messages.js';
import { createPendingSenderLabelsRepository } from './db/repositories/pending-sender-labels.js';
import { createSummaryJobsRepository } from './db/repositories/summary-jobs.js';
import { createSummariesRepository } from './db/repositories/summaries.js';
import { createTranscriptsRepository } from './db/repositories/transcripts.js';
import { createAudioMessageProcessor } from './jobs/process-audio-message.js';
import { createJobStore } from './jobs/job-store.js';
import { createJobWorker } from './jobs/worker.js';
import { createLogger } from './observability/logger.js';
import { FfprobeAudioDurationProbe } from './services/audio-validator.js';
import { createWhatsAppMediaAudioSource } from './services/media-downloader.js';
import { MetaWhatsAppClient } from './services/meta-whatsapp-client.js';
import { createRetentionCleanup } from './services/retention-cleanup.js';
import { FakeSummarizer, OpenAISummarizer } from './services/summarizer.js';
import { FakeTranscriber, OpenAITranscriber } from './services/transcriber.js';
import type {
  DownloadMediaInput,
  DownloadMediaResult,
  SendTextInput,
  SendTextResult,
  WhatsAppMediaClient,
  WhatsAppMediaUrl,
  WhatsAppTextSender
} from './services/whatsapp-client.js';

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

const config = loadConfig();
const logger = createLogger(config.NODE_ENV);
const db = createDbPool(config);
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
        durationProbe
      })
    : undefined
});
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
  processJob: processor.processAudioMessage,
  pollIntervalMs: config.WORKER_POLL_INTERVAL_MS,
  processingJobTimeoutMs: config.PROCESSING_JOB_TIMEOUT_MS
});
let cleanupTimer: NodeJS.Timeout | null = null;

async function runRetentionCleanup() {
  try {
    const result = await cleanup.runOnce();
    logger.info({ result }, 'Retention cleanup finished');
  } catch (error) {
    logger.error({ error }, 'Retention cleanup failed');
  }
}

worker.start();
void runRetentionCleanup();
cleanupTimer = setInterval(() => {
  void runRetentionCleanup();
}, config.RETENTION_CLEANUP_INTERVAL_MS);
logger.info('Worker started');

async function shutdown(signal: string) {
  worker.stop();
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  await db.end();
  logger.info({ signal }, 'Worker stopped');
}

process.on('SIGTERM', () => {
  logger.info('Worker received SIGTERM');
  void shutdown('SIGTERM').finally(() => process.exit(0));
});

process.on('SIGINT', () => {
  logger.info('Worker received SIGINT');
  void shutdown('SIGINT').finally(() => process.exit(0));
});
