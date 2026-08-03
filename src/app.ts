import Fastify from 'fastify';
import type { AppConfig } from './config.js';
import { createLogger } from './observability/logger.js';
import {
  registerWhatsAppWebhookRoutes,
  type WhatsAppWebhookHandlers
} from './routes/whatsapp-webhook.js';

export type BuildAppOptions = {
  config: AppConfig;
  whatsappWebhookHandlers?: WhatsAppWebhookHandlers;
};

export function buildApp({ config, whatsappWebhookHandlers }: BuildAppOptions) {
  const app = Fastify({
    loggerInstance: createLogger(config.NODE_ENV)
  });

  app.get('/health', async () => ({
    ok: true,
    service: 'whatsapp-voice-summary',
    environment: config.NODE_ENV
  }));

  registerWhatsAppWebhookRoutes(app, {
    config,
    handlers: whatsappWebhookHandlers
  });

  return app;
}
