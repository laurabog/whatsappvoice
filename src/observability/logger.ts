import pino from 'pino';

export function createLogger(nodeEnv: string) {
  return pino({
    level: nodeEnv === 'test' ? 'silent' : process.env.LOG_LEVEL ?? 'info',
    redact: [
      'WHATSAPP_ACCESS_TOKEN',
      'OPENAI_API_KEY',
      'req.headers.authorization',
      'req.headers.x-hub-signature-256'
    ]
  });
}
