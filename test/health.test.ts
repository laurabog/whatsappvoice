import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const apps: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('health route', () => {
  it('returns service health', async () => {
    const app = buildApp({
      config: loadConfig({ NODE_ENV: 'test' })
    });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/health'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      service: 'whatsapp-voice-summary',
      environment: 'test'
    });
  });
});
