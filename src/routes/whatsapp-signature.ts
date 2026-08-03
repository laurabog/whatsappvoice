import { createHmac, timingSafeEqual } from 'node:crypto';

const signaturePrefix = 'sha256=';

export function createWhatsAppSignature(rawBody: Buffer, appSecret: string): string {
  const digest = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return `${signaturePrefix}${digest}`;
}

export function verifyWhatsAppSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string
): boolean {
  if (!signatureHeader?.startsWith(signaturePrefix)) {
    return false;
  }

  const expected = Buffer.from(createWhatsAppSignature(rawBody, appSecret), 'utf8');
  const actual = Buffer.from(signatureHeader, 'utf8');

  if (expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(expected, actual);
}
