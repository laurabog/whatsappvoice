import type { AppConfig } from '../config.js';
import type { DbPool } from '../db/client.js';
import { createPendingSenderLabelsRepository } from '../db/repositories/pending-sender-labels.js';
import { createSummariesRepository } from '../db/repositories/summaries.js';
import { createTranscriptsRepository } from '../db/repositories/transcripts.js';
import { createUsersRepository } from '../db/repositories/users.js';
import type { WhatsAppWebhookHandlers } from '../routes/whatsapp-webhook.js';
import type { WhatsAppTextSender } from '../services/whatsapp-client.js';
import { createCommandRouter } from '../commands/command-router.js';

export type CreateWhatsAppCommandHandlerOptions = {
  config: AppConfig;
  db: DbPool;
  whatsapp: WhatsAppTextSender;
};

export function createWhatsAppCommandHandler({
  config,
  db,
  whatsapp
}: CreateWhatsAppCommandHandlerOptions): WhatsAppWebhookHandlers {
  const commandRouter = createCommandRouter({
    config,
    whatsapp,
    users: createUsersRepository(db),
    pendingSenderLabels: createPendingSenderLabelsRepository(db),
    summaries: createSummariesRepository(db),
    transcripts: createTranscriptsRepository(db)
  });

  return {
    async onMessage(message) {
      await commandRouter.handleMessage(message);
    }
  };
}
