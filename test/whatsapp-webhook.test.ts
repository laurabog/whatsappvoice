import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createWhatsAppSignature } from '../src/routes/whatsapp-signature.js';

const apps: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function readFixtureBody(filename: string) {
  return readFile(`test/fixtures/${filename}`, 'utf8');
}

function buildTestApp(handlers = {}) {
  const app = buildApp({
    config: loadConfig({
      NODE_ENV: 'test',
      WHATSAPP_VERIFY_TOKEN: 'verify-token',
      WHATSAPP_APP_SECRET: 'app-secret'
    }),
    whatsappWebhookHandlers: handlers
  });

  apps.push(app);
  return app;
}

function signedHeaders(body: string, secret = 'app-secret') {
  return {
    'content-type': 'application/json',
    'x-hub-signature-256': createWhatsAppSignature(Buffer.from(body), secret)
  };
}

describe('WhatsApp webhook routes', () => {
  it('answers the Meta verification challenge', async () => {
    const app = buildTestApp();

    const response = await app.inject({
      method: 'GET',
      url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=abc123'
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('abc123');
  });

  it('rejects invalid verification tokens', async () => {
    const app = buildTestApp();

    const response = await app.inject({
      method: 'GET',
      url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123'
    });

    expect(response.statusCode).toBe(403);
  });

  it('accepts signed text webhooks and calls the message handler', async () => {
    const onMessage = vi.fn();
    const app = buildTestApp({ onMessage });
    const body = await readFixtureBody('whatsapp-text-webhook.json');

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: signedHeaders(body),
      payload: body
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(onMessage).toHaveBeenCalledOnce();
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        whatsappMessageId: 'wamid.text-123',
        messageType: 'text',
        textBody: 'HELP'
      })
    );
  });

  it('accepts signed audio webhooks and extracts media metadata', async () => {
    const onMessage = vi.fn();
    const app = buildTestApp({ onMessage });
    const body = await readFixtureBody('whatsapp-audio-webhook.json');

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: signedHeaders(body),
      payload: body
    });

    expect(response.statusCode).toBe(200);
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        whatsappMessageId: 'wamid.audio-123',
        messageType: 'audio',
        audio: {
          mediaId: 'media_audio_123',
          mimeType: 'audio/ogg; codecs=opus',
          isVoiceNote: true
        }
      })
    );
  });

  it('ignores signed status-only webhooks unless a status handler is provided', async () => {
    const onMessage = vi.fn();
    const app = buildTestApp({ onMessage });
    const body = await readFixtureBody('whatsapp-status-webhook.json');

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: signedHeaders(body),
      payload: body
    });

    expect(response.statusCode).toBe(200);
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('rejects invalid POST signatures', async () => {
    const onMessage = vi.fn();
    const app = buildTestApp({ onMessage });
    const body = await readFixtureBody('whatsapp-text-webhook.json');

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=invalid'
      },
      payload: body
    });

    expect(response.statusCode).toBe(401);
    expect(onMessage).not.toHaveBeenCalled();
  });
});
