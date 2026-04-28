import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { getPool } from './pool.js';
import type { FastifyBaseLogger } from 'fastify';

// ───────────────────────────────────────────────────────────────────────────
// Migrations runner.
//
// HLD §6 + §17 specify: migrations run at API startup, serialised across
// replicas via a Postgres advisory lock. AXI-109 captures the open question
// of whether to keep this pattern or move migrations to a one-shot Container
// Apps Job. This module implements the HLD-as-written path; if the decision
// goes the other way, the call site at startup gets disabled and a Job
// invokes `runPendingMigrations()` directly.
//
// The advisory lock key `74617276` is the ASCII codes of "pg" + "mig" but as
// a stable bigint that any concurrent replica will request against the same
// database; only one replica can hold it at a time. This prevents two
// replicas from both calling `node-pg-migrate up` against a fresh DB and
// racing on the migrations table primary key.
// ───────────────────────────────────────────────────────────────────────────

const MIGRATION_ADVISORY_LOCK_KEY = 0x74_61_72_76;

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../migrations/migrations',
);

export interface RunMigrationsOptions {
  log: FastifyBaseLogger;
}

export async function runPendingMigrations({ log }: RunMigrationsOptions): Promise<void> {
  const pool = getPool();

  // Acquire advisory lock so only one replica runs migrations at a time.
  const client = await pool.connect();
  try {
    log.info({ key: MIGRATION_ADVISORY_LOCK_KEY }, 'acquiring migration advisory lock');
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_KEY]);

    log.info({ dir: MIGRATIONS_DIR }, 'running pending migrations');
    const applied = await runner({
      dbClient: client,
      dir: MIGRATIONS_DIR,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      log: (msg) => log.info({ migration: true }, msg),
      verbose: false,
      decamelize: false,
      noLock: true,
    });

    log.info(
      { count: applied.length, names: applied.map((m) => m.name) },
      'migrations complete',
    );
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_KEY]);
    } catch (err) {
      log.warn({ err }, 'failed to release migration advisory lock');
    }
    client.release();
  }
}
