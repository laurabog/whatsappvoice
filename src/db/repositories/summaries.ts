import type { DbClient } from '../client.js';

export function createSummariesRepository(db: DbClient) {
  return {
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
    }
  };
}
