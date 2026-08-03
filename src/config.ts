import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1).optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1).optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1).optional(),
  WHATSAPP_APP_SECRET: z.string().min(1).optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_TRANSCRIPTION_MODEL: z.string().min(1).default('gpt-4o-mini-transcribe'),
  OPENAI_SUMMARY_MODEL: z.string().min(1).optional(),
  MAX_AUDIO_BYTES: z.coerce.number().int().positive().default(16_777_216),
  MAX_AUDIO_DURATION_SECONDS: z.coerce.number().int().positive().default(600),
  MAX_DAILY_MESSAGES_PER_USER: z.coerce.number().int().positive().default(10),
  MAX_TRANSCRIPT_REPLY_CHARS: z.coerce.number().int().positive().default(3500),
  SUMMARY_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  TRANSCRIPT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  JOB_METADATA_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  PENDING_LABEL_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  TEMP_AUDIO_DIR: z.string().min(1).default('/tmp/whatsapp-summary-audio'),
  SENTRY_DSN: z.string().min(1).optional()
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse(env);
}
