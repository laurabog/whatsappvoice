import type { SummaryJobRecord } from '../db/repositories/summary-jobs.js';

export type JobStoreForWorker = {
  claimNextQueuedJob(
    workerId: string,
    staleProcessingBefore?: Date
  ): Promise<SummaryJobRecord | null>;
  findJobContext(jobId: string): Promise<{
    inboundMessage: {
      id: string;
    };
  } | null>;
  markFailed(input: {
    jobId: string;
    inboundMessageId: string;
    failedAt: Date;
    retryAt: Date | null;
    errorCode: string;
    errorDetailSanitized?: string | null;
  }): Promise<unknown>;
};

export type JobWorkerDependencies = {
  jobStore: JobStoreForWorker;
  workerId: string;
  processJob(jobId: string): Promise<unknown>;
  pollIntervalMs: number;
  activeJobTimeoutMs?: number;
  processingJobTimeoutMs: number;
  now?: () => Date;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  onError?: (error: unknown) => void;
};

export type JobWorker = {
  runOnce(): Promise<boolean>;
  start(): void;
  stop(): void;
};

function retryAtForAttempt(now: Date, attemptCount: number, maxAttempts: number): Date | null {
  if (attemptCount >= maxAttempts) {
    return null;
  }

  const delayMs = attemptCount <= 1 ? 30_000 : 120_000;
  return new Date(now.getTime() + delayMs);
}

function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 500);
  }

  return 'Unknown processing error';
}

function timeoutError(timeoutMs: number): Error {
  const error = new Error(`Audio job processing timed out after ${timeoutMs}ms`);
  error.name = 'TimeoutError';
  return error;
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(timeoutError(timeoutMs));
    }, timeoutMs);
  });
  operation.catch(() => undefined);

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export function createJobWorker(dependencies: JobWorkerDependencies): JobWorker {
  const now = dependencies.now ?? (() => new Date());
  const setIntervalFn = dependencies.setIntervalFn ?? setInterval;
  const clearIntervalFn = dependencies.clearIntervalFn ?? clearInterval;
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  async function runOnce(): Promise<boolean> {
    if (running) {
      return false;
    }

    running = true;
    try {
      const staleProcessingBefore = new Date(
        now().getTime() - dependencies.processingJobTimeoutMs
      );
      const job = await dependencies.jobStore.claimNextQueuedJob(
        dependencies.workerId,
        staleProcessingBefore
      );
      if (!job) {
        return false;
      }

      try {
        await withTimeout(
          dependencies.processJob(job.id),
          dependencies.activeJobTimeoutMs ?? dependencies.processingJobTimeoutMs
        );
      } catch (error) {
        await dependencies.jobStore.markFailed({
          jobId: job.id,
          inboundMessageId: job.inboundMessageId,
          failedAt: now(),
          retryAt: retryAtForAttempt(now(), job.attemptCount, job.maxAttempts),
          errorCode: 'processing_failed',
          errorDetailSanitized: sanitizeError(error)
        });
      }

      return true;
    } finally {
      running = false;
    }
  }

  return {
    runOnce,

    start() {
      if (timer) {
        return;
      }

      timer = setIntervalFn(() => {
        void runOnce().catch(dependencies.onError ?? (() => undefined));
      }, dependencies.pollIntervalMs);
    },

    stop() {
      if (!timer) {
        return;
      }

      clearIntervalFn(timer);
      timer = null;
    }
  };
}
