import { randomUUID } from 'node:crypto';
import type { DbClient } from '../client.js';

export type OutboundReplyKind =
  | 'processing_ack'
  | 'progress'
  | 'summary'
  | 'transcript'
  | 'failure'
  | 'help'
  | 'status'
  | 'sender_label'
  | 'unsupported_text'
  | 'delete_confirmation';

export type OutboundMessageStatus = 'pending' | 'sent' | 'failed';

export type OutboundMessageRecord = {
  id: string;
  inboundMessageId: string;
  userId: string;
  replyKind: OutboundReplyKind;
  chunkIndex: number;
  whatsappMessageId: string | null;
  status: OutboundMessageStatus;
  bodySha256: string;
  createdAt: Date;
  sentAt: Date | null;
  errorCode: string | null;
};

export type ReserveOutboundMessageInput = {
  inboundMessageId: string;
  userId: string;
  replyKind: OutboundReplyKind;
  chunkIndex?: number;
  bodySha256: string;
};

export type ReserveOutboundMessageResult = {
  record: OutboundMessageRecord;
  reserved: boolean;
};

type OutboundMessageRow = {
  id: string;
  inbound_message_id: string;
  user_id: string;
  reply_kind: OutboundReplyKind;
  chunk_index: number;
  whatsapp_message_id: string | null;
  status: OutboundMessageStatus;
  body_sha256: string;
  created_at: Date;
  sent_at: Date | null;
  error_code: string | null;
};

export function mapOutboundMessageRow(row: OutboundMessageRow): OutboundMessageRecord {
  return {
    id: row.id,
    inboundMessageId: row.inbound_message_id,
    userId: row.user_id,
    replyKind: row.reply_kind,
    chunkIndex: row.chunk_index,
    whatsappMessageId: row.whatsapp_message_id,
    status: row.status,
    bodySha256: row.body_sha256,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    errorCode: row.error_code
  };
}

export function createOutboundMessagesRepository(db: DbClient) {
  async function findByIdempotencyKey(input: {
    inboundMessageId: string;
    replyKind: OutboundReplyKind;
    chunkIndex: number;
  }): Promise<OutboundMessageRecord | null> {
    const result = await db.query<OutboundMessageRow>(
      `
        select *
        from outbound_messages
        where inbound_message_id = $1
          and reply_kind = $2
          and chunk_index = $3
      `,
      [input.inboundMessageId, input.replyKind, input.chunkIndex]
    );

    const row = result.rows[0];
    return row ? mapOutboundMessageRow(row) : null;
  }

  return {
    async reserve(input: ReserveOutboundMessageInput): Promise<ReserveOutboundMessageResult> {
      const chunkIndex = input.chunkIndex ?? 0;
      const result = await db.query<OutboundMessageRow>(
        `
          insert into outbound_messages (
            id,
            inbound_message_id,
            user_id,
            reply_kind,
            chunk_index,
            status,
            body_sha256
          )
          values ($1, $2, $3, $4, $5, 'pending', $6)
          on conflict (inbound_message_id, reply_kind, chunk_index) do update
            set
              status = 'pending',
              whatsapp_message_id = null,
              sent_at = null,
              error_code = null,
              body_sha256 = excluded.body_sha256
            where outbound_messages.status = 'failed'
          returning *
        `,
        [
          randomUUID(),
          input.inboundMessageId,
          input.userId,
          input.replyKind,
          chunkIndex,
          input.bodySha256
        ]
      );

      const insertedRow = result.rows[0];
      if (insertedRow) {
        return {
          record: mapOutboundMessageRow(insertedRow),
          reserved: true
        };
      }

      const existing = await findByIdempotencyKey({
        inboundMessageId: input.inboundMessageId,
        replyKind: input.replyKind,
        chunkIndex
      });
      if (!existing) {
        throw new Error('Outbound message insert conflicted but existing row was not found');
      }

      return {
        record: existing,
        reserved: false
      };
    },

    findByIdempotencyKey,

    async markSent(input: {
      id: string;
      whatsappMessageId: string;
      sentAt: Date;
    }): Promise<OutboundMessageRecord> {
      const result = await db.query<OutboundMessageRow>(
        `
          update outbound_messages
          set
            status = 'sent',
            whatsapp_message_id = $2,
            sent_at = $3,
            error_code = null
          where id = $1
          returning *
        `,
        [input.id, input.whatsappMessageId, input.sentAt]
      );

      const row = result.rows[0];
      if (!row) {
        throw new Error(`Outbound message ${input.id} was not found`);
      }

      return mapOutboundMessageRow(row);
    },

    async markFailed(input: { id: string; errorCode: string }): Promise<OutboundMessageRecord> {
      const result = await db.query<OutboundMessageRow>(
        `
          update outbound_messages
          set
            status = 'failed',
            error_code = $2
          where id = $1
          returning *
        `,
        [input.id, input.errorCode]
      );

      const row = result.rows[0];
      if (!row) {
        throw new Error(`Outbound message ${input.id} was not found`);
      }

      return mapOutboundMessageRow(row);
    }
  };
}
