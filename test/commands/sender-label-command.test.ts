import { describe, expect, it } from 'vitest';
import { parseSenderLabelCommand } from '../../src/commands/sender-label-command.js';

describe('parseSenderLabelCommand', () => {
  it('parses friendly sender labels', () => {
    expect(parseSenderLabelCommand('From Alex')).toEqual({
      ok: true,
      label: 'Alex',
      normalizedLabel: 'alex'
    });

    expect(parseSenderLabelCommand('from:  Alex   Morgan')).toEqual({
      ok: true,
      label: 'Alex Morgan',
      normalizedLabel: 'alex morgan'
    });

    expect(parseSenderLabelCommand('sender Maria')).toEqual({
      ok: true,
      label: 'Maria',
      normalizedLabel: 'maria'
    });
  });

  it('rejects non-label text and unsafe labels', () => {
    expect(parseSenderLabelCommand('HELP')).toEqual({
      ok: false,
      reason: 'not_sender_label'
    });

    expect(parseSenderLabelCommand('From https://example.com')).toEqual({
      ok: false,
      reason: 'invalid_label'
    });

    expect(parseSenderLabelCommand('From !!!')).toEqual({
      ok: false,
      reason: 'invalid_label'
    });
  });
});
