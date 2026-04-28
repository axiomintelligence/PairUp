import Fastify, { type FastifyInstance } from 'fastify';

export interface BuildServerOptions {
  logLevel?: string;
}

export function buildServer(opts: BuildServerOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: {
      level: opts.logLevel ?? process.env.LOG_LEVEL ?? 'info',
    },
    disableRequestLogging: false,
    trustProxy: true,
  });

  app.get('/api/health', async () => ({ status: 'ok' }));
  app.get('/api/ready', async () => ({ status: 'ready' }));

  return app;
}
