import { loadConfig } from '../config.js';
import { createDbPool } from '../db/client.js';
import { createAudioWorkerRuntime } from '../jobs/audio-worker-runtime.js';
import { createLogger } from '../observability/logger.js';

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function maxJobsFromArgs(): number {
  const value = argValue('max-jobs');
  if (!value) {
    return 1;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 1;
}

const config = loadConfig();
const db = createDbPool(config);
const logger = createLogger(config.NODE_ENV);
const runtime = createAudioWorkerRuntime({ config, db, logger });

try {
  const drain = await runtime.drainJobs({
    maxJobs: maxJobsFromArgs()
  });
  const cleanup = hasFlag('cleanup') ? await runtime.runRetentionCleanup() : null;

  console.log(JSON.stringify({ drain, cleanup }, null, 2));
} finally {
  await db.end();
}
