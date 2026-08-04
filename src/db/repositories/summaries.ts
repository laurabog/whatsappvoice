import { randomUUID } from 'node:crypto';
import type { DbClient } from '../client.js';

export type SummaryRecord = {
  id: string;
  userId: string;
  inboundMessageId: string;
  referenceCode: string | null;
  fromLabel: string;
  fromLabelConfidence: string;
  oneSentenceSummary: string;
  shortSummary: string;
  importantPoints: unknown[];
  questionsOrRequests: unknown[];
  datesOrCommitments: unknown[];
  replyNeeded: boolean;
  listeningRecommendation: string;
  createdAt: Date;
  expiresAt: Date;
  deletedAt: Date | null;
};

export type SummaryRecordWithReceivedAt = SummaryRecord & {
  receivedAt: Date;
};

export type InsertSummaryInput = {
  userId: string;
  inboundMessageId: string;
  referenceCode?: string | null;
  fromLabel: string;
  fromLabelConfidence: string;
  oneSentenceSummary: string;
  shortSummary: string;
  importantPoints: unknown[];
  questionsOrRequests: unknown[];
  datesOrCommitments: unknown[];
  replyNeeded: boolean;
  listeningRecommendation: string;
  expiresAt: Date;
};

export type InsertSummaryResult = {
  record: SummaryRecord;
  inserted: boolean;
};

type SummaryRow = {
  id: string;
  user_id: string;
  inbound_message_id: string;
  reference_code: string | null;
  from_label: string;
  from_label_confidence: string;
  one_sentence_summary: string;
  short_summary: string;
  important_points_json: unknown[];
  questions_or_requests_json: unknown[];
  dates_or_commitments_json: unknown[];
  reply_needed: boolean;
  listening_recommendation: string;
  created_at: Date;
  expires_at: Date;
  deleted_at: Date | null;
};

export function mapSummaryRow(row: SummaryRow): SummaryRecord {
  return {
    id: row.id,
    userId: row.user_id,
    inboundMessageId: row.inbound_message_id,
    referenceCode: row.reference_code,
    fromLabel: row.from_label,
    fromLabelConfidence: row.from_label_confidence,
    oneSentenceSummary: row.one_sentence_summary,
    shortSummary: row.short_summary,
    importantPoints: row.important_points_json,
    questionsOrRequests: row.questions_or_requests_json,
    datesOrCommitments: row.dates_or_commitments_json,
    replyNeeded: row.reply_needed,
    listeningRecommendation: row.listening_recommendation,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    deletedAt: row.deleted_at
  };
}

export function createSummariesRepository(db: DbClient) {
  async function findByInboundMessageId(inboundMessageId: string): Promise<SummaryRecord | null> {
    const result = await db.query<SummaryRow>(
      'select * from summaries where inbound_message_id = $1',
      [inboundMessageId]
    );

    const row = result.rows[0];
    return row ? mapSummaryRow(row) : null;
  }

  return {
    async insertIfNew(input: InsertSummaryInput): Promise<InsertSummaryResult> {
      const result = await db.query<SummaryRow>(
        `
          insert into summaries (
            id,
            user_id,
            inbound_message_id,
            reference_code,
            from_label,
            from_label_confidence,
            one_sentence_summary,
            short_summary,
            important_points_json,
            questions_or_requests_json,
            dates_or_commitments_json,
            reply_needed,
            listening_recommendation,
            expires_at
          )
          values (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9::jsonb,
            $10::jsonb,
            $11::jsonb,
            $12,
            $13,
            $14
          )
          on conflict (inbound_message_id) do nothing
          returning *
        `,
        [
          randomUUID(),
          input.userId,
          input.inboundMessageId,
          input.referenceCode ?? null,
          input.fromLabel,
          input.fromLabelConfidence,
          input.oneSentenceSummary,
          input.shortSummary,
          JSON.stringify(input.importantPoints),
          JSON.stringify(input.questionsOrRequests),
          JSON.stringify(input.datesOrCommitments),
          input.replyNeeded,
          input.listeningRecommendation,
          input.expiresAt
        ]
      );

      const insertedRow = result.rows[0];
      if (insertedRow) {
        return {
          record: mapSummaryRow(insertedRow),
          inserted: true
        };
      }

      const existing = await findByInboundMessageId(input.inboundMessageId);
      if (!existing) {
        throw new Error('Summary insert conflicted but existing row was not found');
      }

      return {
        record: existing,
        inserted: false
      };
    },

    findByInboundMessageId,

    async findLatestActiveForUserSince(input: {
      userId: string;
      receivedAfter: Date;
      now: Date;
    }): Promise<SummaryRecordWithReceivedAt | null> {
      const result = await db.query<SummaryRow & { display_received_at: Date }>(
        `
          select s.*, coalesce(i.whatsapp_timestamp, i.received_at) as display_received_at
          from summaries s
          join inbound_messages i on i.id = s.inbound_message_id
          where s.user_id = $1
            and s.deleted_at is null
            and s.expires_at > $2
            and coalesce(i.whatsapp_timestamp, i.received_at) >= $3
          order by coalesce(i.whatsapp_timestamp, i.received_at) desc, s.created_at desc
          limit 1
        `,
        [input.userId, input.now, input.receivedAfter]
      );

      const row = result.rows[0];
      return row
        ? {
            ...mapSummaryRow(row),
            receivedAt: row.display_received_at
          }
        : null;
    },

    async updateLabel(input: {
      summaryId: string;
      fromLabel: string;
      fromLabelConfidence: string;
    }): Promise<SummaryRecord> {
      const result = await db.query<SummaryRow>(
        `
          update summaries
          set from_label = $2,
              from_label_confidence = $3
          where id = $1
            and deleted_at is null
          returning *
        `,
        [input.summaryId, input.fromLabel, input.fromLabelConfidence]
      );

      const row = result.rows[0];
      if (!row) {
        throw new Error(`Summary ${input.summaryId} was not found`);
      }

      return mapSummaryRow(row);
    },

    async countForUserSince(userId: string, since: Date): Promise<number> {
      const result = await db.query<{ count: string }>(
        `
          select count(*)::text as count
          from summaries
          where user_id = $1
            and created_at >= $2
            and deleted_at is null
        `,
        [userId, since]
      );

      return Number(result.rows[0]?.count ?? 0);
    },

    async softDeleteForUser(userId: string, deletedAt: Date): Promise<number> {
      const result = await db.query(
        `
          update summaries
          set deleted_at = $2
          where user_id = $1
            and deleted_at is null
        `,
        [userId, deletedAt]
      );

      return result.rowCount ?? 0;
    },

    async softDeleteExpired(now: Date): Promise<number> {
      const result = await db.query(
        `
          update summaries
          set deleted_at = $1
          where expires_at <= $1
            and deleted_at is null
        `,
        [now]
      );

      return result.rowCount ?? 0;
    }
  };
}
