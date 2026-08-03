import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

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
});
