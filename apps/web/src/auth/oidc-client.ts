import { jwtVerify, createRemoteJWKSet } from 'jose';
import type { IdTokenClaims } from './types.js';

export interface OidcConfig {
  /** OIDC discovery URL — points at the IdP's `.well-known/openid-configuration`. */
  discoveryUrl: string;
  /** App registration's client_id. */
  clientId: string;
  /** Tenant id to validate `tid` against (required for Entra). Empty string → skip. */
  expectedTenantId: string;
  /** Public redirect URL the IdP returned the user to. */
  redirectUri: string;
}

interface DiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

const DISCOVERY_CACHE_TTL_MS = 5 * 60 * 1000;
const cachedDiscovery: Map<string, { doc: DiscoveryDocument; fetchedAt: number }> = new Map();

async function fetchDiscovery(url: string): Promise<DiscoveryDocument> {
  const cached = cachedDiscovery.get(url);
  if (cached && Date.now() - cached.fetchedAt < DISCOVERY_CACHE_TTL_MS) {
    return cached.doc;
  }
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`OIDC discovery fetch failed: ${res.status} ${res.statusText}`);
  }
  const doc = (await res.json()) as DiscoveryDocument;
  cachedDiscovery.set(url, { doc, fetchedAt: Date.now() });
  return doc;
}

interface ExchangeOptions {
  code: string;
  codeVerifier: string;
}

interface TokenResponse {
  id_token: string;
  access_token?: string;
  token_type?: string;
  expires_in?: number;
}

export interface ExchangedIdToken {
  raw: string;
  claims: IdTokenClaims;
}

export class OidcClient {
  private readonly config: OidcConfig;
  private jwksCache?: ReturnType<typeof createRemoteJWKSet>;

  constructor(config: OidcConfig) {
    this.config = config;
  }

  async getDiscovery(): Promise<DiscoveryDocument> {
    return fetchDiscovery(this.config.discoveryUrl);
  }

  async authorizeUrl(params: {
    state: string;
    nonce: string;
    codeChallenge: string;
  }): Promise<string> {
    const { authorization_endpoint } = await this.getDiscovery();
    const url = new URL(authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('scope', 'openid profile email');
    url.searchParams.set('response_mode', 'query');
    url.searchParams.set('state', params.state);
    url.searchParams.set('nonce', params.nonce);
    url.searchParams.set('code_challenge', params.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  async exchangeCode(opts: ExchangeOptions, federatedAssertion?: string): Promise<ExchangedIdToken> {
    const { token_endpoint } = await this.getDiscovery();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      code: opts.code,
      code_verifier: opts.codeVerifier,
    });
    // Federated credential on the Container App MI (HLD §5, §9.1) — the
    // client_assertion replaces a client secret. PR 16 wires this against
    // the real Entra; mock-oidc accepts but ignores the assertion.
    if (federatedAssertion) {
      body.set('client_assertion_type', 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
      body.set('client_assertion', federatedAssertion);
    }

    const res = await fetch(token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Token exchange failed: ${res.status} ${text}`);
    }
    const tok = (await res.json()) as TokenResponse;
    if (!tok.id_token) {
      throw new Error('Token response missing id_token');
    }
    // Nonce check happens in the route handler (it owns the expected value)
    // since we don't have it here.
    const claims = await this.validateIdToken(tok.id_token);
    return { raw: tok.id_token, claims };
  }

  async validateIdToken(idToken: string, ctx: { nonce?: string } = {}): Promise<IdTokenClaims> {
    const { issuer, jwks_uri } = await this.getDiscovery();

    if (!this.jwksCache) {
      this.jwksCache = createRemoteJWKSet(new URL(jwks_uri));
    }

    const { payload } = await jwtVerify(idToken, this.jwksCache, {
      issuer,
      audience: this.config.clientId,
    });

    if (this.config.expectedTenantId && payload.tid !== this.config.expectedTenantId) {
      throw new Error(`tid claim mismatch: ${String(payload.tid)} != ${this.config.expectedTenantId}`);
    }
    if (ctx.nonce && payload.nonce !== ctx.nonce) {
      throw new Error('nonce mismatch in id_token');
    }

    return payload as unknown as IdTokenClaims;
  }
}

export function buildOidcClientFromEnv(opts: { redirectUri: string }): OidcClient {
  const discoveryUrl = process.env.OIDC_DISCOVERY_URL;
  const clientId = process.env.OIDC_CLIENT_ID;
  if (!discoveryUrl || !clientId) {
    throw new Error('OIDC_DISCOVERY_URL and OIDC_CLIENT_ID are required to build the OIDC client');
  }
  return new OidcClient({
    discoveryUrl,
    clientId,
    expectedTenantId: process.env.OIDC_EXPECTED_TENANT_ID ?? '',
    redirectUri: opts.redirectUri,
  });
}
