import { randomUUID } from 'node:crypto';
import type { DbClient } from '../client.js';

export type SummaryJobStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'retryable_failed'
  | 'terminal_failed';

export type SummaryJobRecord = {
  id: string;
  inboundMessageId: string;
  status: SummaryJobStatus;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  lockedAt: Date | null;
  lockedBy: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  downloadLatencyMs: number | null;
  transcriptionLatencyMs: number | null;
  summaryLatencyMs: number | null;
  totalLatencyMs: number | null;
  errorCode: string | null;
  errorDetailSanitized: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type SummaryJobRow = {
  id: string;
  inbound_message_id: string;
  status: SummaryJobStatus;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: Date;
  locked_at: Date | null;
  locked_by: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  download_latency_ms: number | null;
  transcription_latency_ms: number | null;
  summary_latency_ms: number | null;
  total_latency_ms: number | null;
  error_code: string | null;
  error_detail_sanitized: string | null;
  created_at: Date;
  updated_at: Date;
};

export function mapSummaryJobRow(row: SummaryJobRow): SummaryJobRecord {
  return {
    id: row.id,
    inboundMessageId: row.inbound_message_id,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    nextAttemptAt: row.next_attempt_at,
    lockedAt: row.locked_at,
    lockedBy: row.locked_by,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    downloadLatencyMs: row.download_latency_ms,
    transcriptionLatencyMs: row.transcription_latency_ms,
    summaryLatencyMs: row.summary_latency_ms,
    totalLatencyMs: row.total_latency_ms,
    errorCode: row.error_code,
    errorDetailSanitized: row.error_detail_sanitized,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createSummaryJobsRepository(db: DbClient) {
  return {
    async createForInboundMessage(
      inboundMessageId: string,
      nextAttemptAt?: Date | null
    ): Promise<SummaryJobRecord> {
      const result = await db.query<SummaryJobRow>(
        `
          insert into summary_jobs (id, inbound_message_id, status, next_attempt_at)
          values ($1, $2, 'queued', coalesce($3::timestamptz, now()))
          on conflict (inbound_message_id) do update
            set updated_at = summary_jobs.updated_at
          returning *
        `,
        [randomUUID(), inboundMessageId, nextAttemptAt ?? null]
      );

      const row = result.rows[0];
      if (!row) {
        throw new Error('Summary job insert returned no row');
      }

      return mapSummaryJobRow(row);
    },

    async findByInboundMessageId(inboundMessageId: string): Promise<SummaryJobRecord | null> {
      const result = await db.query<SummaryJobRow>(
        'select * from summary_jobs where inbound_message_id = $1',
        [inboundMessageId]
      );

      const row = result.rows[0];
      return row ? mapSummaryJobRow(row) : null;
    },

    async findById(id: string): Promise<SummaryJobRecord | null> {
      const result = await db.query<SummaryJobRow>('select * from summary_jobs where id = $1', [
        id
      ]);

      const row = result.rows[0];
      return row ? mapSummaryJobRow(row) : null;
    },

    async claimNextQueuedJob(
      workerId: string,
      staleProcessingBefore?: Date
    ): Promise<SummaryJobRecord | null> {
      const result = await db.query<SummaryJobRow>(
        `
          with next_job as (
            select id
            from summary_jobs
            where (
                status in ('queued', 'retryable_failed')
                and next_attempt_at <= now()
              )
              or (
                $2::timestamptz is not null
                and status = 'processing'
                and locked_at <= $2
              )
            order by created_at asc
            for update skip locked
            limit 1
          )
          update summary_jobs
          set
            status = 'processing',
            attempt_count = attempt_count + 1,
            locked_at = now(),
            locked_by = $1,
            started_at = coalesce(started_at, now()),
            updated_at = now()
          where id in (select id from next_job)
          returning *
        `,
        [workerId, staleProcessingBefore ?? null]
      );

      const row = result.rows[0];
      return row ? mapSummaryJobRow(row) : null;
    },

    async markCompleted(input: {
      id: string;
      completedAt: Date;
      downloadLatencyMs?: number | null;
      transcriptionLatencyMs?: number | null;
      summaryLatencyMs?: number | null;
      totalLatencyMs?: number | null;
    }): Promise<SummaryJobRecord> {
      const result = await db.query<SummaryJobRow>(
        `
          update summary_jobs
          set
            status = 'completed',
            completed_at = $2,
            locked_at = null,
            locked_by = null,
            download_latency_ms = $3,
            transcription_latency_ms = $4,
            summary_latency_ms = $5,
            total_latency_ms = $6,
            updated_at = $2
          where id = $1
          returning *
        `,
        [
          input.id,
          input.completedAt,
          input.downloadLatencyMs ?? null,
          input.transcriptionLatencyMs ?? null,
          input.summaryLatencyMs ?? null,
          input.totalLatencyMs ?? null
        ]
      );

      const row = result.rows[0];
      if (!row) {
        throw new Error(`Summary job ${input.id} was not found`);
      }

      return mapSummaryJobRow(row);
    },

    async markFailed(input: {
      id: string;
      failedAt: Date;
      retryAt: Date | null;
      errorCode: string;
      errorDetailSanitized?: string | null;
    }): Promise<SummaryJobRecord> {
      const result = await db.query<SummaryJobRow>(
        `
          update summary_jobs
          set
            status = case
              when attempt_count >= max_attempts or $3::timestamptz is null
                then 'terminal_failed'
              else 'retryable_failed'
            end,
            next_attempt_at = coalesce($3, next_attempt_at),
            locked_at = null,
            locked_by = null,
            completed_at = case
              when attempt_count >= max_attempts or $3::timestamptz is null
                then $2
              else completed_at
            end,
            error_code = $4,
            error_detail_sanitized = $5,
            updated_at = $2
          where id = $1
          returning *
        `,
        [
          input.id,
          input.failedAt,
          input.retryAt,
          input.errorCode,
          input.errorDetailSanitized ?? null
        ]
      );

      const row = result.rows[0];
      if (!row) {
        throw new Error(`Summary job ${input.id} was not found`);
      }

      return mapSummaryJobRow(row);
    },

    async deleteFinishedBefore(cutoff: Date): Promise<number> {
      const result = await db.query(
        `
          delete from summary_jobs
          where status in ('completed', 'terminal_failed')
            and completed_at is not null
            and completed_at < $1
        `,
        [cutoff]
      );

      return result.rowCount ?? 0;
    }
  };
}
