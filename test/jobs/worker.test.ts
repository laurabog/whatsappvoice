import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SummaryJobRecord } from '../../src/db/repositories/summary-jobs.js';
import { createJobWorker } from '../../src/jobs/worker.js';

const now = new Date('2026-08-03T12:00:00.000Z');

afterEach(() => {
  vi.useRealTimers();
});

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
      markFailed: vi.fn(async () => makeJob({ status: 'retryable_failed', attemptCount: 1 }))
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

  it('marks stuck active jobs retryable after the active job timeout', async () => {
    vi.useFakeTimers();
    const jobStore = {
      claimNextQueuedJob: vi.fn(async () => makeJob({ attemptCount: 1 })),
      findJobContext: vi.fn(),
      markFailed: vi.fn(async () => makeJob({ status: 'retryable_failed', attemptCount: 1 }))
    };
    const worker = createJobWorker({
      jobStore,
      workerId: 'worker-1',
      processJob: vi.fn(() => new Promise(() => undefined)),
      pollIntervalMs: 5000,
      activeJobTimeoutMs: 10_000,
      processingJobTimeoutMs: 15 * 60 * 1000,
      now: () => now
    });
    const run = worker.runOnce();

    await vi.advanceTimersByTimeAsync(10_000);

    await expect(run).resolves.toBe(true);
    expect(jobStore.findJobContext).not.toHaveBeenCalled();
    expect(jobStore.markFailed).toHaveBeenCalledWith({
      jobId: 'job-1',
      inboundMessageId: 'inbound-1',
      failedAt: now,
      retryAt: new Date('2026-08-03T12:00:30.000Z'),
      errorCode: 'processing_failed',
      errorDetailSanitized: 'Audio job processing timed out after 10000ms'
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

  it('reports terminal failures to the optional callback', async () => {
    const terminalJob = makeJob({ status: 'terminal_failed', attemptCount: 3 });
    const onTerminalJobFailed = vi.fn();
    const jobStore = {
      claimNextQueuedJob: vi.fn(async () => makeJob({ attemptCount: 3 })),
      findJobContext: vi.fn(),
      markFailed: vi.fn(async () => terminalJob)
    };
    const worker = createJobWorker({
      jobStore,
      workerId: 'worker-1',
      processJob: vi.fn(async () => {
        throw new Error('final failure');
      }),
      pollIntervalMs: 5000,
      processingJobTimeoutMs: 15 * 60 * 1000,
      now: () => now,
      onTerminalJobFailed
    });

    await expect(worker.runOnceDetailed()).resolves.toEqual({
      attempted: true,
      jobId: 'job-1',
      inboundMessageId: 'inbound-1',
      outcome: 'terminal_failed'
    });
    expect(onTerminalJobFailed).toHaveBeenCalledWith(terminalJob);
  });
});
