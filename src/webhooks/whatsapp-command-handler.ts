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
import type { JobDrainTrigger } from '../services/job-trigger.js';

type HandlerLogger = {
  error: (...args: unknown[]) => void;
};

export type CreateWhatsAppCommandHandlerOptions = {
  config: AppConfig;
  db: DbPool;
  whatsapp: WhatsAppTextSender;
  jobDrainTrigger?: JobDrainTrigger;
  logger?: HandlerLogger;
};

export function createWhatsAppCommandHandler({
  config,
  db,
  whatsapp,
  jobDrainTrigger,
  logger
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
    inboundMessages,
    outboundMessages,
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
    outboundMessages,
    jobDrainTrigger,
    onJobDrainTriggerError(error, input) {
      logger?.error({ error, ...input }, 'Failed to schedule audio job drain');
    }
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
