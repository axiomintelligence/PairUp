import { getPool } from '../db/pool.js';

/** Returns true when access_allowlist gating is on. */
export function isAllowlistEnabled(): boolean {
  return process.env.ACCESS_ALLOWLIST_ENABLED === 'true';
}

/** Case-insensitive lookup against `access_allowlist.email`. */
export async function isEmailAllowlisted(email: string): Promise<boolean> {
  const pool = getPool();
  const { rows } = await pool.query<{ email: string }>(
    'SELECT email FROM access_allowlist WHERE email = $1',
    [email],
  );
  return rows.length > 0;
}
