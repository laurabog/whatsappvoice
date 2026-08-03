import type {
  OutboundMessageRecord,
  OutboundReplyKind,
  ReserveOutboundMessageInput,
  ReserveOutboundMessageResult
} from '../../src/db/repositories/outbound-messages.js';

function outboundKey(input: {
  inboundMessageId: string;
  replyKind: OutboundReplyKind;
  chunkIndex?: number;
}): string {
  return `${input.inboundMessageId}:${input.replyKind}:${input.chunkIndex ?? 0}`;
}

export function createInMemoryOutboundMessages() {
  const records = new Map<string, OutboundMessageRecord>();

  return {
    records,

    async reserve(
      input: ReserveOutboundMessageInput
    ): Promise<ReserveOutboundMessageResult> {
      const key = outboundKey(input);
      const existing = records.get(key);
      if (existing) {
        return {
          record: existing,
          reserved: false
        };
      }

      const record: OutboundMessageRecord = {
        id: `outbound-${records.size + 1}`,
        inboundMessageId: input.inboundMessageId,
        userId: input.userId,
        replyKind: input.replyKind,
        chunkIndex: input.chunkIndex ?? 0,
        whatsappMessageId: null,
        status: 'pending',
        bodySha256: input.bodySha256,
        createdAt: new Date('2026-08-03T12:00:00.000Z'),
        sentAt: null,
        errorCode: null
      };
      records.set(key, record);

      return {
        record,
        reserved: true
      };
    },

    async markSent(input: {
      id: string;
      whatsappMessageId: string;
      sentAt: Date;
    }): Promise<OutboundMessageRecord> {
      const record = [...records.values()].find((candidate) => candidate.id === input.id);
      if (!record) {
        throw new Error(`Outbound ${input.id} not found`);
      }

      record.status = 'sent';
      record.whatsappMessageId = input.whatsappMessageId;
      record.sentAt = input.sentAt;
      record.errorCode = null;
      return record;
    },

    async markFailed(input: { id: string; errorCode: string }): Promise<OutboundMessageRecord> {
      const record = [...records.values()].find((candidate) => candidate.id === input.id);
      if (!record) {
        throw new Error(`Outbound ${input.id} not found`);
      }

      record.status = 'failed';
      record.errorCode = input.errorCode;
      return record;
    }
  };
}
