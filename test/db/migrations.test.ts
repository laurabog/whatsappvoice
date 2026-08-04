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

describe('targeted sender labels migration', () => {
  it('adds targeted pending labels without creating a new table', async () => {
    const sql = await readFile('migrations/0003_targeted_sender_labels.sql', 'utf8');

    expect(sql).toContain('target_inbound_message_id');
    expect(sql).toContain('pending_sender_labels_target_unconsumed_idx');
    expect(sql).toContain('references inbound_messages(id)');
  });
});

describe('progress reply kind migration', () => {
  it('allows idempotent slow-job progress messages', async () => {
    const sql = await readFile('migrations/0004_progress_reply_kind.sql', 'utf8');

    expect(sql).toContain('outbound_messages_reply_kind_check');
    expect(sql).toContain("'progress'");
  });
});
