import { randomUUID } from 'node:crypto';
import type { DbClient } from '../client.js';

export type TranscriptRecord = {
  id: string;
  userId: string;
  inboundMessageId: string;
  summaryId: string;
  text: string;
  characterCount: number;
  createdAt: Date;
  expiresAt: Date;
  deletedAt: Date | null;
};

export type InsertTranscriptInput = {
  userId: string;
  inboundMessageId: string;
  summaryId: string;
  text: string;
  expiresAt: Date;
};

export type InsertTranscriptResult = {
  record: TranscriptRecord;
  inserted: boolean;
};

type TranscriptRow = {
  id: string;
  user_id: string;
  inbound_message_id: string;
  summary_id: string;
  text: string;
  character_count: number;
  created_at: Date;
  expires_at: Date;
  deleted_at: Date | null;
};

export function mapTranscriptRow(row: TranscriptRow): TranscriptRecord {
  return {
    id: row.id,
    userId: row.user_id,
    inboundMessageId: row.inbound_message_id,
    summaryId: row.summary_id,
    text: row.text,
    characterCount: row.character_count,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    deletedAt: row.deleted_at
  };
}

export function createTranscriptsRepository(db: DbClient) {
  async function findByInboundMessageId(
    inboundMessageId: string
  ): Promise<TranscriptRecord | null> {
    const result = await db.query<TranscriptRow>(
      'select * from transcripts where inbound_message_id = $1',
      [inboundMessageId]
    );

    const row = result.rows[0];
    return row ? mapTranscriptRow(row) : null;
  }

  return {
    async insertIfNew(input: InsertTranscriptInput): Promise<InsertTranscriptResult> {
      const result = await db.query<TranscriptRow>(
        `
          insert into transcripts (
            id,
            user_id,
            inbound_message_id,
            summary_id,
            text,
            character_count,
            expires_at
          )
          values ($1, $2, $3, $4, $5, $6, $7)
          on conflict (inbound_message_id) do nothing
          returning *
        `,
        [
          randomUUID(),
          input.userId,
          input.inboundMessageId,
          input.summaryId,
          input.text,
          input.text.length,
          input.expiresAt
        ]
      );

      const insertedRow = result.rows[0];
      if (insertedRow) {
        return {
          record: mapTranscriptRow(insertedRow),
          inserted: true
        };
      }

      const existing = await findByInboundMessageId(input.inboundMessageId);
      if (!existing) {
        throw new Error('Transcript insert conflicted but existing row was not found');
      }

      return {
        record: existing,
        inserted: false
      };
    },

    findByInboundMessageId,

    async findLatestAvailableForUser(userId: string, now: Date): Promise<TranscriptRecord | null> {
      const result = await db.query<TranscriptRow>(
        `
          select *
          from transcripts
          where user_id = $1
            and expires_at > $2
            and deleted_at is null
          order by created_at desc
          limit 1
        `,
        [userId, now]
      );

      const row = result.rows[0];
      return row ? mapTranscriptRow(row) : null;
    },

    async softDeleteForUser(userId: string, deletedAt: Date): Promise<number> {
      const result = await db.query(
        `
          update transcripts
          set deleted_at = $2
          where user_id = $1
            and deleted_at is null
        `,
        [userId, deletedAt]
      );

      return result.rowCount ?? 0;
    }
  };
}
