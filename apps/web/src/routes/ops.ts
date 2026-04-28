import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { pingDb } from '../db/health.js';

const HealthResponse = z.object({
  status: z.literal('ok'),
});

const CheckStatus = z.enum(['ok', 'unconfigured', 'failing']);
const ReadyResponse = z.object({
  status: z.enum(['ready', 'degraded']),
  checks: z.object({
    db: CheckStatus,
    entra: CheckStatus,
  }),
});

export async function registerOpsRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/api/health',
    schema: {
      tags: ['ops'],
      summary: 'Liveness probe — returns 200 once the process is up.',
      response: { 200: HealthResponse },
    },
    handler: async () => ({ status: 'ok' as const }),
  });

  r.route({
    method: 'GET',
    url: '/api/ready',
    schema: {
      tags: ['ops'],
      summary:
        'Readiness probe — checks DB pool reachability + Entra metadata fetch. ' +
        'Entra wiring lands in PR 16; until then it reports `unconfigured`.',
      response: { 200: ReadyResponse, 503: ReadyResponse },
    },
    handler: async (_req, reply) => {
      const db = await pingDb();
      const checks = {
        db: db.status,
        entra: 'unconfigured' as const,
      };
      const isReady = checks.db !== 'failing';
      reply.code(isReady ? 200 : 503);
      return {
        status: (isReady ? 'ready' : 'degraded') as 'ready' | 'degraded',
        checks,
      };
    },
  });
}
