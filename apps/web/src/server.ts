import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import sensible from '@fastify/sensible';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import errorHandler from './plugins/error-handler.js';
import openapi from './plugins/openapi.js';
import accessGate from './middleware/access-gate.js';
import { OidcClient } from './auth/oidc-client.js';
import { mockOidcDiscoveryUrl, registerMockOidc } from './auth/mock-oidc.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerOpsRoutes } from './routes/ops.js';

export interface BuildServerOptions {
  logLevel?: string;
}

// Pino redaction paths — applied to request/response logs.
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
  '*.token',
  '*.csrfToken',
];

function publicBaseUrl(): string {
  return process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 8080}`;
}

export async function buildServer(opts: BuildServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: opts.logLevel ?? process.env.LOG_LEVEL ?? 'info',
      redact: { paths: PINO_REDACT_PATHS, censor: '[redacted]' },
      formatters: {
        bindings: (b) => ({ pid: b.pid, hostname: b.hostname, service: 'pairup-web' }),
      },
    },
    disableRequestLogging: false,
    trustProxy: true,
    requestIdLogLabel: 'request_id',
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Plugins (order matters — cookie before access-gate; sensible early; error-handler can be last).
  await app.register(cookie);
  await app.register(formbody); // OIDC /token uses application/x-www-form-urlencoded
  await app.register(sensible);
  await app.register(errorHandler);
  await app.register(openapi);

  // Mock OIDC — dev-only. Mounted before the access gate so its endpoints are
  // reachable; the gate's PUBLIC_PREFIXES list also exempts /__mock-oidc.
  const useMockOidc = process.env.MOCK_OIDC === 'true';
  if (useMockOidc) {
    await registerMockOidc(app, { publicBaseUrl: publicBaseUrl() });
  }

  // Access gate (HLD §5.2 layer 1) — every /api/* except /api/auth/*, /api/health,
  // /api/ready, /api/docs is gated on a valid session (and access_allowlist if
  // ACCESS_ALLOWLIST_ENABLED).
  await app.register(accessGate);

  // Routes
  await registerOpsRoutes(app);

  if (process.env.OIDC_DISCOVERY_URL || useMockOidc) {
    const discoveryUrl = process.env.OIDC_DISCOVERY_URL ?? mockOidcDiscoveryUrl(publicBaseUrl());
    const clientId = process.env.OIDC_CLIENT_ID ?? 'pairup-dev';
    const redirectUri =
      process.env.OIDC_REDIRECT_URI ?? `${publicBaseUrl()}/api/auth/callback`;
    const oidc = new OidcClient({
      discoveryUrl,
      clientId,
      expectedTenantId: process.env.OIDC_EXPECTED_TENANT_ID ?? '',
      redirectUri,
    });
    await registerAuthRoutes(app, { oidc, mockOidc: useMockOidc });
  } else {
    app.log.warn(
      'OIDC_DISCOVERY_URL not set and MOCK_OIDC!=true; /api/auth/* routes are not registered',
    );
  }

  return app;
}
