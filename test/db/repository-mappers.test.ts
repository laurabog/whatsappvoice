import { describe, expect, it } from 'vitest';
import { mapInboundMessageRow } from '../../src/db/repositories/inbound-messages.js';
import { mapOutboundMessageRow } from '../../src/db/repositories/outbound-messages.js';
import { mapPendingSenderLabelRow } from '../../src/db/repositories/pending-sender-labels.js';
import { mapSummaryJobRow } from '../../src/db/repositories/summary-jobs.js';
import { mapSummaryRow } from '../../src/db/repositories/summaries.js';
import { mapTranscriptRow } from '../../src/db/repositories/transcripts.js';
import { mapUserRow } from '../../src/db/repositories/users.js';

describe('repository row mappers', () => {
  it('maps user rows to app records', () => {
    const now = new Date('2026-08-03T12:00:00.000Z');

    expect(
      mapUserRow({
        id: 'user-id',
        whatsapp_user_id: 'whatsapp-id',
        display_name: 'Laura',
        created_at: now,
        last_seen_at: now,
        is_blocked: false
      })
    ).toEqual({
      id: 'user-id',
      whatsappUserId: 'whatsapp-id',
      displayName: 'Laura',
      createdAt: now,
      lastSeenAt: now,
      isBlocked: false
    });
  });

  it('maps inbound message rows to app records', () => {
    const now = new Date('2026-08-03T12:00:00.000Z');

    expect(
      mapInboundMessageRow({
        id: 'message-id',
        whatsapp_message_id: 'wamid.123',
        user_id: 'user-id',
        message_type: 'audio',
        received_at: now,
        whatsapp_timestamp: now,
        media_id: 'media-id',
        mime_type: 'audio/ogg',
        is_voice_note: true,
        text_body: null,
        status: 'received',
        error_code: null
      })
    ).toEqual({
      id: 'message-id',
      whatsappMessageId: 'wamid.123',
      userId: 'user-id',
      messageType: 'audio',
      receivedAt: now,
      whatsappTimestamp: now,
      mediaId: 'media-id',
      mimeType: 'audio/ogg',
      isVoiceNote: true,
      textBody: null,
      status: 'received',
      errorCode: null
    });
  });

  it('maps summary job rows to app records', () => {
    const now = new Date('2026-08-03T12:00:00.000Z');

    expect(
      mapSummaryJobRow({
        id: 'job-id',
        inbound_message_id: 'message-id',
        status: 'queued',
        attempt_count: 0,
        max_attempts: 3,
        next_attempt_at: now,
        locked_at: null,
        locked_by: null,
        started_at: null,
        completed_at: null,
        download_latency_ms: null,
        transcription_latency_ms: null,
        summary_latency_ms: null,
        total_latency_ms: null,
        error_code: null,
        error_detail_sanitized: null,
        created_at: now,
        updated_at: now
      })
    ).toMatchObject({
      id: 'job-id',
      inboundMessageId: 'message-id',
      status: 'queued',
      attemptCount: 0,
      maxAttempts: 3,
      nextAttemptAt: now
    });
  });

  it('maps summary rows to app records', () => {
    const now = new Date('2026-08-03T12:00:00.000Z');
    const expiresAt = new Date('2026-09-02T12:00:00.000Z');

    expect(
      mapSummaryRow({
        id: 'summary-id',
        user_id: 'user-id',
        inbound_message_id: 'message-id',
        reference_code: null,
        from_label: 'unknown sender',
        from_label_confidence: 'unknown',
        one_sentence_summary: 'One sentence.',
        short_summary: 'Short summary.',
        important_points_json: [],
        questions_or_requests_json: ['Reply when you can.'],
        dates_or_commitments_json: [],
        reply_needed: true,
        listening_recommendation: 'summary_enough',
        created_at: now,
        expires_at: expiresAt,
        deleted_at: null
      })
    ).toEqual({
      id: 'summary-id',
      userId: 'user-id',
      inboundMessageId: 'message-id',
      referenceCode: null,
      fromLabel: 'unknown sender',
      fromLabelConfidence: 'unknown',
      oneSentenceSummary: 'One sentence.',
      shortSummary: 'Short summary.',
      importantPoints: [],
      questionsOrRequests: ['Reply when you can.'],
      datesOrCommitments: [],
      replyNeeded: true,
      listeningRecommendation: 'summary_enough',
      createdAt: now,
      expiresAt,
      deletedAt: null
    });
  });

  it('maps pending sender label rows to app records', () => {
    const now = new Date('2026-08-03T12:00:00.000Z');
    const expiresAt = new Date('2026-08-03T12:30:00.000Z');

    expect(
      mapPendingSenderLabelRow({
        id: 'label-id',
        user_id: 'user-id',
        label: 'Alex',
        normalized_label: 'alex',
        created_at: now,
        expires_at: expiresAt,
        consumed_at: null
      })
    ).toEqual({
      id: 'label-id',
      userId: 'user-id',
      label: 'Alex',
      normalizedLabel: 'alex',
      createdAt: now,
      expiresAt,
      consumedAt: null
    });
  });

  it('maps transcript rows to app records', () => {
    const now = new Date('2026-08-03T12:00:00.000Z');
    const expiresAt = new Date('2026-09-02T12:00:00.000Z');

    expect(
      mapTranscriptRow({
        id: 'transcript-id',
        user_id: 'user-id',
        inbound_message_id: 'message-id',
        summary_id: 'summary-id',
        text: 'Transcript body',
        character_count: 15,
        created_at: now,
        expires_at: expiresAt,
        deleted_at: null
      })
    ).toEqual({
      id: 'transcript-id',
      userId: 'user-id',
      inboundMessageId: 'message-id',
      summaryId: 'summary-id',
      text: 'Transcript body',
      characterCount: 15,
      createdAt: now,
      expiresAt,
      deletedAt: null
    });
  });

  it('maps outbound message rows to app records', () => {
    const now = new Date('2026-08-03T12:00:00.000Z');

    expect(
      mapOutboundMessageRow({
        id: 'outbound-id',
        inbound_message_id: 'message-id',
        user_id: 'user-id',
        reply_kind: 'summary',
        chunk_index: 0,
        whatsapp_message_id: 'wamid.out',
        status: 'sent',
        body_sha256: 'abc123',
        created_at: now,
        sent_at: now,
        error_code: null
      })
    ).toEqual({
      id: 'outbound-id',
      inboundMessageId: 'message-id',
      userId: 'user-id',
      replyKind: 'summary',
      chunkIndex: 0,
      whatsappMessageId: 'wamid.out',
      status: 'sent',
      bodySha256: 'abc123',
      createdAt: now,
      sentAt: now,
      errorCode: null
    });
  });
});
