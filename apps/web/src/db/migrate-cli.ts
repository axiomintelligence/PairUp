// Standalone CLI entry point — runs migrations without booting Fastify.
// Used by:
//   • Local dev: `npm --workspace @pairup/web run migrate`
//   • The optional Container Apps Job path (AXI-109 option B), which invokes
//     this in the deploy pipeline instead of letting the API run them on
//     startup.
//
// Usage: tsx src/db/migrate-cli.ts up | down

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import pino from 'pino';
import { closePool, getPool } from './pool.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const direction = (process.argv[2] ?? 'up').toLowerCase();
if (direction !== 'up' && direction !== 'down') {
  log.error({ direction }, 'usage: migrate-cli.ts up|down');
  process.exit(2);
}

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../migrations/migrations',
);

const ADVISORY_LOCK_KEY = 0x74_61_72_76;

async function main(): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    log.info({ key: ADVISORY_LOCK_KEY }, 'acquiring migration advisory lock');
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);

    log.info({ dir: MIGRATIONS_DIR, direction }, 'running migrations');
    const applied = await runner({
      dbClient: client,
      dir: MIGRATIONS_DIR,
      direction: direction as 'up' | 'down',
      migrationsTable: 'pgmigrations',
      log: (msg) => log.info({ migration: true }, msg),
      verbose: false,
      decamelize: false,
      noLock: true,
      count: direction === 'down' ? 1 : Infinity,
    });

    log.info({ count: applied.length, names: applied.map((m) => m.name) }, 'done');
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
    } catch (err) {
      log.warn({ err }, 'failed to release advisory lock');
    }
    client.release();
    await closePool();
  }
}

try {
  await main();
} catch (err) {
  log.error({ err }, 'migration failed');
  await closePool().catch(() => {});
  process.exit(1);
}
