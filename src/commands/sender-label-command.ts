export type ParsedSenderLabelCommand =
  | {
      ok: true;
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
  const match = /^(?:from\s*:?\s+|sender\s+)(.+)$/i.exec(cleaned);

  if (!match) {
    return { ok: false, reason: 'not_sender_label' };
  }

  const label = cleanText(match[1] ?? '');

  if (!isValidLabel(label)) {
    return { ok: false, reason: 'invalid_label' };
  }

  return {
    ok: true,
    label,
    normalizedLabel: normalizeLabel(label)
  };
}
