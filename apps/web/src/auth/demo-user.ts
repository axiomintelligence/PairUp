import { getPool } from '../db/pool.js';
import type { SessionUser } from './types.js';

// AUTH_DISABLED mode — used in non-production environments where we want the
// SPA to be navigable without an OIDC sign-in (HLD §5 mandates Entra in prod;
// this mode is explicitly off-by-default and never enabled in customer-tenant
// prod). Every request is authenticated as a fixed non-admin "demo user".
//
// Admin endpoints stay locked because the demo user has is_admin=false.

const DEMO_USER_OID = 'demo-no-auth-fixed-oid';
const DEMO_USER_EMAIL = 'demo@pairup.local';
const DEMO_USER_NAME = 'Demo User';

let cached: SessionUser | undefined;

export function isAuthDisabled(): boolean {
  return process.env.AUTH_DISABLED === 'true';
}

/**
 * Upsert and return the singleton demo user used when AUTH_DISABLED=true.
 * Cached after first lookup — boring DB read on every request would be wasteful.
 */
export async function getOrCreateDemoUser(): Promise<SessionUser> {
  if (cached) return cached;

  const pool = getPool();
  const sql = `
    INSERT INTO users (entra_oid, email, display_name, is_admin, last_seen_at)
    VALUES ($1, $2, $3, false, now())
    ON CONFLICT (entra_oid) DO UPDATE
      SET last_seen_at = now()
    RETURNING id, entra_oid, email, display_name, is_admin
  `;
  const { rows } = await pool.query<{
    id: string;
    entra_oid: string;
    email: string;
    display_name: string;
    is_admin: boolean;
  }>(sql, [DEMO_USER_OID, DEMO_USER_EMAIL, DEMO_USER_NAME]);
  const row = rows[0]!;
  cached = {
    id: row.id,
    entraOid: row.entra_oid,
    email: row.email,
    displayName: row.display_name,
    isAdmin: row.is_admin,
  };
  return cached;
}
