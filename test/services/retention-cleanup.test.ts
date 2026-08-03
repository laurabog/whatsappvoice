import { describe, expect, it, vi } from 'vitest';
import { createRetentionCleanup } from '../../src/services/retention-cleanup.js';

describe('createRetentionCleanup', () => {
  it('cleans expired user data and old finished job metadata', async () => {
    const now = new Date('2026-08-03T12:00:00.000Z');
    const summaries = {
      softDeleteExpired: vi.fn(async () => 2)
    };
    const transcripts = {
      softDeleteExpired: vi.fn(async () => 3)
    };
    const pendingSenderLabels = {
      deleteExpired: vi.fn(async () => 4)
    };
    const summaryJobs = {
      deleteFinishedBefore: vi.fn(async () => 5)
    };
    const cleanup = createRetentionCleanup({
      config: {
        JOB_METADATA_RETENTION_DAYS: 90
      },
      summaries,
      transcripts,
      pendingSenderLabels,
      summaryJobs,
      now: () => now
    });

    await expect(cleanup.runOnce()).resolves.toEqual({
      summariesSoftDeleted: 2,
      transcriptsSoftDeleted: 3,
      pendingSenderLabelsDeleted: 4,
      summaryJobsDeleted: 5
    });

    expect(summaries.softDeleteExpired).toHaveBeenCalledWith(now);
    expect(transcripts.softDeleteExpired).toHaveBeenCalledWith(now);
    expect(pendingSenderLabels.deleteExpired).toHaveBeenCalledWith(now);
    expect(summaryJobs.deleteFinishedBefore).toHaveBeenCalledWith(
      new Date('2026-05-05T12:00:00.000Z')
    );
  });
});
