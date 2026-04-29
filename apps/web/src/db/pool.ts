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
/**
 * Assemble a libpq URL from the Container Apps Postgres dev-service binding
 * env vars (POSTGRES_HOST/USERNAME/PASSWORD/DATABASE/PORT) when DATABASE_URL
 * isn't set explicitly. PR 15 / AXI-124 swaps to Postgres Flex (private
 * endpoint, AAD auth via MI) at which point DATABASE_URL is constructed
 * differently and this fallback isn't used.
 */
function databaseUrlFromEnv(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const host = process.env.POSTGRES_HOST;
  const user = process.env.POSTGRES_USERNAME ?? process.env.POSTGRES_USER;
  const pw = process.env.POSTGRES_PASSWORD;
  const db = process.env.POSTGRES_DATABASE ?? process.env.POSTGRES_DB;
  const port = process.env.POSTGRES_PORT ?? '5432';
  if (host && user && pw && db) {
    const auth = `${encodeURIComponent(user)}:${encodeURIComponent(pw)}`;
    return `postgres://${auth}@${host}:${port}/${encodeURIComponent(db)}`;
  }
  return undefined;
}

export function getPool(): Pool {
  if (cached) return cached;

  const connectionString = databaseUrlFromEnv();
  if (!connectionString) {
    throw new Error(
      '[db.pool] DATABASE_URL not set and no POSTGRES_* binding found. ' +
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
