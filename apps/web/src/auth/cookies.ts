import type { CookieSerializeOptions } from '@fastify/cookie';

// Cookie names — part of the contract with the frontend; do not rename
// without bumping the API version.
export const SESSION_COOKIE = 'pairup_session';
export const CSRF_COOKIE = 'pairup_csrf';
export const AUTH_FLOW_COOKIE = 'pairup_auth_flow';

const isProd = (): boolean => process.env.NODE_ENV === 'production';

/**
 * HLD §5.1 cookie flags for the session cookie.
 *  HttpOnly · Secure · SameSite=Lax · path=/
 *  Idle 8h handled by `last_seen_at` + a sliding `Max-Age` here.
 */
export function sessionCookieOptions(maxAgeSeconds: number): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

/**
 * The CSRF cookie is intentionally NOT HttpOnly — the frontend reads it and
 * echoes the value in an `X-CSRF-Token` header for double-submit verification.
 * Still Secure + SameSite=Lax so it can't be read cross-site.
 */
export function csrfCookieOptions(maxAgeSeconds: number): CookieSerializeOptions {
  return {
    httpOnly: false,
    secure: isProd(),
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

/**
 * Short-lived cookie that carries the OIDC `state` + `nonce` + PKCE
 * `code_verifier` from /api/auth/login through to /api/auth/callback. Cleared
 * the moment the callback succeeds (or fails). 10 minutes is plenty for an
 * end-user to complete sign-in.
 */
export function authFlowCookieOptions(): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: 10 * 60,
  };
}

export function clearedCookieOptions(path: string): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax',
    path,
    maxAge: 0,
    expires: new Date(0),
  };
}
