import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';

const PHASE_1_API_VERSION = '0.1.0';

async function openapiPlugin(app: FastifyInstance): Promise<void> {
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'PairUp API',
        description:
          'PairUp Phase 1 backend. All routes are served under /api/. Schemas are zod-derived.',
        version: PHASE_1_API_VERSION,
      },
      servers: [{ url: '/' }],
      components: {
        securitySchemes: {
          sessionCookie: {
            type: 'apiKey',
            in: 'cookie',
            name: 'pairup_session',
            description:
              'Server-side opaque session token (HttpOnly, Secure, SameSite=Lax). Authority is the sessions table.',
          },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  await app.register(swaggerUI, {
    routePrefix: '/api/docs',
    // PR 10 (AXI-119) wraps this in an is_admin preHandler.
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false,
    },
    staticCSP: true,
  });
}

export default fp(openapiPlugin, {
  name: 'openapi',
});
