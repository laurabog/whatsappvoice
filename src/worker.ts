import { loadConfig } from './config.js';
import { createLogger } from './observability/logger.js';

const config = loadConfig();
const logger = createLogger(config.NODE_ENV);

logger.info('Worker scaffold started');

process.on('SIGTERM', () => {
  logger.info('Worker received SIGTERM');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('Worker received SIGINT');
  process.exit(0);
});
