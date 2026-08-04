import type { AppConfig } from '../config.js';
import type { InboundMessageRecord } from '../db/repositories/inbound-messages.js';
import type { SummaryJobRecord } from '../db/repositories/summary-jobs.js';
import type { UserRecord } from '../db/repositories/users.js';
import type { ParsedWhatsAppMessage } from '../routes/whatsapp-payload.js';
import type { WhatsAppTextSender } from '../services/whatsapp-client.js';
import {
  sendWhatsAppTextOnce,
  type OutboundMessagesForSending
} from '../services/idempotent-whatsapp-sender.js';

export const processingAckMessage = 'Got it — working a little voice-note magic ✨';

export function dailyLimitMessage(limit: number): string {
  return `You have reached the daily friend-beta limit of ${limit} voice notes. Please try again tomorrow.`;
}

export type AudioIntakeResult =
  | {
      handled: false;
      reason: 'not_audio';
    }
  | {
      handled: true;
      queued: true;
      inboundMessage: InboundMessageRecord;
      job: SummaryJobRecord;
    }
  | {
      handled: true;
      queued: false;
      reason: 'duplicate' | 'blocked' | 'daily_limit';
      inboundMessage: InboundMessageRecord;
    };

export type AudioIntakeDependencies = {
  config: Pick<AppConfig, 'MAX_DAILY_MESSAGES_PER_USER' | 'AUDIO_LABEL_GRACE_PERIOD_MS'>;
  whatsapp: WhatsAppTextSender;
  users: {
    upsertFromWhatsApp(input: {
      whatsappUserId: string;
      displayName?: string | null;
    }): Promise<UserRecord>;
  };
  inboundMessages: {
    insertIfNew(input: {
      whatsappMessageId: string;
      userId: string;
      messageType: string;
      whatsappTimestamp?: Date | null;
      mediaId?: string | null;
      mimeType?: string | null;
      isVoiceNote?: boolean | null;
      textBody?: string | null;
      status?: 'received' | 'ignored' | 'queued' | 'processing' | 'completed' | 'failed';
    }): Promise<{ record: InboundMessageRecord; inserted: boolean }>;
    updateStatus(
      id: string,
      status: 'received' | 'ignored' | 'queued' | 'processing' | 'completed' | 'failed',
      errorCode?: string | null
    ): Promise<InboundMessageRecord>;
    countAcceptedAudioForUserSince(userId: string, since: Date): Promise<number>;
  };
  summaryJobs: {
    createForInboundMessage(
      inboundMessageId: string,
      nextAttemptAt?: Date | null
    ): Promise<SummaryJobRecord>;
  };
  outboundMessages: OutboundMessagesForSending;
  now?: () => Date;
};

function hoursAgo(now: Date, hours: number): Date {
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}

export function createAudioIntakeHandler(dependencies: AudioIntakeDependencies) {
  const now = dependencies.now ?? (() => new Date());

  return {
    async handleMessage(message: ParsedWhatsAppMessage): Promise<AudioIntakeResult> {
      if (message.messageType !== 'audio' || !message.audio?.mediaId) {
        return {
          handled: false,
          reason: 'not_audio'
        };
      }

      const user = await dependencies.users.upsertFromWhatsApp({
        whatsappUserId: message.from,
        displayName: message.displayName
      });

      const inboundResult = await dependencies.inboundMessages.insertIfNew({
        whatsappMessageId: message.whatsappMessageId,
        userId: user.id,
        messageType: message.messageType,
        whatsappTimestamp: message.timestamp,
        mediaId: message.audio.mediaId,
        mimeType: message.audio.mimeType,
        isVoiceNote: message.audio.isVoiceNote,
        status: 'received'
      });

      if (!inboundResult.inserted) {
        return {
          handled: true,
          queued: false,
          reason: 'duplicate',
          inboundMessage: inboundResult.record
        };
      }

      if (user.isBlocked) {
        const inboundMessage = await dependencies.inboundMessages.updateStatus(
          inboundResult.record.id,
          'ignored',
          'user_blocked'
        );
        return {
          handled: true,
          queued: false,
          reason: 'blocked',
          inboundMessage
        };
      }

      const acceptedCount = await dependencies.inboundMessages.countAcceptedAudioForUserSince(
        user.id,
        hoursAgo(now(), 24)
      );

      if (acceptedCount >= dependencies.config.MAX_DAILY_MESSAGES_PER_USER) {
        const inboundMessage = await dependencies.inboundMessages.updateStatus(
          inboundResult.record.id,
          'ignored',
          'daily_limit'
        );
        await sendWhatsAppTextOnce({
          outboundMessages: dependencies.outboundMessages,
          whatsapp: dependencies.whatsapp,
          inboundMessageId: inboundMessage.id,
          userId: user.id,
          replyKind: 'failure',
          to: message.from,
          body: dailyLimitMessage(dependencies.config.MAX_DAILY_MESSAGES_PER_USER),
          contextMessageId: message.whatsappMessageId,
          now
        });

        return {
          handled: true,
          queued: false,
          reason: 'daily_limit',
          inboundMessage
        };
      }

      const job = await dependencies.summaryJobs.createForInboundMessage(
        inboundResult.record.id,
        new Date(now().getTime() + dependencies.config.AUDIO_LABEL_GRACE_PERIOD_MS)
      );
      const inboundMessage = await dependencies.inboundMessages.updateStatus(
        inboundResult.record.id,
        'queued'
      );

      await sendWhatsAppTextOnce({
        outboundMessages: dependencies.outboundMessages,
        whatsapp: dependencies.whatsapp,
        inboundMessageId: inboundMessage.id,
        userId: user.id,
        replyKind: 'processing_ack',
        to: message.from,
        body: processingAckMessage,
        contextMessageId: message.whatsappMessageId,
        now
      });

      return {
        handled: true,
        queued: true,
        inboundMessage,
        job
      };
    }
  };
}
