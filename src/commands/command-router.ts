import type { AppConfig } from '../config.js';
import type { InboundMessageRecord } from '../db/repositories/inbound-messages.js';
import type { OutboundReplyKind } from '../db/repositories/outbound-messages.js';
import type { UserRecord } from '../db/repositories/users.js';
import type { ParsedWhatsAppMessage } from '../routes/whatsapp-payload.js';
import {
  sendWhatsAppTextOnce,
  type OutboundMessagesForSending
} from '../services/idempotent-whatsapp-sender.js';
import type { WhatsAppTextSender } from '../services/whatsapp-client.js';
import {
  deleteConfirmationMessage,
  helpMessage,
  unsupportedMessage
} from './messages.js';
import { parseSenderLabelCommand } from './sender-label-command.js';
import { formatTranscriptReply } from './transcript-command.js';
import { formatLabelUpdatedMessage } from '../services/reply-formatter.js';

export type CommandHandlingResult =
  | {
      handled: true;
      command:
        | 'help'
        | 'delete'
        | 'status'
        | 'transcript'
        | 'sender_label'
        | 'unsupported_text';
    }
  | {
      handled: false;
    };

export type CommandRouterDependencies = {
  config: Pick<
    AppConfig,
    | 'MAX_DAILY_MESSAGES_PER_USER'
    | 'MAX_TRANSCRIPT_REPLY_CHARS'
    | 'PENDING_LABEL_TTL_MINUTES'
    | 'AFTER_NOTE_LABEL_WINDOW_MINUTES'
    | 'RENAME_LATEST_LABEL_WINDOW_HOURS'
  >;
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
      textBody?: string | null;
      status?: 'received' | 'ignored' | 'queued' | 'processing' | 'completed' | 'failed';
    }): Promise<{ record: InboundMessageRecord; inserted: boolean }>;
    updateStatus(
      id: string,
      status: 'received' | 'ignored' | 'queued' | 'processing' | 'completed' | 'failed',
      errorCode?: string | null
    ): Promise<InboundMessageRecord>;
    findLatestQueuedOrProcessingAudioForUserSince(
      userId: string,
      since: Date
    ): Promise<InboundMessageRecord | null>;
  };
  outboundMessages: OutboundMessagesForSending;
  pendingSenderLabels: {
    createPendingLabel(input: {
      userId: string;
      label: string;
      normalizedLabel: string;
      expiresAt: Date;
      targetInboundMessageId?: string | null;
    }): Promise<unknown>;
    deleteForUser(userId: string): Promise<number>;
  };
  summaries: {
    countForUserSince(userId: string, since: Date): Promise<number>;
    softDeleteForUser(userId: string, deletedAt: Date): Promise<number>;
    findLatestActiveForUserSince(input: {
      userId: string;
      receivedAfter: Date;
      now: Date;
    }): Promise<{
      id: string;
      oneSentenceSummary: string;
      receivedAt: Date;
    } | null>;
    updateLabel(input: {
      summaryId: string;
      fromLabel: string;
      fromLabelConfidence: string;
    }): Promise<{
      oneSentenceSummary: string;
    }>;
  };
  transcripts: {
    findLatestAvailableForUser(
      userId: string,
      now: Date
    ): Promise<{ text: string; fromLabel: string; receivedAt: Date } | null>;
    softDeleteForUser(userId: string, deletedAt: Date): Promise<number>;
  };
  now?: () => Date;
};

function normalizeCommandText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function commandKeyword(text: string): string {
  return normalizeCommandText(text).toLowerCase();
}

function hoursAgo(now: Date, hours: number): Date {
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}

function minutesAgo(now: Date, minutes: number): Date {
  return new Date(now.getTime() - minutes * 60 * 1000);
}

function inboundDisplayTime(inboundMessage: InboundMessageRecord): Date {
  return inboundMessage.whatsappTimestamp ?? inboundMessage.receivedAt;
}

async function sendReply(
  message: ParsedWhatsAppMessage,
  inboundMessage: InboundMessageRecord,
  user: UserRecord,
  outboundMessages: OutboundMessagesForSending,
  whatsapp: WhatsAppTextSender,
  replyKind: OutboundReplyKind,
  body: string,
  chunkIndex = 0,
  now?: () => Date
) {
  await sendWhatsAppTextOnce({
    outboundMessages,
    whatsapp,
    inboundMessageId: inboundMessage.id,
    userId: user.id,
    replyKind,
    chunkIndex,
    to: user.whatsappUserId,
    body,
    contextMessageId: message.whatsappMessageId,
    now
  });
}

export function createCommandRouter(dependencies: CommandRouterDependencies) {
  const now = dependencies.now ?? (() => new Date());

  return {
    async handleMessage(message: ParsedWhatsAppMessage): Promise<CommandHandlingResult> {
      if (message.messageType !== 'text' || !message.textBody) {
        return { handled: false };
      }

      const user = await dependencies.users.upsertFromWhatsApp({
        whatsappUserId: message.from,
        displayName: message.displayName
      });

      const text = normalizeCommandText(message.textBody);
      const keyword = commandKeyword(text);
      const inboundResult = await dependencies.inboundMessages.insertIfNew({
        whatsappMessageId: message.whatsappMessageId,
        userId: user.id,
        messageType: message.messageType,
        whatsappTimestamp: message.timestamp,
        textBody: null,
        status: 'received'
      });
      const inboundMessage = inboundResult.record;
      const shouldRunCommandWork =
        inboundResult.inserted || inboundMessage.status !== 'completed';

      if (keyword === 'help') {
        if (shouldRunCommandWork) {
          await dependencies.inboundMessages.updateStatus(inboundMessage.id, 'completed');
        }

        await sendReply(
          message,
          inboundMessage,
          user,
          dependencies.outboundMessages,
          dependencies.whatsapp,
          'help',
          helpMessage,
          0,
          now
        );
        return { handled: true, command: 'help' };
      }

      if (keyword === 'delete') {
        if (shouldRunCommandWork) {
          const deletionTime = now();
          await dependencies.transcripts.softDeleteForUser(user.id, deletionTime);
          await dependencies.summaries.softDeleteForUser(user.id, deletionTime);
          await dependencies.pendingSenderLabels.deleteForUser(user.id);
          await dependencies.inboundMessages.updateStatus(inboundMessage.id, 'completed');
        }

        await sendReply(
          message,
          inboundMessage,
          user,
          dependencies.outboundMessages,
          dependencies.whatsapp,
          'delete_confirmation',
          deleteConfirmationMessage,
          0,
          now
        );
        return { handled: true, command: 'delete' };
      }

      if (keyword === 'status') {
        const count = await dependencies.summaries.countForUserSince(user.id, hoursAgo(now(), 24));
        if (shouldRunCommandWork) {
          await dependencies.inboundMessages.updateStatus(inboundMessage.id, 'completed');
        }

        await sendReply(
          message,
          inboundMessage,
          user,
          dependencies.outboundMessages,
          dependencies.whatsapp,
          'status',
          `You have summarized ${count} voice notes today.\nDaily friend-beta limit: ${dependencies.config.MAX_DAILY_MESSAGES_PER_USER}.`,
          0,
          now
        );
        return { handled: true, command: 'status' };
      }

      if (keyword === 'transcript' || keyword === 'transcript latest') {
        const transcript = await dependencies.transcripts.findLatestAvailableForUser(user.id, now());
        const replies = formatTranscriptReply(
          transcript,
          dependencies.config.MAX_TRANSCRIPT_REPLY_CHARS
        );
        if (shouldRunCommandWork) {
          await dependencies.inboundMessages.updateStatus(inboundMessage.id, 'completed');
        }

        for (const [index, reply] of replies.entries()) {
          await sendReply(
            message,
            inboundMessage,
            user,
            dependencies.outboundMessages,
            dependencies.whatsapp,
            'transcript',
            reply,
            index,
            now
          );
        }

        return { handled: true, command: 'transcript' };
      }

      const senderLabel = parseSenderLabelCommand(text);
      if (senderLabel.ok) {
        const handledAt = now();
        const expiresAt = new Date(
          handledAt.getTime() + dependencies.config.PENDING_LABEL_TTL_MINUTES * 60 * 1000
        );

        if (senderLabel.intent === 'before_next') {
          if (shouldRunCommandWork) {
            await dependencies.pendingSenderLabels.createPendingLabel({
              userId: user.id,
              label: senderLabel.label,
              normalizedLabel: senderLabel.normalizedLabel,
              expiresAt
            });
            await dependencies.inboundMessages.updateStatus(inboundMessage.id, 'completed');
          }

          return { handled: true, command: 'sender_label' };
        }

        const labelWindowStart =
          senderLabel.intent === 'rename_latest'
            ? hoursAgo(handledAt, dependencies.config.RENAME_LATEST_LABEL_WINDOW_HOURS)
            : minutesAgo(handledAt, dependencies.config.AFTER_NOTE_LABEL_WINDOW_MINUTES);
        const latestSummary = await dependencies.summaries.findLatestActiveForUserSince({
          userId: user.id,
          receivedAfter: labelWindowStart,
          now: handledAt
        });

        if (senderLabel.intent === 'after_recent') {
          const latestInFlightAudio =
            await dependencies.inboundMessages.findLatestQueuedOrProcessingAudioForUserSince(
              user.id,
              labelWindowStart
            );

          if (
            latestInFlightAudio &&
            (!latestSummary || inboundDisplayTime(latestInFlightAudio) >= latestSummary.receivedAt)
          ) {
            if (shouldRunCommandWork) {
              await dependencies.pendingSenderLabels.createPendingLabel({
                userId: user.id,
                label: senderLabel.label,
                normalizedLabel: senderLabel.normalizedLabel,
                expiresAt,
                targetInboundMessageId: latestInFlightAudio.id
              });
              await dependencies.inboundMessages.updateStatus(inboundMessage.id, 'completed');
            }

            return { handled: true, command: 'sender_label' };
          }
        }

        if (latestSummary) {
          if (shouldRunCommandWork) {
            await dependencies.summaries.updateLabel({
              summaryId: latestSummary.id,
              fromLabel: senderLabel.label,
              fromLabelConfidence: 'user_provided'
            });
            await dependencies.inboundMessages.updateStatus(inboundMessage.id, 'completed');
          }

          await sendReply(
            message,
            inboundMessage,
            user,
            dependencies.outboundMessages,
            dependencies.whatsapp,
            'sender_label',
            formatLabelUpdatedMessage(senderLabel.label),
            0,
            now
          );
          return { handled: true, command: 'sender_label' };
        }
      }

      if (shouldRunCommandWork) {
        await dependencies.inboundMessages.updateStatus(inboundMessage.id, 'completed');
      }

      await sendReply(
        message,
        inboundMessage,
        user,
        dependencies.outboundMessages,
        dependencies.whatsapp,
        'unsupported_text',
        unsupportedMessage,
        0,
        now
      );
      return { handled: true, command: 'unsupported_text' };
    }
  };
}
