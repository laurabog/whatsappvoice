import { describe, expect, it } from 'vitest';
import { formatReceivedAt, formatSummaryReply } from '../../src/services/reply-formatter.js';

describe('formatSummaryReply', () => {
  it('formats a WhatsApp summary reply with a separate copy-paste reply', () => {
    expect(
      formatSummaryReply({
        fromLabel: 'probably Alex',
        receivedAt: new Date('2026-08-03T11:24:00.000Z'),
        now: new Date('2026-08-03T12:00:00.000Z'),
        summary: {
          oneSentenceSummary: 'Alex is changing jobs.',
          shortSummary: 'Alex says he is changing jobs and asks about dinner Friday.',
          importantPoints: [
            {
              label: 'Changing jobs',
              evidence: 'I am changing jobs',
              confidence: 'high'
            }
          ],
          questionsOrRequests: ['Are you free for dinner Friday?'],
          datesOrCommitments: ['Friday dinner'],
          replyNeeded: true,
          listeningRecommendation: 'summary_enough',
          uncertainties: []
        }
      })
    ).toEqual([
      [
        '🎧 Voice note from probably Alex',
        '🕒 today at 13:24',
        '',
        '✨ The gist',
        'Alex says he is changing jobs and asks about dinner Friday.',
        '',
        '🔎 Key bits',
        '• Changing jobs',
        '',
        '💬 Reply needed?',
        '• Are you free for dinner Friday?',
        '',
        '🎧 Listen?',
        'You can probably skip the audio.',
        '',
        'Send TRANSCRIPT for the full text. Saved for 30 days.'
      ].join('\n'),
      ['💬 Copy-paste reply', '', 'Thanks Alex, got your voice note. I’ll check this and reply properly soon.'].join(
        '\n'
      )
    ]);
  });

  it('uses neutral fallbacks for empty sections', () => {
    const replies = formatSummaryReply({
      fromLabel: 'unknown sender',
      receivedAt: new Date('2026-08-03T12:00:00.000Z'),
      now: new Date('2026-08-03T12:00:00.000Z'),
      summary: {
        oneSentenceSummary: 'Nothing major stood out.',
        shortSummary: 'Nothing major stood out.',
        importantPoints: [],
        questionsOrRequests: [],
        datesOrCommitments: [],
        replyNeeded: false,
        listeningRecommendation: 'listen_when_you_can',
        uncertainties: []
      }
    });

    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('🔎 Key bits\nNothing major stood out.');
    expect(replies[0]).toContain('💬 Reply needed?\nNo obvious reply needed.');
    expect(replies[0]).toContain('🎧 Listen?\nWorth listening when you have time.');
  });

  it('uses a generic copy-paste reply when the sender is unknown', () => {
    const replies = formatSummaryReply({
      fromLabel: 'unknown sender',
      receivedAt: new Date('2026-08-03T12:00:00.000Z'),
      now: new Date('2026-08-03T12:00:00.000Z'),
      summary: {
        oneSentenceSummary: 'The speaker asks for a reply.',
        shortSummary: 'The speaker asks you to check something and reply.',
        importantPoints: [],
        questionsOrRequests: ['Please reply.'],
        datesOrCommitments: [],
        replyNeeded: true,
        listeningRecommendation: 'summary_enough',
        uncertainties: []
      }
    });

    expect(replies[1]).toBe(
      ['💬 Copy-paste reply', '', 'Thanks, got your voice note. I’ll check this and reply properly soon.'].join(
        '\n'
      )
    );
  });

  it('formats older received timestamps with absolute dates', () => {
    expect(
      formatReceivedAt(
        new Date('2026-08-04T11:24:00.000Z'),
        new Date('2026-08-05T11:00:00.000Z')
      )
    ).toBe('4 Aug 2026, 13:24');
  });
});
