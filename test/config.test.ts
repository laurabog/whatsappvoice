import { describe, expect, it } from 'vitest';
import {
  getWhatsAppMetaConfigStatus,
  getWhatsAppWebhookConfigStatus,
  loadConfig
} from '../src/config.js';

describe('loadConfig', () => {
  it('loads development defaults', () => {
    const config = loadConfig({});

    expect(config.NODE_ENV).toBe('development');
    expect(config.PORT).toBe(3000);
    expect(config.WHATSAPP_GRAPH_API_VERSION).toBe('v23.0');
    expect(config.OPENAI_TRANSCRIPTION_MODEL).toBe('gpt-4o-mini-transcribe');
    expect(config.MAX_AUDIO_DURATION_SECONDS).toBe(600);
    expect(config.TRANSCRIPT_RETENTION_DAYS).toBe(30);
  });

  it('coerces numeric environment values', () => {
    const config = loadConfig({
      PORT: '4010',
      MAX_DAILY_MESSAGES_PER_USER: '7'
    });

    expect(config.PORT).toBe(4010);
    expect(config.MAX_DAILY_MESSAGES_PER_USER).toBe(7);
  });

  it('rejects invalid numeric values', () => {
    expect(() => loadConfig({ PORT: '0' })).toThrow();
  });

  it('reports missing Meta-side WhatsApp config', () => {
    const config = loadConfig({
      WHATSAPP_APP_SECRET: 'app-secret'
    });

    expect(getWhatsAppMetaConfigStatus(config)).toEqual({
      configured: false,
      missing: ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID']
    });
  });

  it('reports complete WhatsApp webhook config', () => {
    const config = loadConfig({
      WHATSAPP_VERIFY_TOKEN: 'verify-token',
      WHATSAPP_APP_SECRET: 'app-secret',
      WHATSAPP_ACCESS_TOKEN: 'access-token',
      WHATSAPP_PHONE_NUMBER_ID: 'phone-number-id'
    });

    expect(getWhatsAppWebhookConfigStatus(config)).toEqual({
      configured: true,
      missing: []
    });
  });
});
