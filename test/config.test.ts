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
    expect(config.OPENAI_SUMMARY_MODEL).toBe('gpt-4o-mini');
    expect(config.MAX_AUDIO_DURATION_SECONDS).toBe(600);
    expect(config.TRANSCRIPT_RETENTION_DAYS).toBe(30);
    expect(config.WORKER_POLL_INTERVAL_MS).toBe(5000);
    expect(config.PROCESSING_JOB_TIMEOUT_MS).toBe(900000);
    expect(config.RETENTION_CLEANUP_INTERVAL_MS).toBe(3600000);
    expect(config.AUDIO_DURATION_PROBE).toBe('disabled');
  });

  it('coerces numeric environment values', () => {
    const config = loadConfig({
      PORT: '4010',
      MAX_DAILY_MESSAGES_PER_USER: '7'
    });

    expect(config.PORT).toBe(4010);
    expect(config.MAX_DAILY_MESSAGES_PER_USER).toBe(7);
  });

  it('treats blank optional secrets as missing', () => {
    const config = loadConfig({
      DATABASE_URL: '',
      WHATSAPP_VERIFY_TOKEN: '',
      WHATSAPP_ACCESS_TOKEN: '',
      WHATSAPP_APP_SECRET: '',
      WHATSAPP_PHONE_NUMBER_ID: '',
      OPENAI_API_KEY: '',
      SENTRY_DSN: ''
    });

    expect(config.DATABASE_URL).toBeUndefined();
    expect(config.WHATSAPP_VERIFY_TOKEN).toBeUndefined();
    expect(config.WHATSAPP_ACCESS_TOKEN).toBeUndefined();
    expect(config.WHATSAPP_APP_SECRET).toBeUndefined();
    expect(config.WHATSAPP_PHONE_NUMBER_ID).toBeUndefined();
    expect(config.OPENAI_API_KEY).toBeUndefined();
    expect(config.SENTRY_DSN).toBeUndefined();
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
