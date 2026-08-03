import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('initial migration', () => {
  it('creates the core Ticket 2 tables and idempotency constraints', async () => {
    const sql = await readFile('migrations/0001_initial.sql', 'utf8');

    expect(sql).toContain('create table if not exists users');
    expect(sql).toContain('create table if not exists inbound_messages');
    expect(sql).toContain('create table if not exists summary_jobs');
    expect(sql).toContain('create table if not exists summaries');
    expect(sql).toContain('create table if not exists transcripts');
    expect(sql).toContain('create table if not exists outbound_messages');
    expect(sql).toContain('unique index if not exists outbound_messages_idempotency_idx');
  });
});
