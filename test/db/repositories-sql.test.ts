import { describe, expect, it, vi } from 'vitest';
import type { DbClient } from '../../src/db/client.js';
import { createPendingSenderLabelsRepository } from '../../src/db/repositories/pending-sender-labels.js';
import { createSummariesRepository } from '../../src/db/repositories/summaries.js';

const now = new Date('2026-08-03T12:00:00.000Z');
const expiresAt = new Date('2026-08-03T12:30:00.000Z');

function makeDb(results: unknown[]) {
  const db = {
    query: vi.fn(async () => {
      const result = results.shift();
      if (!result) {
        return {
          rows: [],
          rowCount: 0
        };
      }

      return result;
    })
  };

  return db as typeof db & DbClient;
}

function pendingLabelRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'label-id',
    user_id: 'user-1',
    target_inbound_message_id: 'inbound-1',
    label: 'Laura',
    normalized_label: 'laura',
    created_at: now,
    expires_at: expiresAt,
    consumed_at: null,
    ...overrides
  };
}

function summaryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'summary-1',
    user_id: 'user-1',
    inbound_message_id: 'inbound-1',
    reference_code: null,
    from_label: 'unknown sender',
    from_label_confidence: 'unknown',
    one_sentence_summary: 'Laura asks about dinner.',
    short_summary: 'Laura asks about dinner Friday.',
    important_points_json: [],
    questions_or_requests_json: [],
    dates_or_commitments_json: [],
    reply_needed: false,
    listening_recommendation: 'summary_enough',
    created_at: now,
    expires_at: new Date('2026-09-02T12:00:00.000Z'),
    deleted_at: null,
    ...overrides
  };
}

describe('repository SQL behavior', () => {
  it('creates targeted pending labels and preserves the target in the record', async () => {
    const db = makeDb([
      {
        rows: [],
        rowCount: 1
      },
      {
        rows: [pendingLabelRow()],
        rowCount: 1
      }
    ]);
    const pendingSenderLabels = createPendingSenderLabelsRepository(db);

    await expect(
      pendingSenderLabels.createPendingLabel({
        userId: 'user-1',
        targetInboundMessageId: 'inbound-1',
        label: 'Laura',
        normalizedLabel: 'laura',
        expiresAt
      })
    ).resolves.toMatchObject({
      targetInboundMessageId: 'inbound-1',
      label: 'Laura'
    });

    expect(db.query).toHaveBeenNthCalledWith(1, expect.any(String), ['user-1', 'inbound-1']);
    expect(db.query).toHaveBeenNthCalledWith(2, expect.any(String), [
      expect.any(String),
      'user-1',
      'inbound-1',
      'Laura',
      'laura',
      expiresAt
    ]);
  });

  it('consumes a targeted pending label before falling back to untargeted labels', async () => {
    const db = makeDb([
      {
        rows: [
          pendingLabelRow({
            consumed_at: now
          })
        ],
        rowCount: 1
      }
    ]);
    const pendingSenderLabels = createPendingSenderLabelsRepository(db);

    await expect(
      pendingSenderLabels.consumeLatestForInboundMessage('user-1', 'inbound-1', now)
    ).resolves.toMatchObject({
      targetInboundMessageId: 'inbound-1',
      consumedAt: now
    });

    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query).toHaveBeenCalledWith(expect.any(String), ['user-1', 'inbound-1', now]);
  });

  it('finds and updates the latest active summary label', async () => {
    const receivedAt = new Date('2026-08-03T11:58:00.000Z');
    const db = makeDb([
      {
        rows: [
          {
            ...summaryRow(),
            display_received_at: receivedAt
          }
        ],
        rowCount: 1
      },
      {
        rows: [
          summaryRow({
            from_label: 'Laura',
            from_label_confidence: 'user_provided'
          })
        ],
        rowCount: 1
      }
    ]);
    const summaries = createSummariesRepository(db);

    await expect(
      summaries.findLatestActiveForUserSince({
        userId: 'user-1',
        receivedAfter: new Date('2026-08-03T11:50:00.000Z'),
        now
      })
    ).resolves.toMatchObject({
      id: 'summary-1',
      receivedAt
    });

    await expect(
      summaries.updateLabel({
        summaryId: 'summary-1',
        fromLabel: 'Laura',
        fromLabelConfidence: 'user_provided'
      })
    ).resolves.toMatchObject({
      fromLabel: 'Laura',
      fromLabelConfidence: 'user_provided'
    });
  });
});
