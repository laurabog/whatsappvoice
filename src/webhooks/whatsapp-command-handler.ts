import type { AppConfig } from '../config.js';
import type { DbPool } from '../db/client.js';
import { createInboundMessagesRepository } from '../db/repositories/inbound-messages.js';
import { createOutboundMessagesRepository } from '../db/repositories/outbound-messages.js';
import { createPendingSenderLabelsRepository } from '../db/repositories/pending-sender-labels.js';
import { createSummaryJobsRepository } from '../db/repositories/summary-jobs.js';
import { createSummariesRepository } from '../db/repositories/summaries.js';
import { createTranscriptsRepository } from '../db/repositories/transcripts.js';
import { createUsersRepository } from '../db/repositories/users.js';
import type { WhatsAppWebhookHandlers } from '../routes/whatsapp-webhook.js';
import type { WhatsAppTextSender } from '../services/whatsapp-client.js';
import { createCommandRouter } from '../commands/command-router.js';
import { createAudioIntakeHandler } from '../jobs/audio-intake.js';

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
  const users = createUsersRepository(db);
  const pendingSenderLabels = createPendingSenderLabelsRepository(db);
  const summaries = createSummariesRepository(db);
  const transcripts = createTranscriptsRepository(db);
  const inboundMessages = createInboundMessagesRepository(db);
  const summaryJobs = createSummaryJobsRepository(db);
  const outboundMessages = createOutboundMessagesRepository(db);

  const commandRouter = createCommandRouter({
    config,
    whatsapp,
    users,
    pendingSenderLabels,
    summaries,
    transcripts
  });
  const audioIntakeHandler = createAudioIntakeHandler({
    config,
    whatsapp,
    users,
    inboundMessages,
    summaryJobs,
    outboundMessages
  });

  return {
    async onMessage(message) {
      const commandResult = await commandRouter.handleMessage(message);
      if (!commandResult.handled) {
        await audioIntakeHandler.handleMessage(message);
      }
    }
  };
}
