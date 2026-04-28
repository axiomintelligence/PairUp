import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { lookupSession } from '../auth/sessions.js';
import { SESSION_COOKIE } from '../auth/cookies.js';
import { Errors } from '../errors.js';
import { isAllowlistEnabled, isEmailAllowlisted } from '../auth/allowlist.js';

// HLD §5.2 layer 1: every /api/* except /api/auth/* and /api/health|/api/ready
// requires a valid session. If ACCESS_ALLOWLIST_ENABLED, also requires the
// user's email to be in access_allowlist.

const PUBLIC_PREFIXES = [
  '/api/auth/',
  '/api/health',
  '/api/ready',
  '/api/docs',
  // Mock OIDC endpoints — only mounted when MOCK_OIDC=true; harmless to allow
  // either way because they don't reach session-bearing code paths.
  '/__mock-oidc/',
];

function isPublic(url: string): boolean {
  // Strip query string for the prefix check.
  const path = url.split('?')[0] ?? url;
  return PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p));
}

async function accessGatePlugin(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (req: FastifyRequest) => {
    if (isPublic(req.url)) return;

    const token = req.cookies[SESSION_COOKIE];
    if (!token) throw Errors.notAuthenticated();

    const auth = await lookupSession(token);
    if (!auth) throw Errors.notAuthenticated();

    if (isAllowlistEnabled()) {
      const ok = await isEmailAllowlisted(auth.user.email);
      if (!ok) throw Errors.notInBeta();
    }

    req.session = auth;
  });
}

export default fp(accessGatePlugin, {
  name: 'access-gate',
  dependencies: ['@fastify/cookie'],
});
