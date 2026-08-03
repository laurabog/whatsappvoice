import { describe, expect, it, vi } from 'vitest';
import { sendWhatsAppTextOnce } from '../../src/services/idempotent-whatsapp-sender.js';
import type { SendTextInput } from '../../src/services/whatsapp-client.js';
import { createInMemoryOutboundMessages } from '../helpers/in-memory-outbound.js';

describe('sendWhatsAppTextOnce', () => {
  it('sends a reserved outbound message once', async () => {
    const outboundMessages = createInMemoryOutboundMessages();
    const sentMessages: SendTextInput[] = [];
    const whatsapp = {
      sendText: vi.fn(async (input: SendTextInput) => {
        sentMessages.push(input);
        return { whatsappMessageId: `wamid.out.${sentMessages.length}` };
      })
    };

    await expect(
      sendWhatsAppTextOnce({
        outboundMessages,
        whatsapp,
        inboundMessageId: 'inbound-1',
        userId: 'user-1',
        replyKind: 'summary',
        to: '15551234567',
        body: 'Summary',
        contextMessageId: 'wamid.inbound',
        now: () => new Date('2026-08-03T12:00:00.000Z')
      })
    ).resolves.toEqual({
      sent: true,
      whatsappMessageId: 'wamid.out.1'
    });

    await expect(
      sendWhatsAppTextOnce({
        outboundMessages,
        whatsapp,
        inboundMessageId: 'inbound-1',
        userId: 'user-1',
        replyKind: 'summary',
        to: '15551234567',
        body: 'Summary',
        contextMessageId: 'wamid.inbound'
      })
    ).resolves.toEqual({
      sent: false,
      reason: 'already_reserved'
    });

    expect(sentMessages).toEqual([
      {
        to: '15551234567',
        body: 'Summary',
        contextMessageId: 'wamid.inbound'
      }
    ]);
    expect([...outboundMessages.records.values()][0]?.status).toBe('sent');
  });

  it('marks the reserved outbound message failed when sending throws', async () => {
    const outboundMessages = createInMemoryOutboundMessages();
    const whatsapp = {
      sendText: vi.fn(async () => {
        throw new Error('network down');
      })
    };

    await expect(
      sendWhatsAppTextOnce({
        outboundMessages,
        whatsapp,
        inboundMessageId: 'inbound-1',
        userId: 'user-1',
        replyKind: 'summary',
        to: '15551234567',
        body: 'Summary'
      })
    ).rejects.toThrow('network down');

    expect([...outboundMessages.records.values()][0]?.status).toBe('failed');
    expect([...outboundMessages.records.values()][0]?.errorCode).toBe('Error');
  });

  it('retries a previously failed outbound message', async () => {
    const outboundMessages = createInMemoryOutboundMessages();
    let shouldFail = true;
    const sentMessages: SendTextInput[] = [];
    const whatsapp = {
      sendText: vi.fn(async (input: SendTextInput) => {
        if (shouldFail) {
          shouldFail = false;
          throw new Error('network down');
        }

        sentMessages.push(input);
        return { whatsappMessageId: 'wamid.retry-ok' };
      })
    };
    const input = {
      outboundMessages,
      whatsapp,
      inboundMessageId: 'inbound-1',
      userId: 'user-1',
      replyKind: 'summary' as const,
      to: '15551234567',
      body: 'Summary',
      contextMessageId: 'wamid.inbound'
    };

    await expect(sendWhatsAppTextOnce(input)).rejects.toThrow('network down');
    await expect(sendWhatsAppTextOnce(input)).resolves.toEqual({
      sent: true,
      whatsappMessageId: 'wamid.retry-ok'
    });

    expect(sentMessages).toEqual([
      {
        to: '15551234567',
        body: 'Summary',
        contextMessageId: 'wamid.inbound'
      }
    ]);
    expect([...outboundMessages.records.values()][0]?.status).toBe('sent');
  });
});
