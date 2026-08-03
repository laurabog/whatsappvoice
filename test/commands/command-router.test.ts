import { describe, expect, it, vi } from 'vitest';
import { createCommandRouter, type CommandRouterDependencies } from '../../src/commands/command-router.js';
import {
  deleteConfirmationMessage,
  helpMessage,
  unsupportedMessage
} from '../../src/commands/messages.js';
import type { UserRecord } from '../../src/db/repositories/users.js';
import type { ParsedWhatsAppMessage } from '../../src/routes/whatsapp-payload.js';
import type { SendTextInput } from '../../src/services/whatsapp-client.js';

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
    const { dependencies, sentMessages, now } = makeDependencies();
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
  });

  it('replies helpfully to unsupported text', async () => {
    const { dependencies, sentMessages } = makeDependencies();
    const router = createCommandRouter(dependencies);

    await expect(router.handleMessage(makeTextMessage('what can you do?'))).resolves.toEqual({
      handled: true,
      command: 'unsupported_text'
    });

    expect(sentMessages[0]?.body).toBe(unsupportedMessage);
  });
});
