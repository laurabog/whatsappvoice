import { describe, expect, it } from 'vitest';
import {
  createWhatsAppSignature,
  verifyWhatsAppSignature
} from '../src/routes/whatsapp-signature.js';

describe('WhatsApp signature helpers', () => {
  it('verifies valid x-hub-signature-256 headers', () => {
    const body = Buffer.from('{"hello":"world"}');
    const signature = createWhatsAppSignature(body, 'secret');

    expect(verifyWhatsAppSignature(body, signature, 'secret')).toBe(true);
  });

  it('rejects missing or invalid signatures', () => {
    const body = Buffer.from('{"hello":"world"}');

    expect(verifyWhatsAppSignature(body, undefined, 'secret')).toBe(false);
    expect(verifyWhatsAppSignature(body, 'sha256=bad', 'secret')).toBe(false);
    expect(verifyWhatsAppSignature(body, createWhatsAppSignature(body, 'other'), 'secret')).toBe(
      false
    );
  });
});
