import { randomUUID } from 'node:crypto';
import type { DbClient } from '../client.js';

export type InboundMessageStatus =
  | 'received'
  | 'ignored'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed';

export type InboundMessageRecord = {
  id: string;
  whatsappMessageId: string;
  userId: string;
  messageType: string;
  receivedAt: Date;
  whatsappTimestamp: Date | null;
  mediaId: string | null;
  mimeType: string | null;
  isVoiceNote: boolean | null;
  textBody: string | null;
  status: InboundMessageStatus;
  errorCode: string | null;
};

export type InsertInboundMessageInput = {
  whatsappMessageId: string;
  userId: string;
  messageType: string;
  whatsappTimestamp?: Date | null;
  mediaId?: string | null;
  mimeType?: string | null;
  isVoiceNote?: boolean | null;
  textBody?: string | null;
  status?: InboundMessageStatus;
};

export type InsertInboundMessageResult = {
  record: InboundMessageRecord;
  inserted: boolean;
};

type InboundMessageRow = {
  id: string;
  whatsapp_message_id: string;
  user_id: string;
  message_type: string;
  received_at: Date;
  whatsapp_timestamp: Date | null;
  media_id: string | null;
  mime_type: string | null;
  is_voice_note: boolean | null;
  text_body: string | null;
  status: InboundMessageStatus;
  error_code: string | null;
};

export function mapInboundMessageRow(row: InboundMessageRow): InboundMessageRecord {
  return {
    id: row.id,
    whatsappMessageId: row.whatsapp_message_id,
    userId: row.user_id,
    messageType: row.message_type,
    receivedAt: row.received_at,
    whatsappTimestamp: row.whatsapp_timestamp,
    mediaId: row.media_id,
    mimeType: row.mime_type,
    isVoiceNote: row.is_voice_note,
    textBody: row.text_body,
    status: row.status,
    errorCode: row.error_code
  };
}

export function createInboundMessagesRepository(db: DbClient) {
  async function findByWhatsAppMessageId(
    whatsappMessageId: string
  ): Promise<InboundMessageRecord | null> {
    const result = await db.query<InboundMessageRow>(
      'select * from inbound_messages where whatsapp_message_id = $1',
      [whatsappMessageId]
    );

    const row = result.rows[0];
    return row ? mapInboundMessageRow(row) : null;
  }

  return {
    async insertIfNew(input: InsertInboundMessageInput): Promise<InsertInboundMessageResult> {
      const insertResult = await db.query<InboundMessageRow>(
        `
          insert into inbound_messages (
            id,
            whatsapp_message_id,
            user_id,
            message_type,
            whatsapp_timestamp,
            media_id,
            mime_type,
            is_voice_note,
            text_body,
            status
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          on conflict (whatsapp_message_id) do nothing
          returning *
        `,
        [
          randomUUID(),
          input.whatsappMessageId,
          input.userId,
          input.messageType,
          input.whatsappTimestamp ?? null,
          input.mediaId ?? null,
          input.mimeType ?? null,
          input.isVoiceNote ?? null,
          input.textBody ?? null,
          input.status ?? 'received'
        ]
      );

      const insertedRow = insertResult.rows[0];
      if (insertedRow) {
        return {
          record: mapInboundMessageRow(insertedRow),
          inserted: true
        };
      }

      const existing = await findByWhatsAppMessageId(input.whatsappMessageId);
      if (!existing) {
        throw new Error('Inbound message insert conflicted but existing row was not found');
      }

      return {
        record: existing,
        inserted: false
      };
    },

    findByWhatsAppMessageId,

    async updateStatus(
      id: string,
      status: InboundMessageStatus,
      errorCode?: string | null
    ): Promise<InboundMessageRecord> {
      const result = await db.query<InboundMessageRow>(
        `
          update inbound_messages
          set status = $2, error_code = $3
          where id = $1
          returning *
        `,
        [id, status, errorCode ?? null]
      );

      const row = result.rows[0];
      if (!row) {
        throw new Error(`Inbound message ${id} was not found`);
      }

      return mapInboundMessageRow(row);
    },

    async countAcceptedAudioForUserSince(userId: string, since: Date): Promise<number> {
      const result = await db.query<{ count: string }>(
        `
          select count(*)::text as count
          from inbound_messages
          where user_id = $1
            and received_at >= $2
            and message_type = 'audio'
            and status in ('queued', 'processing', 'completed')
        `,
        [userId, since]
      );

      return Number(result.rows[0]?.count ?? 0);
    },

    async findLatestQueuedOrProcessingAudioForUserSince(
      userId: string,
      since: Date
    ): Promise<InboundMessageRecord | null> {
      const result = await db.query<InboundMessageRow>(
        `
          select *
          from inbound_messages
          where user_id = $1
            and message_type = 'audio'
            and status in ('queued', 'processing')
            and coalesce(whatsapp_timestamp, received_at) >= $2
          order by coalesce(whatsapp_timestamp, received_at) desc, received_at desc
          limit 1
        `,
        [userId, since]
      );

      const row = result.rows[0];
      return row ? mapInboundMessageRow(row) : null;
    }
  };
}
