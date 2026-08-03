import { randomUUID } from 'node:crypto';
import type { DbClient } from '../client.js';

export type PendingSenderLabelRecord = {
  id: string;
  userId: string;
  label: string;
  normalizedLabel: string;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
};

type PendingSenderLabelRow = {
  id: string;
  user_id: string;
  label: string;
  normalized_label: string;
  created_at: Date;
  expires_at: Date;
  consumed_at: Date | null;
};

export function mapPendingSenderLabelRow(row: PendingSenderLabelRow): PendingSenderLabelRecord {
  return {
    id: row.id,
    userId: row.user_id,
    label: row.label,
    normalizedLabel: row.normalized_label,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at
  };
}

export function createPendingSenderLabelsRepository(db: DbClient) {
  return {
    async createPendingLabel(input: {
      userId: string;
      label: string;
      normalizedLabel: string;
      expiresAt: Date;
    }): Promise<PendingSenderLabelRecord> {
      await db.query(
        `
          update pending_sender_labels
          set consumed_at = now()
          where user_id = $1
            and consumed_at is null
        `,
        [input.userId]
      );

      const result = await db.query<PendingSenderLabelRow>(
        `
          insert into pending_sender_labels (
            id,
            user_id,
            label,
            normalized_label,
            expires_at
          )
          values ($1, $2, $3, $4, $5)
          returning *
        `,
        [randomUUID(), input.userId, input.label, input.normalizedLabel, input.expiresAt]
      );

      const row = result.rows[0];
      if (!row) {
        throw new Error('Pending sender label insert returned no row');
      }

      return mapPendingSenderLabelRow(row);
    },

    async deleteForUser(userId: string): Promise<number> {
      const result = await db.query('delete from pending_sender_labels where user_id = $1', [
        userId
      ]);
      return result.rowCount ?? 0;
    },

    async consumeLatestForUser(userId: string, now: Date): Promise<PendingSenderLabelRecord | null> {
      const result = await db.query<PendingSenderLabelRow>(
        `
          update pending_sender_labels
          set consumed_at = $2
          where id = (
            select id
            from pending_sender_labels
            where user_id = $1
              and consumed_at is null
              and expires_at > $2
            order by created_at desc
            limit 1
          )
          returning *
        `,
        [userId, now]
      );

      const row = result.rows[0];
      return row ? mapPendingSenderLabelRow(row) : null;
    }
  };
}
