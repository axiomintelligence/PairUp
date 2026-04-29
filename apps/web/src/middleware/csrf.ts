import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { CSRF_COOKIE } from '../auth/cookies.js';
import { Errors } from '../errors.js';
import { isAuthDisabled } from '../auth/demo-user.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit token verifier (HLD §5.3 / §9.2). Compares the value of the
 * non-HttpOnly `pairup_csrf` cookie against the `X-CSRF-Token` header on
 * state-changing requests. Use as a route-group preHandler — `GET`-shaped
 * routes opt out automatically.
 *
 * Skipped under AUTH_DISABLED=true: there's no auth, so CSRF protection has
 * nothing meaningful to defend (anyone can already call any endpoint).
 */
export async function verifyCsrf(req: FastifyRequest): Promise<void> {
  if (SAFE_METHODS.has(req.method)) return;
  if (isAuthDisabled()) return;

  const cookieToken = req.cookies[CSRF_COOKIE];
  const headerToken =
    typeof req.headers['x-csrf-token'] === 'string' ? req.headers['x-csrf-token'] : '';

  if (!cookieToken || !headerToken || cookieToken.length !== headerToken.length) {
    throw Errors.forbidden('CSRF token missing or mismatch');
  }
  const a = Buffer.from(cookieToken);
  const b = Buffer.from(headerToken);
  if (!timingSafeEqual(a, b)) {
    throw Errors.forbidden('CSRF token mismatch');
  }
}
