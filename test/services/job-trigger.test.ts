import { describe, expect, it, vi } from 'vitest';
import { createJobDrainTrigger } from '../../src/services/job-trigger.js';

describe('createJobDrainTrigger', () => {
  it('does nothing when disabled', async () => {
    const fetchFn = vi.fn();
    const trigger = createJobDrainTrigger({
      config: {
        JOB_TRIGGER_MODE: 'disabled',
        PUBLIC_APP_URL: undefined,
        QSTASH_TOKEN: undefined,
        INTERNAL_JOB_TOKEN: undefined,
        QSTASH_TIMEOUT_SECONDS: 120
      },
      fetchFn
    });

    await expect(
      trigger.scheduleDrain({
        inboundMessageId: 'inbound-1',
        delaySeconds: 2,
        maxJobs: 1
      })
    ).resolves.toEqual({
      scheduled: false,
      mode: 'disabled'
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('requires QStash configuration when enabled', async () => {
    const trigger = createJobDrainTrigger({
      config: {
        JOB_TRIGGER_MODE: 'qstash',
        PUBLIC_APP_URL: undefined,
        QSTASH_TOKEN: 'qstash-token',
        INTERNAL_JOB_TOKEN: 'internal-token',
        QSTASH_TIMEOUT_SECONDS: 120
      }
    });

    await expect(
      trigger.scheduleDrain({
        inboundMessageId: 'inbound-1',
        delaySeconds: 2,
        maxJobs: 1
      })
    ).rejects.toThrow('required configuration is missing');
  });

  it('publishes a delayed protected drain request to QStash', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ messageId: 'msg-1', deduplicated: false }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      })
    );
    const trigger = createJobDrainTrigger({
      config: {
        JOB_TRIGGER_MODE: 'qstash',
        PUBLIC_APP_URL: 'https://voiceicorn.example/',
        QSTASH_TOKEN: 'qstash-token',
        INTERNAL_JOB_TOKEN: 'internal-token',
        QSTASH_TIMEOUT_SECONDS: 90
      },
      fetchFn
    });

    await expect(
      trigger.scheduleDrain({
        inboundMessageId: 'inbound-1',
        delaySeconds: 2,
        maxJobs: 1
      })
    ).resolves.toEqual({
      scheduled: true,
      mode: 'qstash',
      messageId: 'msg-1',
      deduplicated: false
    });

    expect(fetchFn).toHaveBeenCalledWith(
      'https://qstash.upstash.io/v2/publish/https%3A%2F%2Fvoiceicorn.example%2Finternal%2Fjobs%2Fdrain',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer qstash-token',
          'Content-Type': 'application/json',
          'Upstash-Delay': '2s',
          'Upstash-Retries': '3',
          'Upstash-Timeout': '90s',
          'Upstash-Deduplication-Id': 'audio-drain:inbound-1',
          'Upstash-Label': 'voiceicorn,audio-drain',
          'Upstash-Redact-Fields': 'body,header[Authorization]',
          'Upstash-Forward-Authorization': 'Bearer internal-token'
        }),
        body: JSON.stringify({
          source: 'audio-intake',
          inboundMessageId: 'inbound-1',
          maxJobs: 1
        })
      })
    );
  });
});
