import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import errorHandler from './plugins/error-handler.js';
import openapi from './plugins/openapi.js';
import { registerOpsRoutes } from './routes/ops.js';

export interface BuildServerOptions {
  logLevel?: string;
}

// Pino redaction paths — applied to request/response logs.
// We never want raw email, profile free-text, or session tokens in logs.
// HLD §9.2 + §13: PII fields redacted at log emission.
const PINO_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.email',
  '*.email_citext',
  '*.entra_oid',
  '*.id_token',
  '*.access_token',
  '*.refresh_token',
  '*.password',
  '*.session_id',
  '*.csrfToken',
];

export async function buildServer(opts: BuildServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: opts.logLevel ?? process.env.LOG_LEVEL ?? 'info',
      redact: { paths: PINO_REDACT_PATHS, censor: '[redacted]' },
      // request_id is set on every request log line — Fastify generates the id;
      // including it in the bindings makes downstream log queries trivial.
      formatters: {
        bindings: (b) => ({ pid: b.pid, hostname: b.hostname, service: 'pairup-web' }),
      },
    },
    disableRequestLogging: false,
    trustProxy: true,
    requestIdLogLabel: 'request_id',
  }).withTypeProvider<ZodTypeProvider>();

  // zod ↔ Fastify integration: validators + JSON-schema serialiser for OpenAPI.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Plugins
  await app.register(sensible);
  await app.register(errorHandler);
  await app.register(openapi);

  // Routes
  await registerOpsRoutes(app);

  return app;
}
