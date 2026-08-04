import { describe, expect, it } from 'vitest';
import { parseSenderLabelCommand } from '../../src/commands/sender-label-command.js';

describe('parseSenderLabelCommand', () => {
  it('parses friendly sender labels', () => {
    expect(parseSenderLabelCommand('From Alex')).toEqual({
      ok: true,
      intent: 'before_next',
      label: 'Alex',
      normalizedLabel: 'alex'
    });

    expect(parseSenderLabelCommand('from:  Alex   Morgan')).toEqual({
      ok: true,
      intent: 'before_next',
      label: 'Alex Morgan',
      normalizedLabel: 'alex morgan'
    });

    expect(parseSenderLabelCommand('sender Maria')).toEqual({
      ok: true,
      intent: 'before_next',
      label: 'Maria',
      normalizedLabel: 'maria'
    });

    expect(parseSenderLabelCommand('sent by Laura')).toEqual({
      ok: true,
      intent: 'before_next',
      label: 'Laura',
      normalizedLabel: 'laura'
    });
  });

  it('parses after-note labels and explicit corrections', () => {
    expect(parseSenderLabelCommand('Laura sent this')).toEqual({
      ok: true,
      intent: 'after_recent',
      label: 'Laura',
      normalizedLabel: 'laura'
    });

    expect(parseSenderLabelCommand('that was from Alex')).toEqual({
      ok: true,
      intent: 'after_recent',
      label: 'Alex',
      normalizedLabel: 'alex'
    });

    expect(parseSenderLabelCommand('this was from Alex Morgan')).toEqual({
      ok: true,
      intent: 'after_recent',
      label: 'Alex Morgan',
      normalizedLabel: 'alex morgan'
    });

    expect(parseSenderLabelCommand('voice note from Maria')).toEqual({
      ok: true,
      intent: 'after_recent',
      label: 'Maria',
      normalizedLabel: 'maria'
    });

    expect(parseSenderLabelCommand('rename latest Laura')).toEqual({
      ok: true,
      intent: 'rename_latest',
      label: 'Laura',
      normalizedLabel: 'laura'
    });

    expect(parseSenderLabelCommand('label latest Laura')).toEqual({
      ok: true,
      intent: 'rename_latest',
      label: 'Laura',
      normalizedLabel: 'laura'
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
