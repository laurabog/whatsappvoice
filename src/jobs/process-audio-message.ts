import type { AppConfig } from '../config.js';
import type { PendingSenderLabelRecord } from '../db/repositories/pending-sender-labels.js';
import type { InsertSummaryInput, SummaryRecord } from '../db/repositories/summaries.js';
import type { InsertTranscriptInput } from '../db/repositories/transcripts.js';
import type { WhatsAppTextSender } from '../services/whatsapp-client.js';
import {
  sendWhatsAppTextOnce,
  type OutboundMessagesForSending
} from '../services/idempotent-whatsapp-sender.js';
import type { AudioSource, PreparedAudio } from '../services/media-downloader.js';
import {
  formatSummaryReply,
  type SummaryOutput,
  type SummaryPoint
} from '../services/reply-formatter.js';
import { resolveSenderLabel } from '../services/sender-label-resolver.js';
import type { Summarizer } from '../services/summarizer.js';
import type { Transcriber } from '../services/transcriber.js';
import type { AudioJobContext } from './job-store.js';

export type ProcessAudioMessageResult = {
  processed: true;
  summaryId: string;
  transcriptId: string;
  replyCount: number;
};

export type ProcessAudioMessageDependencies = {
  config: Pick<AppConfig, 'SUMMARY_RETENTION_DAYS' | 'TRANSCRIPT_RETENTION_DAYS'>;
  jobStore: {
    findJobContext(jobId: string): Promise<AudioJobContext | null>;
    markCompleted(input: {
      jobId: string;
      inboundMessageId: string;
      completedAt: Date;
    }): Promise<unknown>;
  };
  pendingSenderLabels: {
    consumeLatestForUser(userId: string, now: Date): Promise<PendingSenderLabelRecord | null>;
  };
  summaries: {
    insertIfNew(input: InsertSummaryInput): Promise<{ record: SummaryRecord; inserted: boolean }>;
  };
  transcripts: {
    insertIfNew(input: InsertTranscriptInput): Promise<{
      record: {
        id: string;
      };
      inserted: boolean;
    }>;
  };
  outboundMessages: OutboundMessagesForSending;
  whatsapp: WhatsAppTextSender;
  transcriber: Transcriber;
  summarizer: Summarizer;
  audioSource?: AudioSource;
  now?: () => Date;
};

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function isSummaryPoint(value: unknown): value is SummaryPoint {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const maybePoint = value as Partial<SummaryPoint>;
  return (
    typeof maybePoint.label === 'string' &&
    typeof maybePoint.evidence === 'string' &&
    (maybePoint.confidence === 'low' ||
      maybePoint.confidence === 'medium' ||
      maybePoint.confidence === 'high')
  );
}

function isStringArray(value: unknown[]): value is string[] {
  return value.every((item) => typeof item === 'string');
}

function summaryOutputFromRecord(record: SummaryRecord): SummaryOutput {
  const importantPoints = record.importantPoints.filter(isSummaryPoint);
  const questionsOrRequests = isStringArray(record.questionsOrRequests)
    ? record.questionsOrRequests
    : [];
  const datesOrCommitments = isStringArray(record.datesOrCommitments)
    ? record.datesOrCommitments
    : [];

  return {
    oneSentenceSummary: record.oneSentenceSummary,
    shortSummary: record.shortSummary,
    importantPoints,
    questionsOrRequests,
    datesOrCommitments,
    replyNeeded: record.replyNeeded,
    listeningRecommendation:
      record.listeningRecommendation === 'listen_when_you_can' ||
      record.listeningRecommendation === 'listen_soon'
        ? record.listeningRecommendation
        : 'summary_enough',
    uncertainties: []
  };
}

export function createAudioMessageProcessor(dependencies: ProcessAudioMessageDependencies) {
  const now = dependencies.now ?? (() => new Date());

  return {
    async processAudioMessage(jobId: string): Promise<ProcessAudioMessageResult> {
      const context = await dependencies.jobStore.findJobContext(jobId);
      if (!context) {
        throw new Error(`Summary job ${jobId} was not found`);
      }

      if (context.inboundMessage.messageType !== 'audio' || !context.inboundMessage.mediaId) {
        throw new Error(`Summary job ${jobId} does not reference an audio message`);
      }

      const processingStartedAt = now();
      const pendingLabel = await dependencies.pendingSenderLabels.consumeLatestForUser(
        context.user.id,
        processingStartedAt
      );

      let preparedAudio: PreparedAudio | null = null;

      try {
        preparedAudio = dependencies.audioSource
          ? await dependencies.audioSource.prepareAudio({
              mediaId: context.inboundMessage.mediaId,
              mimeType: context.inboundMessage.mimeType
            })
          : null;

        const transcription = await dependencies.transcriber.transcribe({
          mediaId: context.inboundMessage.mediaId,
          audioPath: preparedAudio?.audioPath,
          mimeType: preparedAudio?.mimeType ?? context.inboundMessage.mimeType,
          language: 'en'
        });
        const summary = await dependencies.summarizer.summarize({
          transcript: transcription.text
        });
        const senderLabel = resolveSenderLabel({
          pendingLabel,
          summary
        });
        const expiresAt = addDays(
          now(),
          Math.min(
            dependencies.config.SUMMARY_RETENTION_DAYS,
            dependencies.config.TRANSCRIPT_RETENTION_DAYS
          )
        );

        const summaryResult = await dependencies.summaries.insertIfNew({
          userId: context.user.id,
          inboundMessageId: context.inboundMessage.id,
          fromLabel: senderLabel.label,
          fromLabelConfidence: senderLabel.confidence,
          oneSentenceSummary: summary.oneSentenceSummary,
          shortSummary: summary.shortSummary,
          importantPoints: summary.importantPoints,
          questionsOrRequests: summary.questionsOrRequests,
          datesOrCommitments: summary.datesOrCommitments,
          replyNeeded: summary.replyNeeded,
          listeningRecommendation: summary.listeningRecommendation,
          expiresAt
        });
        const transcriptResult = await dependencies.transcripts.insertIfNew({
          userId: context.user.id,
          inboundMessageId: context.inboundMessage.id,
          summaryId: summaryResult.record.id,
          text: transcription.text,
          expiresAt
        });
        const replySummary = summaryResult.inserted
          ? summary
          : summaryOutputFromRecord(summaryResult.record);
        const replyChunks = formatSummaryReply({
          fromLabel: summaryResult.record.fromLabel,
          summary: replySummary
        });

        for (const [index, body] of replyChunks.entries()) {
          await sendWhatsAppTextOnce({
            outboundMessages: dependencies.outboundMessages,
            whatsapp: dependencies.whatsapp,
            inboundMessageId: context.inboundMessage.id,
            userId: context.user.id,
            replyKind: 'summary',
            chunkIndex: index,
            to: context.user.whatsappUserId,
            body,
            contextMessageId: context.inboundMessage.whatsappMessageId,
            now
          });
        }

        await dependencies.jobStore.markCompleted({
          jobId: context.job.id,
          inboundMessageId: context.inboundMessage.id,
          completedAt: now()
        });

        return {
          processed: true,
          summaryId: summaryResult.record.id,
          transcriptId: transcriptResult.record.id,
          replyCount: replyChunks.length
        };
      } finally {
        await preparedAudio?.cleanup().catch(() => undefined);
      }
    }
  };
}
