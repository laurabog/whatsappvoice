import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import type {
  AudioDrainResult
} from '../jobs/audio-worker-runtime.js';
import type { RetentionCleanupResult } from '../services/retention-cleanup.js';

type AnyFastifyInstance = FastifyInstance<any, any, any, any, any>;

export type InternalJobHandlers = {
  drainJobs(input?: { maxJobs?: number }): Promise<AudioDrainResult>;
  runRetentionCleanup(): Promise<RetentionCleanupResult>;
};

export type RegisterInternalJobRoutesOptions = {
  config: Pick<AppConfig, 'INTERNAL_JOB_TOKEN'>;
  handlers?: InternalJobHandlers;
};

type DrainBody = {
  maxJobs?: unknown;
  runCleanup?: unknown;
};

function bearerToken(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization;
  const header = Array.isArray(authorization) ? authorization[0] : authorization;
  const match = header?.match(/^Bearer\s+(.+)$/i);

  return match?.[1] ?? null;
}

function maxJobsFromBody(body: unknown): number | undefined {
  if (!body || typeof body !== 'object') {
    return undefined;
  }

  const value = (body as DrainBody).maxJobs;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
  }

  return undefined;
}

function shouldRunCleanup(body: unknown): boolean {
  return Boolean(body && typeof body === 'object' && (body as DrainBody).runCleanup === true);
}

export function registerInternalJobRoutes(
  app: AnyFastifyInstance,
  { config, handlers }: RegisterInternalJobRoutesOptions
) {
  app.post('/internal/jobs/drain', async (request, reply) => {
    if (!config.INTERNAL_JOB_TOKEN) {
      return reply.code(503).send({ ok: false, error: 'internal_jobs_not_configured' });
    }

    if (bearerToken(request) !== config.INTERNAL_JOB_TOKEN) {
      return reply.code(401).send({ ok: false, error: 'unauthorized' });
    }

    if (!handlers) {
      return reply.code(503).send({ ok: false, error: 'internal_jobs_unavailable' });
    }

    const result = await handlers.drainJobs({
      maxJobs: maxJobsFromBody(request.body)
    });
    const cleanup = shouldRunCleanup(request.body)
      ? await handlers.runRetentionCleanup()
      : undefined;

    return reply.code(200).send({
      ...result,
      cleanup
    });
  });
}
