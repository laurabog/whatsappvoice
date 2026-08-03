import Fastify from 'fastify';
import type { AppConfig } from './config.js';
import { createLogger } from './observability/logger.js';

export type BuildAppOptions = {
  config: AppConfig;
};

export function buildApp({ config }: BuildAppOptions) {
  const app = Fastify({
    loggerInstance: createLogger(config.NODE_ENV)
  });

  app.get('/health', async () => ({
    ok: true,
    service: 'whatsapp-voice-summary',
    environment: config.NODE_ENV
  }));

  return app;
}
