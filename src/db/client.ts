import pg from 'pg';
import type { AppConfig } from '../config.js';

const { Pool } = pg;

export type DbPool = pg.Pool;
export type DbClient = pg.PoolClient | pg.Pool;

export function createDbPool(config: AppConfig): DbPool {
  if (!config.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for database access');
  }

  return new Pool({
    connectionString: config.DATABASE_URL
  });
}
