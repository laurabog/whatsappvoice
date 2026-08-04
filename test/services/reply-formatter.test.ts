import { describe, expect, it } from 'vitest';
import { formatReceivedAt, formatSummaryReply } from '../../src/services/reply-formatter.js';

describe('formatSummaryReply', () => {
  it('formats a WhatsApp summary reply', () => {
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
        'Received: today at 13:24',
        '',
        'Alex says he is changing jobs and asks about dinner Friday.',
        '',
        'Important',
        '- Changing jobs',
        '',
        'You may want to reply',
        '- Are you free for dinner Friday?',
        '',
        'Listen?',
        'Summary is probably enough.',
        '',
        'Reply TRANSCRIPT within 30 days if you want the full transcript.'
      ].join('\n')
    ]);
  });

  it('uses neutral fallbacks for empty sections', () => {
    const [reply] = formatSummaryReply({
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

    expect(reply).toContain('Important\nNothing major stood out.');
    expect(reply).toContain('You may want to reply\nProbably not.');
    expect(reply).toContain('Listen?\nWorth listening when you have time.');
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
