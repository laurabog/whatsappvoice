import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const apps: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function buildTestApp() {
  const handlers = {
    drainJobs: vi.fn(async () => ({
      ok: true as const,
      processed: 1,
      completed: 1,
      retryableFailed: 0,
      terminalFailed: 0,
      empty: false
    })),
    runRetentionCleanup: vi.fn(async () => ({
      summariesSoftDeleted: 0,
      transcriptsSoftDeleted: 0,
      pendingSenderLabelsDeleted: 0,
      summaryJobsDeleted: 0
    }))
  };
  const app = buildApp({
    config: loadConfig({
      NODE_ENV: 'test',
      INTERNAL_JOB_TOKEN: 'internal-token'
    }),
    internalJobHandlers: handlers
  });

  apps.push(app);
  return { app, handlers };
}

describe('internal job routes', () => {
  it('rejects drain requests without the internal token', async () => {
    const { app, handlers } = buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/internal/jobs/drain',
      payload: {
        maxJobs: 1
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      ok: false,
      error: 'unauthorized'
    });
    expect(handlers.drainJobs).not.toHaveBeenCalled();
  });

  it('drains jobs with a valid internal token', async () => {
    const { app, handlers } = buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/internal/jobs/drain',
      headers: {
        authorization: 'Bearer internal-token'
      },
      payload: {
        maxJobs: 2
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      processed: 1,
      completed: 1,
      retryableFailed: 0,
      terminalFailed: 0,
      empty: false
    });
    expect(handlers.drainJobs).toHaveBeenCalledWith({
      maxJobs: 2
    });
    expect(handlers.runRetentionCleanup).not.toHaveBeenCalled();
  });

  it('can run retention cleanup from the drain endpoint', async () => {
    const { app, handlers } = buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/internal/jobs/drain',
      headers: {
        authorization: 'Bearer internal-token'
      },
      payload: {
        maxJobs: 1,
        runCleanup: true
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      cleanup: {
        summariesSoftDeleted: 0,
        transcriptsSoftDeleted: 0,
        pendingSenderLabelsDeleted: 0,
        summaryJobsDeleted: 0
      }
    });
    expect(handlers.runRetentionCleanup).toHaveBeenCalledOnce();
  });
});
