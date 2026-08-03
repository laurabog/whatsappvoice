import type { DbClient, DbPool } from '../db/client.js';
import type { InboundMessageRecord } from '../db/repositories/inbound-messages.js';
import { createInboundMessagesRepository } from '../db/repositories/inbound-messages.js';
import type { SummaryJobRecord } from '../db/repositories/summary-jobs.js';
import { createSummaryJobsRepository } from '../db/repositories/summary-jobs.js';
import type { UserRecord } from '../db/repositories/users.js';

export type AudioJobContext = {
  job: SummaryJobRecord;
  inboundMessage: InboundMessageRecord;
  user: UserRecord;
};

type AudioJobContextRow = {
  job_id: string;
  job_inbound_message_id: string;
  job_status: SummaryJobRecord['status'];
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
  job_error_code: string | null;
  error_detail_sanitized: string | null;
  job_created_at: Date;
  job_updated_at: Date;
  inbound_id: string;
  whatsapp_message_id: string;
  inbound_user_id: string;
  message_type: string;
  received_at: Date;
  whatsapp_timestamp: Date | null;
  media_id: string | null;
  mime_type: string | null;
  is_voice_note: boolean | null;
  text_body: string | null;
  inbound_status: InboundMessageRecord['status'];
  inbound_error_code: string | null;
  user_id: string;
  whatsapp_user_id: string;
  display_name: string | null;
  user_created_at: Date;
  last_seen_at: Date;
  is_blocked: boolean;
};

function mapAudioJobContextRow(row: AudioJobContextRow): AudioJobContext {
  return {
    job: {
      id: row.job_id,
      inboundMessageId: row.job_inbound_message_id,
      status: row.job_status,
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
      errorCode: row.job_error_code,
      errorDetailSanitized: row.error_detail_sanitized,
      createdAt: row.job_created_at,
      updatedAt: row.job_updated_at
    },
    inboundMessage: {
      id: row.inbound_id,
      whatsappMessageId: row.whatsapp_message_id,
      userId: row.inbound_user_id,
      messageType: row.message_type,
      receivedAt: row.received_at,
      whatsappTimestamp: row.whatsapp_timestamp,
      mediaId: row.media_id,
      mimeType: row.mime_type,
      isVoiceNote: row.is_voice_note,
      textBody: row.text_body,
      status: row.inbound_status,
      errorCode: row.inbound_error_code
    },
    user: {
      id: row.user_id,
      whatsappUserId: row.whatsapp_user_id,
      displayName: row.display_name,
      createdAt: row.user_created_at,
      lastSeenAt: row.last_seen_at,
      isBlocked: row.is_blocked
    }
  };
}

async function withTransaction<T>(
  db: DbPool,
  run: (client: DbClient) => Promise<T>
): Promise<T> {
  const client = await db.connect();

  try {
    await client.query('begin');
    const result = await run(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export function createJobStore(db: DbPool) {
  const summaryJobs = createSummaryJobsRepository(db);

  return {
    enqueueForInboundMessage: summaryJobs.createForInboundMessage,
    claimNextQueuedJob: summaryJobs.claimNextQueuedJob,

    async findJobContext(jobId: string): Promise<AudioJobContext | null> {
      const result = await db.query<AudioJobContextRow>(
        `
          select
            sj.id as job_id,
            sj.inbound_message_id as job_inbound_message_id,
            sj.status as job_status,
            sj.attempt_count,
            sj.max_attempts,
            sj.next_attempt_at,
            sj.locked_at,
            sj.locked_by,
            sj.started_at,
            sj.completed_at,
            sj.download_latency_ms,
            sj.transcription_latency_ms,
            sj.summary_latency_ms,
            sj.total_latency_ms,
            sj.error_code as job_error_code,
            sj.error_detail_sanitized,
            sj.created_at as job_created_at,
            sj.updated_at as job_updated_at,
            im.id as inbound_id,
            im.whatsapp_message_id,
            im.user_id as inbound_user_id,
            im.message_type,
            im.received_at,
            im.whatsapp_timestamp,
            im.media_id,
            im.mime_type,
            im.is_voice_note,
            im.text_body,
            im.status as inbound_status,
            im.error_code as inbound_error_code,
            u.id as user_id,
            u.whatsapp_user_id,
            u.display_name,
            u.created_at as user_created_at,
            u.last_seen_at,
            u.is_blocked
          from summary_jobs sj
          join inbound_messages im on im.id = sj.inbound_message_id
          join users u on u.id = im.user_id
          where sj.id = $1
        `,
        [jobId]
      );

      const row = result.rows[0];
      return row ? mapAudioJobContextRow(row) : null;
    },

    async markCompleted(input: {
      jobId: string;
      inboundMessageId: string;
      completedAt: Date;
      downloadLatencyMs?: number | null;
      transcriptionLatencyMs?: number | null;
      summaryLatencyMs?: number | null;
      totalLatencyMs?: number | null;
    }): Promise<SummaryJobRecord> {
      return withTransaction(db, async (client) => {
        const transactionalInboundMessages = createInboundMessagesRepository(client);
        const transactionalSummaryJobs = createSummaryJobsRepository(client);

        await transactionalInboundMessages.updateStatus(input.inboundMessageId, 'completed');
        return transactionalSummaryJobs.markCompleted({
          id: input.jobId,
          completedAt: input.completedAt,
          downloadLatencyMs: input.downloadLatencyMs,
          transcriptionLatencyMs: input.transcriptionLatencyMs,
          summaryLatencyMs: input.summaryLatencyMs,
          totalLatencyMs: input.totalLatencyMs
        });
      });
    },

    async markFailed(input: {
      jobId: string;
      inboundMessageId: string;
      failedAt: Date;
      retryAt: Date | null;
      errorCode: string;
      errorDetailSanitized?: string | null;
    }): Promise<SummaryJobRecord> {
      return withTransaction(db, async (client) => {
        const transactionalInboundMessages = createInboundMessagesRepository(client);
        const transactionalSummaryJobs = createSummaryJobsRepository(client);
        const job = await transactionalSummaryJobs.markFailed({
          id: input.jobId,
          failedAt: input.failedAt,
          retryAt: input.retryAt,
          errorCode: input.errorCode,
          errorDetailSanitized: input.errorDetailSanitized
        });

        if (job.status === 'terminal_failed') {
          await transactionalInboundMessages.updateStatus(
            input.inboundMessageId,
            'failed',
            input.errorCode
          );
        }

        return job;
      });
    }
  };
}
