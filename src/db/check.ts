import { loadConfig } from '../config.js';
import { createDbPool } from './client.js';

const config = loadConfig();
const pool = createDbPool(config);

try {
  const result = await pool.query<{
    database_name: string;
    server_version: string;
  }>('select current_database() as database_name, version() as server_version');

  const row = result.rows[0];
  if (!row) {
    throw new Error('Database check returned no rows');
  }

  console.log(`Connected to database: ${row.database_name}`);
  console.log(row.server_version);
} finally {
  await pool.end();
}
