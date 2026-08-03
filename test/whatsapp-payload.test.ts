import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseWhatsAppWebhookPayload } from '../src/routes/whatsapp-payload.js';

async function readFixture(filename: string) {
  const fixture = await readFile(`test/fixtures/${filename}`, 'utf8');
  return JSON.parse(fixture) as unknown;
}

describe('parseWhatsAppWebhookPayload', () => {
  it('parses inbound text messages', async () => {
    const events = parseWhatsAppWebhookPayload(await readFixture('whatsapp-text-webhook.json'));

    expect(events).toEqual([
      {
        kind: 'message',
        message: {
          whatsappMessageId: 'wamid.text-123',
          from: '31612345678',
          displayName: 'Laura',
          timestamp: new Date('2026-08-03T13:20:00.000Z'),
          messageType: 'text',
          textBody: 'HELP',
          audio: null
        }
      }
    ]);
  });

  it('parses inbound audio messages', async () => {
    const events = parseWhatsAppWebhookPayload(await readFixture('whatsapp-audio-webhook.json'));

    expect(events).toEqual([
      {
        kind: 'message',
        message: {
          whatsappMessageId: 'wamid.audio-123',
          from: '31612345678',
          displayName: 'Laura',
          timestamp: new Date('2026-08-03T13:21:00.000Z'),
          messageType: 'audio',
          textBody: null,
          audio: {
            mediaId: 'media_audio_123',
            mimeType: 'audio/ogg; codecs=opus',
            isVoiceNote: true
          }
        }
      }
    ]);
  });

  it('parses status events separately from messages', async () => {
    const events = parseWhatsAppWebhookPayload(await readFixture('whatsapp-status-webhook.json'));

    expect(events).toEqual([
      {
        kind: 'status',
        status: {
          whatsappMessageId: 'wamid.outbound-123',
          recipientId: '31612345678',
          status: 'sent',
          timestamp: new Date('2026-08-03T13:22:00.000Z')
        }
      }
    ]);
  });

  it('returns no events for unsupported payload shapes', () => {
    expect(parseWhatsAppWebhookPayload({ object: 'whatsapp_business_account' })).toEqual([]);
    expect(parseWhatsAppWebhookPayload(null)).toEqual([]);
  });
});
