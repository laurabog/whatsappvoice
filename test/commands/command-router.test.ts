import { describe, expect, it, vi } from 'vitest';
import { createCommandRouter, type CommandRouterDependencies } from '../../src/commands/command-router.js';
import {
  deleteConfirmationMessage,
  helpMessage,
  unsupportedMessage
} from '../../src/commands/messages.js';
import type { InboundMessageRecord } from '../../src/db/repositories/inbound-messages.js';
import type { UserRecord } from '../../src/db/repositories/users.js';
import type { ParsedWhatsAppMessage } from '../../src/routes/whatsapp-payload.js';
import type { SendTextInput } from '../../src/services/whatsapp-client.js';
import { createInMemoryOutboundMessages } from '../helpers/in-memory-outbound.js';

function makeUser(): UserRecord {
  const now = new Date('2026-08-03T12:00:00.000Z');

  return {
    id: 'user-1',
    whatsappUserId: '15551234567',
    displayName: 'Laura',
    createdAt: now,
    lastSeenAt: now,
    isBlocked: false
  };
}

function makeTextMessage(textBody: string): ParsedWhatsAppMessage {
  return {
    whatsappMessageId: `wamid.${textBody}`,
    from: '15551234567',
    displayName: 'Laura',
    timestamp: new Date('2026-08-03T12:00:00.000Z'),
    messageType: 'text',
    textBody,
    audio: null
  };
}

function makeAudioMessage(): ParsedWhatsAppMessage {
  return {
    whatsappMessageId: 'wamid.audio',
    from: '15551234567',
    displayName: 'Laura',
    timestamp: new Date('2026-08-03T12:00:00.000Z'),
    messageType: 'audio',
    textBody: null,
    audio: {
      mediaId: 'media-1',
      mimeType: 'audio/ogg',
      isVoiceNote: true
    }
  };
}

function makeDependencies(overrides: Partial<CommandRouterDependencies> = {}) {
  const now = new Date('2026-08-03T12:00:00.000Z');
  const sentMessages: SendTextInput[] = [];
  const inboundByWhatsAppId = new Map<string, InboundMessageRecord>();
  const outboundMessages = createInMemoryOutboundMessages();

  const dependencies = {
    config: {
      MAX_DAILY_MESSAGES_PER_USER: 10,
      MAX_TRANSCRIPT_REPLY_CHARS: 500,
      PENDING_LABEL_TTL_MINUTES: 30
    },
    whatsapp: {
      sendText: vi.fn(async (input: SendTextInput) => {
        sentMessages.push(input);
        return { whatsappMessageId: `wamid.out.${sentMessages.length}` };
      })
    },
    users: {
      upsertFromWhatsApp: vi.fn(async () => makeUser())
    },
    inboundMessages: {
      insertIfNew: vi.fn(async (input) => {
        const existing = inboundByWhatsAppId.get(input.whatsappMessageId);
        if (existing) {
          return {
            record: existing,
            inserted: false
          };
        }

        const inboundMessage: InboundMessageRecord = {
          id: `inbound-${inboundByWhatsAppId.size + 1}`,
          whatsappMessageId: input.whatsappMessageId,
          userId: input.userId,
          messageType: input.messageType,
          receivedAt: now,
          whatsappTimestamp: input.whatsappTimestamp ?? null,
          mediaId: null,
          mimeType: null,
          isVoiceNote: null,
          textBody: input.textBody ?? null,
          status: input.status ?? 'received',
          errorCode: null
        };
        inboundByWhatsAppId.set(input.whatsappMessageId, inboundMessage);

        return {
          record: inboundMessage,
          inserted: true
        };
      }),
      updateStatus: vi.fn(async (id, status, errorCode) => {
        const inboundMessage = [...inboundByWhatsAppId.values()].find(
          (candidate) => candidate.id === id
        );
        if (!inboundMessage) {
          throw new Error(`Inbound message ${id} not found`);
        }

        inboundMessage.status = status;
        inboundMessage.errorCode = errorCode ?? null;
        return inboundMessage;
      })
    },
    outboundMessages,
    pendingSenderLabels: {
      createPendingLabel: vi.fn(async () => ({})),
      deleteForUser: vi.fn(async () => 1)
    },
    summaries: {
      countForUserSince: vi.fn(async () => 2),
      softDeleteForUser: vi.fn(async () => 3)
    },
    transcripts: {
      findLatestAvailableForUser: vi.fn(async () => ({ text: 'Latest transcript.' })),
      softDeleteForUser: vi.fn(async () => 4)
    },
    now: () => now,
    ...overrides
  } satisfies CommandRouterDependencies;

  return {
    dependencies,
    sentMessages,
    inboundByWhatsAppId,
    outboundMessages,
    now
  };
}

describe('createCommandRouter', () => {
  it('ignores non-text messages', async () => {
    const { dependencies } = makeDependencies();
    const router = createCommandRouter(dependencies);

    await expect(router.handleMessage(makeAudioMessage())).resolves.toEqual({ handled: false });

    expect(dependencies.users.upsertFromWhatsApp).not.toHaveBeenCalled();
    expect(dependencies.whatsapp.sendText).not.toHaveBeenCalled();
  });

  it('replies to HELP', async () => {
    const { dependencies, sentMessages } = makeDependencies();
    const router = createCommandRouter(dependencies);

    await expect(router.handleMessage(makeTextMessage('HELP'))).resolves.toEqual({
      handled: true,
      command: 'help'
    });

    expect(dependencies.users.upsertFromWhatsApp).toHaveBeenCalledWith({
      whatsappUserId: '15551234567',
      displayName: 'Laura'
    });
    expect(dependencies.inboundMessages.insertIfNew).toHaveBeenCalledWith({
      whatsappMessageId: 'wamid.HELP',
      userId: 'user-1',
      messageType: 'text',
      whatsappTimestamp: new Date('2026-08-03T12:00:00.000Z'),
      textBody: null,
      status: 'received'
    });
    expect(dependencies.inboundMessages.updateStatus).toHaveBeenCalledWith(
      'inbound-1',
      'completed'
    );
    expect(sentMessages).toEqual([
      {
        to: '15551234567',
        body: helpMessage,
        contextMessageId: 'wamid.HELP'
      }
    ]);
  });

  it('reports STATUS with the last 24 hour count and daily limit', async () => {
    const { dependencies, sentMessages, now } = makeDependencies();
    const router = createCommandRouter(dependencies);

    await expect(router.handleMessage(makeTextMessage('status'))).resolves.toEqual({
      handled: true,
      command: 'status'
    });

    expect(dependencies.summaries.countForUserSince).toHaveBeenCalledWith(
      'user-1',
      new Date(now.getTime() - 24 * 60 * 60 * 1000)
    );
    expect(sentMessages[0]?.body).toBe('You have summarized 2 voice notes today.\nDaily friend-beta limit: 10.');
  });

  it('deletes saved user data when the user sends DELETE', async () => {
    const { dependencies, sentMessages, now } = makeDependencies();
    const router = createCommandRouter(dependencies);

    await expect(router.handleMessage(makeTextMessage('DELETE'))).resolves.toEqual({
      handled: true,
      command: 'delete'
    });

    expect(dependencies.transcripts.softDeleteForUser).toHaveBeenCalledWith('user-1', now);
    expect(dependencies.summaries.softDeleteForUser).toHaveBeenCalledWith('user-1', now);
    expect(dependencies.pendingSenderLabels.deleteForUser).toHaveBeenCalledWith('user-1');
    expect(sentMessages[0]?.body).toBe(deleteConfirmationMessage);
  });

  it('returns the latest transcript in WhatsApp-sized chunks', async () => {
    const { dependencies, sentMessages, now } = makeDependencies({
      transcripts: {
        findLatestAvailableForUser: vi.fn(async () => ({ text: 'a'.repeat(1200) })),
        softDeleteForUser: vi.fn(async () => 0)
      }
    });
    const router = createCommandRouter(dependencies);

    await expect(router.handleMessage(makeTextMessage('TRANSCRIPT'))).resolves.toEqual({
      handled: true,
      command: 'transcript'
    });

    expect(dependencies.transcripts.findLatestAvailableForUser).toHaveBeenCalledWith('user-1', now);
    expect(sentMessages).toHaveLength(3);
    expect(sentMessages.every((message) => message.body.length <= 500)).toBe(true);
    expect(sentMessages[0]?.contextMessageId).toBe('wamid.TRANSCRIPT');
  });

  it('stores a pending sender label for the next voice note', async () => {
    const { dependencies, sentMessages, outboundMessages, now } = makeDependencies();
    const router = createCommandRouter(dependencies);

    await expect(router.handleMessage(makeTextMessage('From Alex'))).resolves.toEqual({
      handled: true,
      command: 'sender_label'
    });

    expect(dependencies.pendingSenderLabels.createPendingLabel).toHaveBeenCalledWith({
      userId: 'user-1',
      label: 'Alex',
      normalizedLabel: 'alex',
      expiresAt: new Date(now.getTime() + 30 * 60 * 1000)
    });
    expect(sentMessages[0]?.body).toBe('Got it. I will label the next voice note as from Alex.');
    expect([...outboundMessages.records.values()][0]?.replyKind).toBe('help');
  });

  it('does not duplicate sender-label side effects or replies for duplicate text webhooks', async () => {
    const { dependencies, sentMessages } = makeDependencies();
    const router = createCommandRouter(dependencies);
    const message = makeTextMessage('From Alex');

    await router.handleMessage(message);
    await router.handleMessage(message);

    expect(dependencies.pendingSenderLabels.createPendingLabel).toHaveBeenCalledOnce();
    expect(dependencies.inboundMessages.updateStatus).toHaveBeenCalledOnce();
    expect(sentMessages).toHaveLength(1);
  });

  it('reruns sender-label work when a previous duplicate command attempt did not complete', async () => {
    let shouldFail = true;
    const { dependencies, sentMessages } = makeDependencies({
      pendingSenderLabels: {
        createPendingLabel: vi.fn(async () => {
          if (shouldFail) {
            shouldFail = false;
            throw new Error('database unavailable');
          }
        }),
        deleteForUser: vi.fn(async () => 1)
      }
    });
    const router = createCommandRouter(dependencies);
    const message = makeTextMessage('From Alex');

    await expect(router.handleMessage(message)).rejects.toThrow('database unavailable');
    await expect(router.handleMessage(message)).resolves.toEqual({
      handled: true,
      command: 'sender_label'
    });

    expect(dependencies.pendingSenderLabels.createPendingLabel).toHaveBeenCalledTimes(2);
    expect(dependencies.inboundMessages.updateStatus).toHaveBeenCalledOnce();
    expect(sentMessages).toHaveLength(1);
  });

  it('replies helpfully to unsupported text', async () => {
    const { dependencies, sentMessages, outboundMessages } = makeDependencies();
    const router = createCommandRouter(dependencies);

    await expect(router.handleMessage(makeTextMessage('what can you do?'))).resolves.toEqual({
      handled: true,
      command: 'unsupported_text'
    });

    expect(sentMessages[0]?.body).toBe(unsupportedMessage);
    expect([...outboundMessages.records.values()][0]?.replyKind).toBe('help');
  });
});
