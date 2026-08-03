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
});
