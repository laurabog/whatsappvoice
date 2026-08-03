import { randomUUID } from 'node:crypto';
import type { DbClient } from '../client.js';

export type UserRecord = {
  id: string;
  whatsappUserId: string;
  displayName: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  isBlocked: boolean;
};

export type UpsertUserInput = {
  whatsappUserId: string;
  displayName?: string | null;
};

type UserRow = {
  id: string;
  whatsapp_user_id: string;
  display_name: string | null;
  created_at: Date;
  last_seen_at: Date;
  is_blocked: boolean;
};

export function mapUserRow(row: UserRow): UserRecord {
  return {
    id: row.id,
    whatsappUserId: row.whatsapp_user_id,
    displayName: row.display_name,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    isBlocked: row.is_blocked
  };
}

export function createUsersRepository(db: DbClient) {
  return {
    async upsertFromWhatsApp(input: UpsertUserInput): Promise<UserRecord> {
      const result = await db.query<UserRow>(
        `
          insert into users (id, whatsapp_user_id, display_name)
          values ($1, $2, $3)
          on conflict (whatsapp_user_id)
          do update set
            display_name = coalesce(excluded.display_name, users.display_name),
            last_seen_at = now()
          returning *
        `,
        [randomUUID(), input.whatsappUserId, input.displayName ?? null]
      );

      const row = result.rows[0];
      if (!row) {
        throw new Error('User upsert returned no row');
      }

      return mapUserRow(row);
    },

    async findByWhatsAppUserId(whatsappUserId: string): Promise<UserRecord | null> {
      const result = await db.query<UserRow>(
        'select * from users where whatsapp_user_id = $1',
        [whatsappUserId]
      );

      const row = result.rows[0];
      return row ? mapUserRow(row) : null;
    }
  };
}
