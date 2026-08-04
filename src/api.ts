import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDbPool } from './db/client.js';
import { createAudioWorkerRuntime } from './jobs/audio-worker-runtime.js';
import { MetaWhatsAppClient } from './services/meta-whatsapp-client.js';
import { createWhatsAppCommandHandler } from './webhooks/whatsapp-command-handler.js';

const config = loadConfig();
const db = config.DATABASE_URL ? createDbPool(config) : null;

const app = buildApp({
  config,
  whatsappWebhookHandlers: db && config.WHATSAPP_ACCESS_TOKEN && config.WHATSAPP_PHONE_NUMBER_ID
    ? createWhatsAppCommandHandler({
        config,
        db,
        whatsapp: new MetaWhatsAppClient(config)
      })
    : undefined
});
const audioWorkerRuntime = db ? createAudioWorkerRuntime({ config, db, logger: app.log }) : null;

app.addHook('onClose', async () => {
  audioWorkerRuntime?.stop();
  await db?.end();
});

try {
  audioWorkerRuntime?.start();
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
} catch (error) {
  app.log.error({ error }, 'Failed to start API server');
  process.exit(1);
}
