import type { AppConfig } from '../config.js';

export type RetentionCleanupResult = {
  summariesSoftDeleted: number;
  transcriptsSoftDeleted: number;
  pendingSenderLabelsDeleted: number;
  summaryJobsDeleted: number;
};

export type RetentionCleanupDependencies = {
  config: Pick<AppConfig, 'JOB_METADATA_RETENTION_DAYS'>;
  summaries: {
    softDeleteExpired(now: Date): Promise<number>;
  };
  transcripts: {
    softDeleteExpired(now: Date): Promise<number>;
  };
  pendingSenderLabels: {
    deleteExpired(now: Date): Promise<number>;
  };
  summaryJobs: {
    deleteFinishedBefore(cutoff: Date): Promise<number>;
  };
  now?: () => Date;
};

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export function createRetentionCleanup(dependencies: RetentionCleanupDependencies) {
  const now = dependencies.now ?? (() => new Date());

  return {
    async runOnce(): Promise<RetentionCleanupResult> {
      const cleanupTime = now();
      const jobCutoff = daysAgo(cleanupTime, dependencies.config.JOB_METADATA_RETENTION_DAYS);

      const [
        summariesSoftDeleted,
        transcriptsSoftDeleted,
        pendingSenderLabelsDeleted,
        summaryJobsDeleted
      ] = await Promise.all([
        dependencies.summaries.softDeleteExpired(cleanupTime),
        dependencies.transcripts.softDeleteExpired(cleanupTime),
        dependencies.pendingSenderLabels.deleteExpired(cleanupTime),
        dependencies.summaryJobs.deleteFinishedBefore(jobCutoff)
      ]);

      return {
        summariesSoftDeleted,
        transcriptsSoftDeleted,
        pendingSenderLabelsDeleted,
        summaryJobsDeleted
      };
    }
  };
}
