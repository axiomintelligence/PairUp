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

    if ((err as FastifyError).validation) {
      req.log.info({ err }, 'request validation failed');
      reply
        .code(400)
        .send(shapeErrorBody('validation_error', err.message));
      return;
    }

    const statusCode = (err as FastifyError).statusCode ?? 500;

    if (statusCode >= 500) {
      // Don't leak internal error messages.
      req.log.error({ err }, 'unhandled error');
      reply.code(500).send(shapeErrorBody('internal_error', 'Internal server error'));
      return;
    }

    // 4xx pass-throughs (e.g. 404 from notFound() handler)
    reply
      .code(statusCode)
      .send(shapeErrorBody('not_found', err.message ?? 'Not found'));
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send(shapeErrorBody('not_found', 'Not found'));
  });
}

export default fp(errorHandlerPlugin, {
  name: 'error-handler',
});
