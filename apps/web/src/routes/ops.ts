import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

const HealthResponse = z.object({
  status: z.literal('ok'),
});

const ReadyResponse = z.object({
  status: z.literal('ready'),
  checks: z.object({
    db: z.enum(['ok', 'unconfigured', 'failing']),
    entra: z.enum(['ok', 'unconfigured', 'failing']),
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
        'Readiness probe — checks DB pool warmup + Entra metadata fetch. ' +
        'Until those land (PR 5/15/16), checks are reported as `unconfigured`.',
      response: { 200: ReadyResponse },
    },
    handler: async () => ({
      status: 'ready' as const,
      checks: {
        db: 'unconfigured' as const,
        entra: 'unconfigured' as const,
      },
    }),
  });
}
