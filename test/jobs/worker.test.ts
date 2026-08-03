import { describe, expect, it, vi } from 'vitest';
import type { SummaryJobRecord } from '../../src/db/repositories/summary-jobs.js';
import { createJobWorker } from '../../src/jobs/worker.js';

const now = new Date('2026-08-03T12:00:00.000Z');

function makeJob(overrides: Partial<SummaryJobRecord> = {}): SummaryJobRecord {
  return {
    id: 'job-1',
    inboundMessageId: 'inbound-1',
    status: 'queued',
    attemptCount: 1,
    maxAttempts: 3,
    nextAttemptAt: now,
    lockedAt: null,
    lockedBy: null,
    startedAt: null,
    completedAt: null,
    downloadLatencyMs: null,
    transcriptionLatencyMs: null,
    summaryLatencyMs: null,
    totalLatencyMs: null,
    errorCode: null,
    errorDetailSanitized: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

describe('createJobWorker', () => {
  it('claims and processes one queued job', async () => {
    const processJob = vi.fn(async () => undefined);
    const jobStore = {
      claimNextQueuedJob: vi.fn(async () => makeJob()),
      findJobContext: vi.fn(),
      markFailed: vi.fn()
    };
    const worker = createJobWorker({
      jobStore,
      workerId: 'worker-1',
      processJob,
      pollIntervalMs: 5000,
      processingJobTimeoutMs: 15 * 60 * 1000,
      now: () => now
    });

    await expect(worker.runOnce()).resolves.toBe(true);

    expect(jobStore.claimNextQueuedJob).toHaveBeenCalledWith(
      'worker-1',
      new Date('2026-08-03T11:45:00.000Z')
    );
    expect(processJob).toHaveBeenCalledWith('job-1');
    expect(jobStore.markFailed).not.toHaveBeenCalled();
  });

  it('marks processing failures retryable before attempts are exhausted', async () => {
    const jobStore = {
      claimNextQueuedJob: vi.fn(async () => makeJob({ attemptCount: 1 })),
      findJobContext: vi.fn(async () => ({
        inboundMessage: {
          id: 'inbound-1'
        }
      })),
      markFailed: vi.fn(async () => ({}))
    };
    const worker = createJobWorker({
      jobStore,
      workerId: 'worker-1',
      processJob: vi.fn(async () => {
        throw new Error('fake failure');
      }),
      pollIntervalMs: 5000,
      processingJobTimeoutMs: 15 * 60 * 1000,
      now: () => now
    });

    await expect(worker.runOnce()).resolves.toBe(true);

    expect(jobStore.markFailed).toHaveBeenCalledWith({
      jobId: 'job-1',
      inboundMessageId: 'inbound-1',
      failedAt: now,
      retryAt: new Date('2026-08-03T12:00:30.000Z'),
      errorCode: 'processing_failed',
      errorDetailSanitized: 'fake failure'
    });
  });

  it('returns false when no job is available', async () => {
    const jobStore = {
      claimNextQueuedJob: vi.fn(async () => null),
      findJobContext: vi.fn(),
      markFailed: vi.fn()
    };
    const worker = createJobWorker({
      jobStore,
      workerId: 'worker-1',
      processJob: vi.fn(),
      pollIntervalMs: 5000,
      processingJobTimeoutMs: 15 * 60 * 1000
    });

    await expect(worker.runOnce()).resolves.toBe(false);
  });
});
