import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MetaWhatsAppClient } from '../../src/services/meta-whatsapp-client.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('MetaWhatsAppClient', () => {
  it('sends text messages through the WhatsApp Cloud API', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.outbound' }] }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      });
    });
    globalThis.fetch = fetchMock;

    const client = new MetaWhatsAppClient({
      WHATSAPP_ACCESS_TOKEN: 'access-token',
      WHATSAPP_GRAPH_API_VERSION: 'v23.0',
      WHATSAPP_PHONE_NUMBER_ID: 'phone-number-id'
    });

    await expect(
      client.sendText({
        to: '15551234567',
        body: 'Hello',
        contextMessageId: 'wamid.inbound'
      })
    ).resolves.toEqual({ whatsappMessageId: 'wamid.outbound' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v23.0/phone-number-id/messages',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer access-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: '15551234567',
          context: {
            message_id: 'wamid.inbound'
          },
          type: 'text',
          text: {
            preview_url: false,
            body: 'Hello'
          }
        })
      }
    );
  });

  it('requires send credentials', () => {
    expect(
      () =>
        new MetaWhatsAppClient({
          WHATSAPP_ACCESS_TOKEN: undefined,
          WHATSAPP_GRAPH_API_VERSION: 'v23.0',
          WHATSAPP_PHONE_NUMBER_ID: 'phone-number-id'
        })
    ).toThrow('WHATSAPP_ACCESS_TOKEN is required for WhatsApp replies');

    expect(
      () =>
        new MetaWhatsAppClient({
          WHATSAPP_ACCESS_TOKEN: 'access-token',
          WHATSAPP_GRAPH_API_VERSION: 'v23.0',
          WHATSAPP_PHONE_NUMBER_ID: undefined
        })
    ).toThrow('WHATSAPP_PHONE_NUMBER_ID is required for WhatsApp replies');
  });

  it('surfaces WhatsApp API errors', async () => {
    globalThis.fetch = vi.fn(async () => new Response('bad token', { status: 401 }));

    const client = new MetaWhatsAppClient({
      WHATSAPP_ACCESS_TOKEN: 'access-token',
      WHATSAPP_GRAPH_API_VERSION: 'v23.0',
      WHATSAPP_PHONE_NUMBER_ID: 'phone-number-id'
    });

    await expect(
      client.sendText({
        to: '15551234567',
        body: 'Hello'
      })
    ).rejects.toThrow('WhatsApp sendText failed with 401: bad token');
  });

  it('retrieves WhatsApp media URLs with bearer authentication', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          id: 'media-123',
          url: 'https://lookaside.whatsapp.example/media',
          mime_type: 'audio/ogg; codecs=opus',
          file_size: '1234',
          sha256: 'sha'
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        }
      );
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const client = new MetaWhatsAppClient({
      WHATSAPP_ACCESS_TOKEN: 'access-token',
      WHATSAPP_GRAPH_API_VERSION: 'v23.0',
      WHATSAPP_PHONE_NUMBER_ID: 'phone-number-id'
    });

    await expect(client.getMediaUrl('media-123')).resolves.toEqual({
      mediaId: 'media-123',
      url: 'https://lookaside.whatsapp.example/media',
      mimeType: 'audio/ogg; codecs=opus',
      fileSizeBytes: 1234,
      sha256: 'sha'
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const mediaUrlCall = fetchMock.mock.calls[0];
    if (!mediaUrlCall) {
      throw new Error('Expected getMediaUrl to call fetch');
    }

    const [url, init] = mediaUrlCall;
    expect(url.toString()).toBe(
      'https://graph.facebook.com/v23.0/media-123?phone_number_id=phone-number-id'
    );
    expect(init).toEqual({
      headers: {
        authorization: 'Bearer access-token'
      }
    });
  });

  it('downloads WhatsApp media URLs to a local file with bearer authentication', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'meta-whatsapp-client-'));
    const destinationPath = join(dir, 'audio.ogg');
    const fetchMock = vi.fn(async () => {
      return new Response('audio-bytes', {
        status: 200,
        headers: {
          'content-type': 'audio/ogg; codecs=opus'
        }
      });
    });
    globalThis.fetch = fetchMock;

    try {
      const client = new MetaWhatsAppClient({
        WHATSAPP_ACCESS_TOKEN: 'access-token',
        WHATSAPP_GRAPH_API_VERSION: 'v23.0',
        WHATSAPP_PHONE_NUMBER_ID: 'phone-number-id'
      });

      await expect(
        client.downloadMediaToFile({
          url: 'https://lookaside.whatsapp.example/media',
          destinationPath
        })
      ).resolves.toEqual({
        destinationPath,
        bytes: 11,
        mimeType: 'audio/ogg; codecs=opus'
      });

      expect(fetchMock).toHaveBeenCalledWith('https://lookaside.whatsapp.example/media', {
        headers: {
          authorization: 'Bearer access-token'
        }
      });
      await expect(readFile(destinationPath, 'utf8')).resolves.toBe('audio-bytes');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
