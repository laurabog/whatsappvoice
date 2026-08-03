import { randomUUID } from 'node:crypto';
import { loadConfig } from './config.js';
import { createDbPool } from './db/client.js';
import { createOutboundMessagesRepository } from './db/repositories/outbound-messages.js';
import { createPendingSenderLabelsRepository } from './db/repositories/pending-sender-labels.js';
import { createSummariesRepository } from './db/repositories/summaries.js';
import { createTranscriptsRepository } from './db/repositories/transcripts.js';
import { createAudioMessageProcessor } from './jobs/process-audio-message.js';
import { createJobStore } from './jobs/job-store.js';
import { createJobWorker } from './jobs/worker.js';
import { createLogger } from './observability/logger.js';
import { MetaWhatsAppClient } from './services/meta-whatsapp-client.js';
import { FakeSummarizer } from './services/summarizer.js';
import { FakeTranscriber } from './services/transcriber.js';

const config = loadConfig();
const logger = createLogger(config.NODE_ENV);
const db = createDbPool(config);
const jobStore = createJobStore(db);
const processor = createAudioMessageProcessor({
  config,
  jobStore,
  pendingSenderLabels: createPendingSenderLabelsRepository(db),
  summaries: createSummariesRepository(db),
  transcripts: createTranscriptsRepository(db),
  outboundMessages: createOutboundMessagesRepository(db),
  whatsapp: new MetaWhatsAppClient(config),
  transcriber: new FakeTranscriber(),
  summarizer: new FakeSummarizer()
});
const worker = createJobWorker({
  jobStore,
  workerId: `worker-${randomUUID()}`,
  processJob: processor.processAudioMessage,
  pollIntervalMs: config.WORKER_POLL_INTERVAL_MS
});

worker.start();
logger.info('Worker started');

async function shutdown(signal: string) {
  worker.stop();
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
