import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

// HLD §9.2 security headers. Applied to every response.
//
// CSP per HLD: `default-src 'self'; object-src 'none'; frame-ancestors 'none'`.
// The Phase 1 SPA has zero inline scripts/styles (PR 11 used vanilla DOM
// helpers + CSS classes), so the policy can stay strict without escape hatches.
//
// /api/docs is intentionally exempt from the strict CSP because Swagger UI
// loads a chunk of inline CSS / data: images. PR 10 (AXI-119) wraps the docs
// in an is_admin preHandler anyway, so the looser CSP is bounded to admin
// users.

const STRICT_CSP =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "style-src 'self'; " +
  "img-src 'self' data:; " +
  "font-src 'self' data:; " +
  "connect-src 'self'; " +
  "object-src 'none'; " +
  "frame-ancestors 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self'";

// Swagger UI ships inline CSS + base64 SVG sprites; relax for /api/docs only.
const DOCS_CSP =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; " +
  "font-src 'self' data:; " +
  "connect-src 'self'; " +
  "object-src 'none'; " +
  "frame-ancestors 'none'";

async function securityHeadersPlugin(app: FastifyInstance): Promise<void> {
  app.addHook('onSend', async (req, reply) => {
    const url = req.url.split('?')[0] ?? req.url;
    reply.header(
      'content-security-policy',
      url.startsWith('/api/docs') ? DOCS_CSP : STRICT_CSP,
    );
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    reply.header(
      'permissions-policy',
      'geolocation=(), microphone=(), camera=(), payment=(), usb=()',
    );
    reply.header('cross-origin-opener-policy', 'same-origin');
    reply.header('cross-origin-resource-policy', 'same-origin');
    // Strict-Transport-Security only emitted in prod (NODE_ENV=production)
    // because dev runs over plain HTTP and HSTS would lock the browser into
    // HTTPS-only for localhost. Container Apps handles TLS termination.
    if (process.env.NODE_ENV === 'production') {
      reply.header('strict-transport-security', 'max-age=63072000; includeSubDomains; preload');
    }
  });
}

export default fp(securityHeadersPlugin, {
  name: 'security-headers',
});
