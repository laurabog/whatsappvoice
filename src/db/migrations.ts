import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Pool } from 'pg';
import { loadConfig } from '../config.js';
import { createDbPool } from './client.js';

export type AppliedMigration = {
  filename: string;
};

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(currentFilePath), '../..');
const defaultMigrationsDir = path.join(projectRoot, 'migrations');

export async function applyMigrations(
  pool: Pool,
  migrationsDir = defaultMigrationsDir
): Promise<AppliedMigration[]> {
  await pool.query(`
    create table if not exists schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const applied: AppliedMigration[] = [];

  for (const filename of files) {
    const alreadyApplied = await pool.query(
      'select 1 from schema_migrations where filename = $1',
      [filename]
    );

    if (alreadyApplied.rowCount) {
      continue;
    }

    const sql = await readFile(path.join(migrationsDir, filename), 'utf8');
    const client = await pool.connect();

    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into schema_migrations (filename) values ($1)', [filename]);
      await client.query('commit');
      applied.push({ filename });
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  return applied;
}

async function runCli() {
  const config = loadConfig();
  const pool = createDbPool(config);

  try {
    const applied = await applyMigrations(pool);
    if (applied.length === 0) {
      console.log('No pending migrations.');
      return;
    }

    for (const migration of applied) {
      console.log(`Applied ${migration.filename}`);
    }
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';

if (import.meta.url === invokedPath) {
  await runCli();
}
