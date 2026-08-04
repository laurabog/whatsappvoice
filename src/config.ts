import 'dotenv/config';
import { z } from 'zod';

const optionalNonEmptyString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional()
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: optionalNonEmptyString,
  WHATSAPP_VERIFY_TOKEN: optionalNonEmptyString,
  WHATSAPP_ACCESS_TOKEN: optionalNonEmptyString,
  WHATSAPP_APP_SECRET: optionalNonEmptyString,
  WHATSAPP_PHONE_NUMBER_ID: optionalNonEmptyString,
  WHATSAPP_GRAPH_API_VERSION: z.string().min(1).default('v23.0'),
  OPENAI_API_KEY: optionalNonEmptyString,
  OPENAI_TRANSCRIPTION_MODEL: z.string().min(1).default('gpt-4o-mini-transcribe'),
  OPENAI_SUMMARY_MODEL: z.string().min(1).default('gpt-4o-mini'),
  OPENAI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  MAX_AUDIO_BYTES: z.coerce.number().int().positive().default(16_777_216),
  MAX_AUDIO_DURATION_SECONDS: z.coerce.number().int().positive().default(600),
  MAX_DAILY_MESSAGES_PER_USER: z.coerce.number().int().positive().default(10),
  MAX_TRANSCRIPT_REPLY_CHARS: z.coerce.number().int().positive().default(3500),
  SUMMARY_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  TRANSCRIPT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  JOB_METADATA_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  PENDING_LABEL_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  PROCESSING_JOB_TIMEOUT_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RETENTION_CLEANUP_INTERVAL_MS: z.coerce.number().int().positive().default(60 * 60 * 1000),
  AUDIO_DURATION_PROBE: z.enum(['disabled', 'ffprobe']).default('disabled'),
  TEMP_AUDIO_DIR: z.string().min(1).default('/tmp/whatsapp-summary-audio'),
  SENTRY_DSN: optionalNonEmptyString
});

export type AppConfig = z.infer<typeof envSchema>;

export const whatsappMetaEnvKeys = [
  'WHATSAPP_APP_SECRET',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID'
] as const;

export const whatsappWebhookEnvKeys = [
  'WHATSAPP_VERIFY_TOKEN',
  ...whatsappMetaEnvKeys
] as const;

export type WhatsAppMetaEnvKey = (typeof whatsappMetaEnvKeys)[number];
export type WhatsAppWebhookEnvKey = (typeof whatsappWebhookEnvKeys)[number];

export type ConfigStatus<Key extends keyof AppConfig> = {
  configured: boolean;
  missing: Key[];
};

function getConfigStatus<Key extends keyof AppConfig>(
  config: Pick<AppConfig, Key>,
  keys: readonly Key[]
): ConfigStatus<Key> {
  const missing = keys.filter((key) => !config[key]);

  return {
    configured: missing.length === 0,
    missing
  };
}

export function getWhatsAppMetaConfigStatus(
  config: Pick<AppConfig, WhatsAppMetaEnvKey>
): ConfigStatus<WhatsAppMetaEnvKey> {
  return getConfigStatus(config, whatsappMetaEnvKeys);
}

export function getWhatsAppWebhookConfigStatus(
  config: Pick<AppConfig, WhatsAppWebhookEnvKey>
): ConfigStatus<WhatsAppWebhookEnvKey> {
  return getConfigStatus(config, whatsappWebhookEnvKeys);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse(env);
}
