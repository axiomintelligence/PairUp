import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  AUTH_FLOW_COOKIE,
  CSRF_COOKIE,
  SESSION_COOKIE,
  authFlowCookieOptions,
  clearedCookieOptions,
  csrfCookieOptions,
  sessionCookieOptions,
} from '../auth/cookies.js';
import { OidcClient } from '../auth/oidc-client.js';
import {
  codeChallengeS256,
  generateCodeVerifier,
  generateNonce,
  generateRandomState,
} from '../auth/pkce.js';
import {
  SESSION_ABSOLUTE_MS,
  createSession,
  deleteSessionByToken,
  lookupSession,
} from '../auth/sessions.js';
import { upsertUserFromClaims } from '../auth/users.js';
import { Errors } from '../errors.js';

interface AuthFlowEnvelope {
  state: string;
  nonce: string;
  codeVerifier: string;
  next: string;
}

function encodeFlow(env: AuthFlowEnvelope): string {
  return Buffer.from(JSON.stringify(env)).toString('base64url');
}
function decodeFlow(value: string): AuthFlowEnvelope {
  try {
    const obj = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as AuthFlowEnvelope;
    if (typeof obj.state !== 'string' || typeof obj.nonce !== 'string' ||
        typeof obj.codeVerifier !== 'string' || typeof obj.next !== 'string') {
      throw new Error('shape mismatch');
    }
    return obj;
  } catch (err) {
    throw Errors.notAuthenticated();
  }
}

function safeNext(value: string | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

function generateCsrfToken(): string {
  return randomBytes(24).toString('base64url');
}

const MeResponse = z.object({
  authenticated: z.boolean(),
  user: z
    .object({
      id: z.string().uuid(),
      email: z.string().email(),
      displayName: z.string(),
      isAdmin: z.boolean(),
    })
    .nullable(),
});

const LoginQuery = z.object({
  next: z.string().optional(),
  // Mock-OIDC convenience: when MOCK_OIDC=true, frontend passes ?email=&isAdmin=
  // through to /authorize so dev sign-in can target a specific user.
  email: z.string().email().optional(),
  name: z.string().optional(),
  isAdmin: z.string().optional(),
});

const CallbackQuery = z.object({
  code: z.string(),
  state: z.string(),
});

export interface AuthRoutesDeps {
  oidc: OidcClient;
  /** True iff MOCK_OIDC=true. Lets /api/auth/login pass mock user hints through. */
  mockOidc: boolean;
}

export async function registerAuthRoutes(app: FastifyInstance, deps: AuthRoutesDeps): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/api/auth/login',
    schema: {
      tags: ['auth'],
      summary: 'Begin sign-in: 302 to the IdP /authorize endpoint with PKCE.',
      querystring: LoginQuery,
    },
    handler: async (req, reply) => {
      const q = req.query as z.infer<typeof LoginQuery>;
      const next = safeNext(q.next);

      const state = generateRandomState();
      const nonce = generateNonce();
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = codeChallengeS256(codeVerifier);

      const authorizeUrl = await deps.oidc.authorizeUrl({ state, nonce, codeChallenge });

      // Pass mock-user hints through to the mock-oidc /authorize when in dev.
      const finalUrl = (() => {
        if (!deps.mockOidc) return authorizeUrl;
        const u = new URL(authorizeUrl);
        if (q.email) u.searchParams.set('email', q.email);
        if (q.name) u.searchParams.set('name', q.name);
        if (q.isAdmin) u.searchParams.set('isAdmin', q.isAdmin);
        return u.toString();
      })();

      reply.setCookie(
        AUTH_FLOW_COOKIE,
        encodeFlow({ state, nonce, codeVerifier, next }),
        authFlowCookieOptions(),
      );
      reply.redirect(finalUrl, 302);
    },
  });

  r.route({
    method: 'GET',
    url: '/api/auth/callback',
    schema: {
      tags: ['auth'],
      summary: 'IdP callback: exchanges code, validates id_token, sets session cookie.',
      querystring: CallbackQuery,
    },
    handler: async (req, reply) => {
      const q = req.query as z.infer<typeof CallbackQuery>;
      const flowCookie = req.cookies[AUTH_FLOW_COOKIE];
      if (!flowCookie) throw Errors.notAuthenticated();
      const flow = decodeFlow(flowCookie);

      // Clear the flow cookie regardless of outcome.
      reply.setCookie(AUTH_FLOW_COOKIE, '', clearedCookieOptions('/api/auth'));

      if (q.state !== flow.state) {
        req.log.warn({ expected: flow.state, got: q.state }, 'state mismatch');
        throw Errors.notAuthenticated();
      }

      const exchanged = await deps.oidc.exchangeCode({
        code: q.code,
        codeVerifier: flow.codeVerifier,
      });
      if (exchanged.claims.nonce !== flow.nonce) {
        throw Errors.notAuthenticated();
      }

      const user = await upsertUserFromClaims(exchanged.claims);

      const userAgent = req.headers['user-agent'] ?? null;
      const ip = req.ip ?? null;
      const { cookieValue } = await createSession({
        userId: user.id,
        userAgent,
        ip,
      });

      reply.setCookie(
        SESSION_COOKIE,
        cookieValue,
        sessionCookieOptions(Math.floor(SESSION_ABSOLUTE_MS / 1000)),
      );
      reply.setCookie(
        CSRF_COOKIE,
        generateCsrfToken(),
        csrfCookieOptions(Math.floor(SESSION_ABSOLUTE_MS / 1000)),
      );
      req.log.info({ userId: user.id }, 'session created');
      reply.redirect(flow.next, 302);
    },
  });

  r.route({
    method: 'POST',
    url: '/api/auth/logout',
    schema: {
      tags: ['auth'],
      summary: 'Clear cookies and delete the session row.',
      response: { 204: z.null() },
    },
    handler: async (req, reply) => {
      const token = req.cookies[SESSION_COOKIE];
      if (token) await deleteSessionByToken(token);
      reply.setCookie(SESSION_COOKIE, '', clearedCookieOptions('/'));
      reply.setCookie(CSRF_COOKIE, '', { ...clearedCookieOptions('/'), httpOnly: false });
      reply.code(204).send();
    },
  });

  r.route({
    method: 'GET',
    url: '/api/auth/me',
    schema: {
      tags: ['auth'],
      summary: 'Return the current session user (or {authenticated:false}).',
      response: { 200: MeResponse },
    },
    handler: async (req) => {
      const token = req.cookies[SESSION_COOKIE];
      if (!token) return { authenticated: false, user: null };
      const auth = await lookupSession(token);
      if (!auth) return { authenticated: false, user: null };
      return {
        authenticated: true,
        user: {
          id: auth.user.id,
          email: auth.user.email,
          displayName: auth.user.displayName,
          isAdmin: auth.user.isAdmin,
        },
      };
    },
  });
}
