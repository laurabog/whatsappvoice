import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations } from '../../src/db/migrations.js';
import { createInboundMessagesRepository } from '../../src/db/repositories/inbound-messages.js';
import { createOutboundMessagesRepository } from '../../src/db/repositories/outbound-messages.js';
import { createSummaryJobsRepository } from '../../src/db/repositories/summary-jobs.js';
import { createUsersRepository } from '../../src/db/repositories/users.js';

const { Pool } = pg;
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDb = testDatabaseUrl ? describe : describe.skip;

describeWithDb('database repositories', () => {
  const pool = new Pool({
    connectionString: testDatabaseUrl
  });

  beforeAll(async () => {
    await applyMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('inserts and fetches users, inbound messages, and jobs', async () => {
    const users = createUsersRepository(pool);
    const inboundMessages = createInboundMessagesRepository(pool);
    const summaryJobs = createSummaryJobsRepository(pool);
    const outboundMessages = createOutboundMessagesRepository(pool);

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await users.upsertFromWhatsApp({
      whatsappUserId: `whatsapp-${uniqueSuffix}`,
      displayName: 'Test User'
    });

    const fetchedUser = await users.findByWhatsAppUserId(user.whatsappUserId);
    expect(fetchedUser?.id).toBe(user.id);

    const inbound = await inboundMessages.insertIfNew({
      whatsappMessageId: `wamid.${uniqueSuffix}`,
      userId: user.id,
      messageType: 'audio',
      mediaId: `media-${uniqueSuffix}`,
      mimeType: 'audio/ogg',
      isVoiceNote: true,
      status: 'queued'
    });

    expect(inbound.inserted).toBe(true);

    const duplicate = await inboundMessages.insertIfNew({
      whatsappMessageId: `wamid.${uniqueSuffix}`,
      userId: user.id,
      messageType: 'audio'
    });

    expect(duplicate.inserted).toBe(false);
    expect(duplicate.record.id).toBe(inbound.record.id);

    const job = await summaryJobs.createForInboundMessage(inbound.record.id);
    const fetchedJob = await summaryJobs.findByInboundMessageId(inbound.record.id);

    expect(job.status).toBe('queued');
    expect(fetchedJob?.id).toBe(job.id);

    const outbound = await outboundMessages.reserve({
      inboundMessageId: inbound.record.id,
      userId: user.id,
      replyKind: 'summary',
      bodySha256: 'first-hash'
    });
    expect(outbound.reserved).toBe(true);

    await outboundMessages.markFailed({
      id: outbound.record.id,
      errorCode: 'send_failed'
    });

    const retry = await outboundMessages.reserve({
      inboundMessageId: inbound.record.id,
      userId: user.id,
      replyKind: 'summary',
      bodySha256: 'retry-hash'
    });
    expect(retry.reserved).toBe(true);
    expect(retry.record.id).toBe(outbound.record.id);
    expect(retry.record.status).toBe('pending');
    expect(retry.record.bodySha256).toBe('retry-hash');
  });
});
