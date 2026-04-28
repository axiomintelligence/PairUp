import { buildServer } from './server.js';

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? '0.0.0.0';

const app = buildServer();

app
  .listen({ port, host })
  .then((address) => {
    app.log.info({ address }, 'pairup-web listening');
  })
  .catch((err) => {
    app.log.error(err, 'failed to start server');
    process.exit(1);
  });

const shutdown = (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  app.close().finally(() => process.exit(0));
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
