import type { FastifyInstance, FastifyError } from 'fastify';
import fp from 'fastify-plugin';
import { ApiException, type ApiError, type ErrorCode } from '../errors.js';

interface ErrorBody {
  error: ApiError;
}

function shapeErrorBody(code: ErrorCode, message: string): ErrorBody {
  return { error: { code, message } };
}

async function errorHandlerPlugin(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiException) {
      reply.code(err.statusCode).send(shapeErrorBody(err.code, err.message));
      return;
    }

    if ((err as FastifyError).statusCode === 429) {
      reply.code(429).send(shapeErrorBody('rate_limited', err.message));
      return;
    }

    const fe = err as FastifyError;
    const statusCode = fe.statusCode ?? 500;

    // Validation errors come from two paths: classic Fastify validators
    // (which set `err.validation`) and `fastify-type-provider-zod` (which
    // throws a plain `Error` carrying the zod issues as JSON in `.message`
    // and is wrapped by Fastify with `code === 'FST_ERR_VALIDATION'`). All
    // ApiException-derived 400s have already been handled above, so any
    // remaining 400 here is a request-shape problem.
    if (fe.validation || fe.code === 'FST_ERR_VALIDATION' || statusCode === 400) {
      req.log.info({ err }, 'request validation failed');
      reply
        .code(400)
        .send(shapeErrorBody('validation_error', err.message ?? 'Bad request'));
      return;
    }

    if (statusCode >= 500) {
      // Don't leak internal error messages.
      req.log.error({ err }, 'unhandled error');
      reply.code(500).send(shapeErrorBody('internal_error', 'Internal server error'));
      return;
    }

    // 4xx fall-throughs. Map well-known statuses to their canonical codes;
    // anything else surfaces as `not_found` (the closest 4xx code in our
    // envelope) so we don't leak a misleading default.
    const fallback4xxCode: 'not_authenticated' | 'forbidden' | 'not_found' | 'conflict' =
      statusCode === 401
        ? 'not_authenticated'
        : statusCode === 403
          ? 'forbidden'
          : statusCode === 409
            ? 'conflict'
            : 'not_found';
    reply
      .code(statusCode)
      .send(shapeErrorBody(fallback4xxCode, err.message ?? 'Request failed'));
  });

  app.setNotFoundHandler((req, reply) => {
    // API + mock-oidc: JSON envelope.
    if (req.url.startsWith('/api/') || req.url.startsWith('/__mock-oidc/')) {
      reply.code(404).send(shapeErrorBody('not_found', 'Not found'));
      return;
    }
    // SPA fallback for browser navigations — serve the static index so
    // client-side routing can take over. @fastify/static decorates `reply`
    // with `sendFile`; the cast keeps the types narrow.
    const sendFile = (reply as unknown as { sendFile?: (p: string) => unknown }).sendFile;
    if (typeof sendFile === 'function') {
      return sendFile.call(reply, 'index.html');
    }
    reply.code(404).send(shapeErrorBody('not_found', 'Not found'));
  });
}

export default fp(errorHandlerPlugin, {
  name: 'error-handler',
});
