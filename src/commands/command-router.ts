import type { AppConfig } from '../config.js';
import type { UserRecord } from '../db/repositories/users.js';
import type { ParsedWhatsAppMessage } from '../routes/whatsapp-payload.js';
import type { WhatsAppTextSender } from '../services/whatsapp-client.js';
import {
  deleteConfirmationMessage,
  helpMessage,
  unsupportedMessage
} from './messages.js';
import { parseSenderLabelCommand } from './sender-label-command.js';
import { formatTranscriptReply } from './transcript-command.js';

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
  config: Pick<AppConfig, 'MAX_DAILY_MESSAGES_PER_USER' | 'MAX_TRANSCRIPT_REPLY_CHARS' | 'PENDING_LABEL_TTL_MINUTES'>;
  whatsapp: WhatsAppTextSender;
  users: {
    upsertFromWhatsApp(input: {
      whatsappUserId: string;
      displayName?: string | null;
    }): Promise<UserRecord>;
  };
  pendingSenderLabels: {
    createPendingLabel(input: {
      userId: string;
      label: string;
      normalizedLabel: string;
      expiresAt: Date;
    }): Promise<unknown>;
    deleteForUser(userId: string): Promise<number>;
  };
  summaries: {
    countForUserSince(userId: string, since: Date): Promise<number>;
    softDeleteForUser(userId: string, deletedAt: Date): Promise<number>;
  };
  transcripts: {
    findLatestAvailableForUser(userId: string, now: Date): Promise<{ text: string } | null>;
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

async function sendReply(
  message: ParsedWhatsAppMessage,
  whatsapp: WhatsAppTextSender,
  body: string
) {
  await whatsapp.sendText({
    to: message.from,
    body,
    contextMessageId: message.whatsappMessageId
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

      if (keyword === 'help') {
        await sendReply(message, dependencies.whatsapp, helpMessage);
        return { handled: true, command: 'help' };
      }

      if (keyword === 'delete') {
        const deletionTime = now();
        await dependencies.transcripts.softDeleteForUser(user.id, deletionTime);
        await dependencies.summaries.softDeleteForUser(user.id, deletionTime);
        await dependencies.pendingSenderLabels.deleteForUser(user.id);
        await sendReply(message, dependencies.whatsapp, deleteConfirmationMessage);
        return { handled: true, command: 'delete' };
      }

      if (keyword === 'status') {
        const count = await dependencies.summaries.countForUserSince(user.id, hoursAgo(now(), 24));
        await sendReply(
          message,
          dependencies.whatsapp,
          `You have summarized ${count} voice notes today.\nDaily friend-beta limit: ${dependencies.config.MAX_DAILY_MESSAGES_PER_USER}.`
        );
        return { handled: true, command: 'status' };
      }

      if (keyword === 'transcript' || keyword === 'transcript latest') {
        const transcript = await dependencies.transcripts.findLatestAvailableForUser(user.id, now());
        const replies = formatTranscriptReply(
          transcript,
          dependencies.config.MAX_TRANSCRIPT_REPLY_CHARS
        );

        for (const reply of replies) {
          await sendReply(message, dependencies.whatsapp, reply);
        }

        return { handled: true, command: 'transcript' };
      }

      const senderLabel = parseSenderLabelCommand(text);
      if (senderLabel.ok) {
        const expiresAt = new Date(
          now().getTime() + dependencies.config.PENDING_LABEL_TTL_MINUTES * 60 * 1000
        );

        await dependencies.pendingSenderLabels.createPendingLabel({
          userId: user.id,
          label: senderLabel.label,
          normalizedLabel: senderLabel.normalizedLabel,
          expiresAt
        });

        await sendReply(
          message,
          dependencies.whatsapp,
          `Got it. I will label the next voice note as from ${senderLabel.label}.`
        );
        return { handled: true, command: 'sender_label' };
      }

      await sendReply(message, dependencies.whatsapp, unsupportedMessage);
      return { handled: true, command: 'unsupported_text' };
    }
  };
}
