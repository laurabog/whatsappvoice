import { loadConfig } from './config.js';
import { createDbPool } from './db/client.js';
import { createAudioWorkerRuntime } from './jobs/audio-worker-runtime.js';
import { createLogger } from './observability/logger.js';

const config = loadConfig();
const logger = createLogger(config.NODE_ENV);
const db = createDbPool(config);
const runtime = createAudioWorkerRuntime({ config, db, logger });

runtime.start();
logger.info('Worker started');

async function shutdown(signal: string) {
  runtime.stop();
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
