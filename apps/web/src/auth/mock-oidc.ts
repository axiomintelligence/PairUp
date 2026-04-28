import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { generateKeyPair, exportJWK, SignJWT, calculateJwkThumbprint, type KeyLike, type JWK } from 'jose';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

// ───────────────────────────────────────────────────────────────────────────
// Mock OIDC dev provider.
//
// Mounted under /__mock-oidc/* only when MOCK_OIDC=true. Implements the
// minimum slice of OIDC for the real OidcClient to authenticate against
// without any real IdP — discovery doc, JWKS, /authorize, /token. PR 16
// (AXI-125) flips OIDC_DISCOVERY_URL to Entra and this whole file goes
// unused in prod.
//
// /authorize accepts ?email=&name=&isAdmin=true to let test code log in as
// any synthetic user. The single in-memory keypair is generated on boot;
// signed id_tokens roundtrip cleanly through OidcClient.validateIdToken.
// ───────────────────────────────────────────────────────────────────────────

const MOCK_TENANT_ID = '00000000-0000-0000-0000-000000000001';
const MOCK_KID = 'mock-oidc-2026-04';

interface CodeRecord {
  email: string;
  name: string;
  isAdmin: boolean;
  oid: string;
  nonce: string | undefined;
  codeChallenge: string;
  redirectUri: string;
  state: string;
  expiresAt: number;
}

const codes: Map<string, CodeRecord> = new Map();
const CODE_TTL_MS = 5 * 60 * 1000;

function generateMockCode(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function generateMockOid(email: string): string {
  // Stable mock oid per email so re-logging the same user upserts in place.
  const hash = Buffer.from(email).toString('hex').padEnd(32, '0').slice(0, 32);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

interface MockKeys {
  privateKey: KeyLike;
  publicJwk: JWK;
  issuer: string;
}
let cachedKeys: MockKeys | undefined;

async function getKeys(issuer: string): Promise<MockKeys> {
  if (cachedKeys) return cachedKeys;
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = MOCK_KID;
  publicJwk.use = 'sig';
  publicJwk.alg = 'RS256';
  await calculateJwkThumbprint(publicJwk);
  const keys: MockKeys = { privateKey, publicJwk, issuer };
  cachedKeys = keys;
  return keys;
}

export interface MockOidcOptions {
  /** Public base URL the IdP should report as `iss` (e.g. http://localhost:8080). */
  publicBaseUrl: string;
}

export async function registerMockOidc(app: FastifyInstance, opts: MockOidcOptions): Promise<void> {
  const issuer = `${opts.publicBaseUrl.replace(/\/$/, '')}/__mock-oidc`;
  await getKeys(issuer);

  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/__mock-oidc/.well-known/openid-configuration',
    schema: { tags: ['mock-oidc'], hide: true },
    handler: async () => ({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      scopes_supported: ['openid', 'profile', 'email'],
      claims_supported: ['sub', 'oid', 'tid', 'email', 'name', 'preferred_username', 'roles'],
      code_challenge_methods_supported: ['S256'],
    }),
  });

  r.route({
    method: 'GET',
    url: '/__mock-oidc/jwks',
    schema: { tags: ['mock-oidc'], hide: true },
    handler: async () => {
      const keys = await getKeys(issuer);
      return { keys: [keys.publicJwk] };
    },
  });

  const AuthorizeQuery = z.object({
    response_type: z.literal('code'),
    client_id: z.string(),
    redirect_uri: z.string().url(),
    scope: z.string(),
    state: z.string(),
    nonce: z.string().optional(),
    code_challenge: z.string(),
    code_challenge_method: z.literal('S256'),
    response_mode: z.string().optional(),
    // Mock-only: which user to "log in as".
    email: z.string().email().optional(),
    name: z.string().optional(),
    isAdmin: z.string().optional(),
  });

  r.route({
    method: 'GET',
    url: '/__mock-oidc/authorize',
    schema: { tags: ['mock-oidc'], hide: true, querystring: AuthorizeQuery },
    handler: async (req, reply) => {
      const q = req.query as z.infer<typeof AuthorizeQuery>;
      const email = q.email ?? 'alice@axiomintelligence.co.uk';
      const name = q.name ?? 'Alice Example';
      const isAdmin = q.isAdmin === 'true';
      const code = generateMockCode();
      codes.set(code, {
        email: email.toLowerCase(),
        name,
        isAdmin,
        oid: generateMockOid(email),
        nonce: q.nonce,
        codeChallenge: q.code_challenge,
        redirectUri: q.redirect_uri,
        state: q.state,
        expiresAt: Date.now() + CODE_TTL_MS,
      });
      const cb = new URL(q.redirect_uri);
      cb.searchParams.set('code', code);
      cb.searchParams.set('state', q.state);
      reply.redirect(cb.toString(), 302);
    },
  });

  r.route({
    method: 'POST',
    url: '/__mock-oidc/token',
    schema: { tags: ['mock-oidc'], hide: true },
    handler: async (req, reply) => {
      const body = req.body as Record<string, string>;
      if (body.grant_type !== 'authorization_code') {
        reply.code(400);
        return { error: 'unsupported_grant_type' };
      }
      const rec = codes.get(body.code ?? '');
      if (!rec || rec.expiresAt < Date.now()) {
        reply.code(400);
        return { error: 'invalid_grant', error_description: 'unknown or expired code' };
      }
      codes.delete(body.code ?? '');

      // Verify PKCE — same shape OidcClient sends. Mirrors codeChallengeS256.
      const { createHash } = await import('node:crypto');
      const expectedChallenge = createHash('sha256')
        .update(body.code_verifier ?? '')
        .digest('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
      if (expectedChallenge !== rec.codeChallenge) {
        reply.code(400);
        return { error: 'invalid_grant', error_description: 'PKCE verifier mismatch' };
      }

      const now = Math.floor(Date.now() / 1000);
      const { privateKey } = await getKeys(issuer);
      const idToken = await new SignJWT({
        sub: rec.oid,
        oid: rec.oid,
        tid: MOCK_TENANT_ID,
        email: rec.email,
        preferred_username: rec.email,
        name: rec.name,
        nonce: rec.nonce,
        roles: rec.isAdmin ? ['Admin'] : [],
      })
        .setProtectedHeader({ alg: 'RS256', kid: MOCK_KID })
        .setIssuer(issuer)
        .setAudience(body.client_id ?? 'pairup-dev')
        .setIssuedAt(now)
        .setExpirationTime(now + 3600)
        .sign(privateKey);

      return {
        token_type: 'Bearer',
        expires_in: 3600,
        id_token: idToken,
        access_token: 'mock-access-token',
      };
    },
  });

  app.log.info({ issuer }, 'mock-oidc provider mounted at /__mock-oidc');
}

/** Convenience: returns the discovery URL of the mounted mock provider. */
export function mockOidcDiscoveryUrl(publicBaseUrl: string): string {
  return `${publicBaseUrl.replace(/\/$/, '')}/__mock-oidc/.well-known/openid-configuration`;
}
