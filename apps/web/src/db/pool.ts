import { Pool, type PoolConfig } from 'pg';

let cached: Pool | undefined;

/**
 * Lazy singleton Pool. Per HLD §11.1 + §16.1, the API container connects via
 * PgBouncer transaction pool on port 6432 (PR 15). For local dev / tests, a
 * direct connection on 5432 is fine.
 *
 * Connection string is read from `DATABASE_URL` (libpq-compatible) so the
 * same code works against:
 *   - postgres://pairup:pairup@localhost:5432/pairup            (dev)
 *   - postgres://...@<aad-mi>...:6432/pairup?sslmode=require    (prod via MI; PR 15)
 */
export function getPool(): Pool {
  if (cached) return cached;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      '[db.pool] DATABASE_URL not set. ' +
        'Local dev: postgres://pairup:pairup@localhost:5432/pairup',
    );
  }

  // HLD §11.1: 10 connections per replica, hard cap 100.
  const config: PoolConfig = {
    connectionString,
    max: Number(process.env.DB_POOL_MAX ?? 10),
    application_name: 'pairup-web',
  };

  cached = new Pool(config);
  return cached;
}

export async function closePool(): Promise<void> {
  if (cached) {
    await cached.end();
    cached = undefined;
  }
}
