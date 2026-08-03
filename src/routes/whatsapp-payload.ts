export type ParsedWhatsAppMessage = {
  whatsappMessageId: string;
  from: string;
  displayName: string | null;
  timestamp: Date | null;
  messageType: string;
  textBody: string | null;
  audio:
    | {
        mediaId: string;
        mimeType: string | null;
        isVoiceNote: boolean | null;
      }
    | null;
};

export type ParsedWhatsAppStatus = {
  whatsappMessageId: string;
  recipientId: string | null;
  status: string;
  timestamp: Date | null;
};

export type ParsedWhatsAppEvent =
  | {
      kind: 'message';
      message: ParsedWhatsAppMessage;
    }
  | {
      kind: 'status';
      status: ParsedWhatsAppStatus;
    };

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function asRecordArray(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function parseWhatsAppTimestamp(value: unknown): Date | null {
  const timestamp = asString(value);
  if (!timestamp) {
    return null;
  }

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) {
    return null;
  }

  return new Date(seconds * 1000);
}

function contactDisplayNamesByWaId(contacts: unknown): Map<string, string> {
  const names = new Map<string, string>();

  for (const contact of asRecordArray(contacts)) {
    const waId = asString(contact.wa_id);
    const profile = isRecord(contact.profile) ? contact.profile : null;
    const name = profile ? asString(profile.name) : null;

    if (waId && name) {
      names.set(waId, name);
    }
  }

  return names;
}

function parseMessage(
  rawMessage: UnknownRecord,
  displayNames: Map<string, string>
): ParsedWhatsAppMessage | null {
  const whatsappMessageId = asString(rawMessage.id);
  const from = asString(rawMessage.from);
  const messageType = asString(rawMessage.type);

  if (!whatsappMessageId || !from || !messageType) {
    return null;
  }

  const text = isRecord(rawMessage.text) ? rawMessage.text : null;
  const audio = isRecord(rawMessage.audio) ? rawMessage.audio : null;
  const mediaId = audio ? asString(audio.id) : null;

  return {
    whatsappMessageId,
    from,
    displayName: displayNames.get(from) ?? null,
    timestamp: parseWhatsAppTimestamp(rawMessage.timestamp),
    messageType,
    textBody: text ? asString(text.body) : null,
    audio: audio && mediaId
      ? {
          mediaId,
          mimeType: asString(audio.mime_type),
          isVoiceNote: asBoolean(audio.voice)
        }
      : null
  };
}

function parseStatus(rawStatus: UnknownRecord): ParsedWhatsAppStatus | null {
  const whatsappMessageId = asString(rawStatus.id);
  const status = asString(rawStatus.status);

  if (!whatsappMessageId || !status) {
    return null;
  }

  return {
    whatsappMessageId,
    recipientId: asString(rawStatus.recipient_id),
    status,
    timestamp: parseWhatsAppTimestamp(rawStatus.timestamp)
  };
}

export function parseWhatsAppWebhookPayload(payload: unknown): ParsedWhatsAppEvent[] {
  if (!isRecord(payload)) {
    return [];
  }

  const events: ParsedWhatsAppEvent[] = [];

  for (const entry of asRecordArray(payload.entry)) {
    for (const change of asRecordArray(entry.changes)) {
      const value = isRecord(change.value) ? change.value : null;
      if (!value) {
        continue;
      }

      const displayNames = contactDisplayNamesByWaId(value.contacts);

      for (const rawMessage of asRecordArray(value.messages)) {
        const message = parseMessage(rawMessage, displayNames);
        if (message) {
          events.push({ kind: 'message', message });
        }
      }

      for (const rawStatus of asRecordArray(value.statuses)) {
        const status = parseStatus(rawStatus);
        if (status) {
          events.push({ kind: 'status', status });
        }
      }
    }
  }

  return events;
}
