import { describe, expect, it } from 'vitest';
import { noTranscriptMessage } from '../../src/commands/messages.js';
import { formatTranscriptReply } from '../../src/commands/transcript-command.js';

describe('formatTranscriptReply', () => {
  it('returns a helpful fallback when no transcript is available', () => {
    expect(formatTranscriptReply(null, 3500)).toEqual([noTranscriptMessage]);
  });

  it('formats short transcripts in one reply', () => {
    expect(formatTranscriptReply({ text: 'Please call me back.', fromLabel: 'Laura' }, 3500)).toEqual([
      'Transcript from Laura\n\nPlease call me back.'
    ]);
  });

  it('chunks long transcripts without exceeding the configured reply size', () => {
    const replies = formatTranscriptReply({ text: 'a'.repeat(1200), fromLabel: 'Laura' }, 500);

    expect(replies).toHaveLength(3);
    expect(replies[0]).toMatch(/^Transcript from Laura 1\/3\n\n/);
    expect(replies[1]).toMatch(/^Transcript from Laura 2\/3\n\n/);
    expect(replies[2]).toMatch(/^Transcript from Laura 3\/3\n\n/);
    expect(replies.every((reply) => reply.length <= 500)).toBe(true);
    expect(replies.map((reply) => reply.split('\n\n')[1]).join('')).toBe('a'.repeat(1200));
  });
});
