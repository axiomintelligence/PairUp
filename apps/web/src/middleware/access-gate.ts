import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { lookupSession } from '../auth/sessions.js';
import { SESSION_COOKIE } from '../auth/cookies.js';
import { Errors } from '../errors.js';
import { isAllowlistEnabled, isEmailAllowlisted } from '../auth/allowlist.js';
import { getOrCreateDemoUser, isAuthDisabled } from '../auth/demo-user.js';

// HLD §5.2 layer 1: every /api/* except /api/auth/* and /api/health|/api/ready
// requires a valid session. If ACCESS_ALLOWLIST_ENABLED, also requires the
// user's email to be in access_allowlist.

const PUBLIC_API_PREFIXES = [
  '/api/auth/',
  '/api/health',
  '/api/ready',
  '/api/docs',
  '/__mock-oidc/',
];

function isPublic(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  // Only /api/* + /__mock-oidc/* require authentication. Static assets
  // (index.html, app.js, styles.css, favicons) are served by the SPA from
  // the root and are public — the SPA itself calls /api/auth/me to learn
  // whether to render the sign-in screen.
  if (!path.startsWith('/api/') && !path.startsWith('/__mock-oidc/')) {
    return true;
  }
  return PUBLIC_API_PREFIXES.some((p) => path === p || path.startsWith(p));
}

async function accessGatePlugin(app: FastifyInstance): Promise<void> {
  if (isAuthDisabled()) {
    app.log.warn(
      'AUTH_DISABLED=true — every request is being authenticated as the demo user. ' +
        'Admin endpoints remain locked because the demo user is not an admin.',
    );
  }

  app.addHook('preHandler', async (req: FastifyRequest) => {
    if (isPublic(req.url)) return;

    if (isAuthDisabled()) {
      const user = await getOrCreateDemoUser();
      // Synthesise a session row so downstream handlers reading req.session
      // work unchanged.
      const now = new Date();
      req.session = {
        user,
        session: {
          id: '00000000-0000-0000-0000-000000000000',
          user_id: user.id,
          issued_at: now,
          last_seen_at: now,
          expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        },
      };
      return;
    }

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
