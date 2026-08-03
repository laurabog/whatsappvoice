import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import {
  parseWhatsAppWebhookPayload,
  type ParsedWhatsAppMessage,
  type ParsedWhatsAppStatus
} from './whatsapp-payload.js';
import { verifyWhatsAppSignature } from './whatsapp-signature.js';

type RawBodyRequest = FastifyRequest & {
  rawBody?: Buffer;
};

type AnyFastifyInstance = FastifyInstance<any, any, any, any, any>;

export type WhatsAppWebhookHandlers = {
  onMessage?: (message: ParsedWhatsAppMessage) => Promise<void> | void;
  onStatus?: (status: ParsedWhatsAppStatus) => Promise<void> | void;
};

export type RegisterWhatsAppWebhookRoutesOptions = {
  config: AppConfig;
  handlers?: WhatsAppWebhookHandlers;
};

function registerRawJsonParser(app: AnyFastifyInstance) {
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    const rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body);
    Object.assign(request, { rawBody });

    try {
      const parsedBody = JSON.parse(rawBody.toString('utf8')) as unknown;
      done(null, parsedBody);
    } catch (error) {
      done(error as Error, undefined);
    }
  });
}

export function registerWhatsAppWebhookRoutes(
  app: AnyFastifyInstance,
  { config, handlers }: RegisterWhatsAppWebhookRoutesOptions
) {
  registerRawJsonParser(app);

  app.get('/webhooks/whatsapp', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const mode = query['hub.mode'];
    const verifyToken = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (!config.WHATSAPP_VERIFY_TOKEN) {
      return reply.code(500).send({ error: 'whatsapp_verify_token_not_configured' });
    }

    if (mode === 'subscribe' && verifyToken === config.WHATSAPP_VERIFY_TOKEN && challenge) {
      return reply.type('text/plain').send(challenge);
    }

    return reply.code(403).send({ error: 'invalid_whatsapp_webhook_challenge' });
  });

  app.post('/webhooks/whatsapp', async (request: RawBodyRequest, reply) => {
    if (!config.WHATSAPP_APP_SECRET) {
      return reply.code(500).send({ error: 'whatsapp_app_secret_not_configured' });
    }

    const rawBody = request.rawBody;
    if (!rawBody) {
      return reply.code(400).send({ error: 'missing_raw_body' });
    }

    const signature = request.headers['x-hub-signature-256'];
    const signatureHeader = Array.isArray(signature) ? signature[0] : signature;

    if (!verifyWhatsAppSignature(rawBody, signatureHeader, config.WHATSAPP_APP_SECRET)) {
      return reply.code(401).send({ error: 'invalid_whatsapp_signature' });
    }

    const events = parseWhatsAppWebhookPayload(request.body);

    for (const event of events) {
      if (event.kind === 'message') {
        await handlers?.onMessage?.(event.message);
      } else {
        await handlers?.onStatus?.(event.status);
      }
    }

    return reply.code(200).send({ ok: true });
  });
}
