import type { AppConfig } from '../config.js';

export type ScheduleDrainInput = {
  inboundMessageId: string;
  delaySeconds: number;
  maxJobs: number;
};

export type ScheduleDrainResult =
  | {
      scheduled: false;
      mode: 'disabled';
    }
  | {
      scheduled: true;
      mode: 'qstash';
      messageId: string | null;
      deduplicated: boolean;
    };

export type JobDrainTrigger = {
  scheduleDrain(input: ScheduleDrainInput): Promise<ScheduleDrainResult>;
};

type QStashPublishResponse = {
  messageId?: string;
  deduplicated?: boolean;
};

export type CreateJobDrainTriggerOptions = {
  config: Pick<
    AppConfig,
    | 'JOB_TRIGGER_MODE'
    | 'PUBLIC_APP_URL'
    | 'QSTASH_URL'
    | 'QSTASH_TOKEN'
    | 'INTERNAL_JOB_TOKEN'
    | 'QSTASH_TIMEOUT_SECONDS'
  >;
  fetchFn?: typeof fetch;
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function qstashPublishUrl(qstashUrl: string, destinationUrl: string): string {
  return `${trimTrailingSlash(qstashUrl)}/v2/publish/${encodeURIComponent(destinationUrl)}`;
}

export function createJobDrainTrigger({
  config,
  fetchFn = fetch
}: CreateJobDrainTriggerOptions): JobDrainTrigger {
  return {
    async scheduleDrain(input: ScheduleDrainInput): Promise<ScheduleDrainResult> {
      if (config.JOB_TRIGGER_MODE === 'disabled') {
        return {
          scheduled: false,
          mode: 'disabled'
        };
      }

      if (!config.PUBLIC_APP_URL || !config.QSTASH_TOKEN || !config.INTERNAL_JOB_TOKEN) {
        throw new Error('QStash job trigger is enabled but required configuration is missing');
      }

      const destinationUrl = `${trimTrailingSlash(config.PUBLIC_APP_URL)}/internal/jobs/drain`;
      const response = await fetchFn(qstashPublishUrl(config.QSTASH_URL, destinationUrl), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.QSTASH_TOKEN}`,
          'Content-Type': 'application/json',
          'Upstash-Delay': `${input.delaySeconds}s`,
          'Upstash-Retries': '3',
          'Upstash-Timeout': `${config.QSTASH_TIMEOUT_SECONDS}s`,
          'Upstash-Deduplication-Id': `audio-drain:${input.inboundMessageId}`,
          'Upstash-Label': 'voiceicorn,audio-drain',
          'Upstash-Redact-Fields': 'body,header[Authorization]',
          'Upstash-Forward-Authorization': `Bearer ${config.INTERNAL_JOB_TOKEN}`
        },
        body: JSON.stringify({
          source: 'audio-intake',
          inboundMessageId: input.inboundMessageId,
          maxJobs: input.maxJobs
        })
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`QStash publish failed with ${response.status}: ${detail.slice(0, 300)}`);
      }

      const body = (await response.json().catch(() => ({}))) as QStashPublishResponse;

      return {
        scheduled: true,
        mode: 'qstash',
        messageId: body.messageId ?? null,
        deduplicated: Boolean(body.deduplicated)
      };
    }
  };
}
