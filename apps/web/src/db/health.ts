import { getPool } from './pool.js';

export type DbCheckStatus = 'ok' | 'unconfigured' | 'failing';

export interface DbCheckResult {
  status: DbCheckStatus;
  detail?: string;
}

const PING_TIMEOUT_MS = 1500;

export async function pingDb(): Promise<DbCheckResult> {
  if (!process.env.DATABASE_URL) {
    return { status: 'unconfigured' };
  }
  try {
    const pool = getPool();
    const result = await Promise.race<{ rows: unknown[] }>([
      pool.query('SELECT 1'),
      new Promise<{ rows: unknown[] }>((_, reject) =>
        setTimeout(() => reject(new Error('db ping timeout')), PING_TIMEOUT_MS),
      ),
    ]);
    return result.rows.length === 1 ? { status: 'ok' } : { status: 'failing', detail: 'unexpected result' };
  } catch (err) {
    return { status: 'failing', detail: err instanceof Error ? err.message : String(err) };
  }
}
