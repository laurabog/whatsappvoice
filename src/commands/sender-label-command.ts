export type ParsedSenderLabelCommand =
  | {
      ok: true;
      intent: 'before_next' | 'after_recent' | 'rename_latest';
      label: string;
      normalizedLabel: string;
    }
  | {
      ok: false;
      reason: 'not_sender_label' | 'invalid_label';
    };

const reservedCommands = new Set(['help', 'delete', 'status', 'transcript', 'transcript latest']);

function cleanText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function normalizeLabel(label: string): string {
  return cleanText(label).toLowerCase();
}

function isValidLabel(label: string): boolean {
  if (label.length === 0 || label.length > 80) {
    return false;
  }

  if (/https?:\/\//i.test(label) || /\bwww\./i.test(label)) {
    return false;
  }

  if (!/[A-Za-z0-9]/.test(label)) {
    return false;
  }

  return !reservedCommands.has(normalizeLabel(label));
}

export function parseSenderLabelCommand(text: string): ParsedSenderLabelCommand {
  const cleaned = cleanText(text);
  const patterns: Array<{
    intent: 'before_next' | 'after_recent' | 'rename_latest';
    pattern: RegExp;
  }> = [
    {
      intent: 'before_next',
      pattern: /^(?:from\s*:?\s+|sender\s+|sent\s+by\s+)(.+)$/i
    },
    {
      intent: 'after_recent',
      pattern: /^(.+?)\s+sent\s+this$/i
    },
    {
      intent: 'after_recent',
      pattern: /^(?:that|this)\s+was\s+from\s+(.+)$/i
    },
    {
      intent: 'after_recent',
      pattern: /^voice\s+note\s+from\s+(.+)$/i
    },
    {
      intent: 'rename_latest',
      pattern: /^(?:rename|label)\s+latest\s+(.+)$/i
    }
  ];

  for (const { intent, pattern } of patterns) {
    const match = pattern.exec(cleaned);
    if (!match) {
      continue;
    }

    const label = cleanText(match[1] ?? '');

    if (!isValidLabel(label)) {
      return { ok: false, reason: 'invalid_label' };
    }

    return {
      ok: true,
      intent,
      label,
      normalizedLabel: normalizeLabel(label)
    };
  }

  return { ok: false, reason: 'not_sender_label' };
}
