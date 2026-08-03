import { createHash } from 'node:crypto';
import type {
  OutboundReplyKind,
  ReserveOutboundMessageResult
} from '../db/repositories/outbound-messages.js';
import type { WhatsAppTextSender } from './whatsapp-client.js';

export type OutboundMessagesForSending = {
  reserve(input: {
    inboundMessageId: string;
    userId: string;
    replyKind: OutboundReplyKind;
    chunkIndex?: number;
    bodySha256: string;
  }): Promise<ReserveOutboundMessageResult>;
  markSent(input: {
    id: string;
    whatsappMessageId: string;
    sentAt: Date;
  }): Promise<unknown>;
  markFailed(input: { id: string; errorCode: string }): Promise<unknown>;
};

export type SendWhatsAppTextOnceInput = {
  outboundMessages: OutboundMessagesForSending;
  whatsapp: WhatsAppTextSender;
  inboundMessageId: string;
  userId: string;
  replyKind: OutboundReplyKind;
  chunkIndex?: number;
  to: string;
  body: string;
  contextMessageId?: string;
  now?: () => Date;
};

export type SendWhatsAppTextOnceResult =
  | {
      sent: true;
      whatsappMessageId: string;
    }
  | {
      sent: false;
      reason: 'already_reserved';
    };

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function sendWhatsAppTextOnce(
  input: SendWhatsAppTextOnceInput
): Promise<SendWhatsAppTextOnceResult> {
  const reservation = await input.outboundMessages.reserve({
    inboundMessageId: input.inboundMessageId,
    userId: input.userId,
    replyKind: input.replyKind,
    chunkIndex: input.chunkIndex,
    bodySha256: sha256Hex(input.body)
  });

  if (!reservation.reserved) {
    return {
      sent: false,
      reason: 'already_reserved'
    };
  }

  try {
    const result = await input.whatsapp.sendText({
      to: input.to,
      body: input.body,
      contextMessageId: input.contextMessageId
    });

    await input.outboundMessages.markSent({
      id: reservation.record.id,
      whatsappMessageId: result.whatsappMessageId,
      sentAt: input.now?.() ?? new Date()
    });

    return {
      sent: true,
      whatsappMessageId: result.whatsappMessageId
    };
  } catch (error) {
    await input.outboundMessages.markFailed({
      id: reservation.record.id,
      errorCode: error instanceof Error ? error.name : 'send_failed'
    });

    throw error;
  }
}
