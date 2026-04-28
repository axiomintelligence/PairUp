import { buildServer } from './server.js';
import { closePool } from './db/pool.js';
import { runPendingMigrations } from './db/migrate.js';

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? '0.0.0.0';

const app = await buildServer();

// HLD §6 + §17: migrations run on API startup under a Postgres advisory lock.
// AXI-109 captures the pending decision to move to a Container Apps Job; if it
// flips, set RUN_MIGRATIONS_ON_STARTUP=false on the API container and run the
// `migrate` script as a Job in the deploy pipeline before promoting traffic.
const shouldMigrateOnStartup =
  process.env.DATABASE_URL && process.env.RUN_MIGRATIONS_ON_STARTUP !== 'false';

if (shouldMigrateOnStartup) {
  try {
    await runPendingMigrations({ log: app.log });
  } catch (err) {
    app.log.error({ err }, 'migrations failed at startup; refusing to listen');
    await closePool();
    process.exit(1);
  }
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  try {
    await app.close();
  } finally {
    await closePool();
    process.exit(0);
  }
};

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

try {
  const address = await app.listen({ port, host });
  app.log.info({ address }, 'pairup-web listening');
} catch (err) {
  app.log.error(err, 'failed to start server');
  await closePool();
  process.exit(1);
}
