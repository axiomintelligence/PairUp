import { getPool } from '../db/pool.js';
import type { IdTokenClaims, SessionUser } from './types.js';

interface UserRow {
  id: string;
  entra_oid: string;
  email: string;
  display_name: string;
  is_admin: boolean;
}

const ADMIN_ROLE = 'Admin';

function rowToUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    entraOid: row.entra_oid,
    email: row.email,
    displayName: row.display_name,
    isAdmin: row.is_admin,
  };
}

/**
 * Upsert the user identified by the id_token's `oid` claim. Mirrors HLD §5
 * step 2 ("verify id_token, upsert user, set session cookie").
 *
 * `is_admin` is set on every login from the token's `roles` claim, so admin
 * grants/revokes in the Enterprise Apps blade take effect on next sign-in.
 */
export async function upsertUserFromClaims(claims: IdTokenClaims): Promise<SessionUser> {
  const oid = claims.oid ?? claims.sub;
  const email = (claims.email ?? claims.preferred_username ?? '').toLowerCase();
  const displayName = claims.name ?? email;
  const isAdmin = (claims.roles ?? []).includes(ADMIN_ROLE);

  if (!oid) throw new Error('id_token missing oid/sub claim');
  if (!email) throw new Error('id_token missing email/preferred_username claim');

  const pool = getPool();
  const sql = `
    INSERT INTO users (entra_oid, email, display_name, is_admin, last_seen_at)
    VALUES ($1, $2, $3, $4, now())
    ON CONFLICT (entra_oid) DO UPDATE
      SET email        = EXCLUDED.email,
          display_name = EXCLUDED.display_name,
          is_admin     = EXCLUDED.is_admin,
          last_seen_at = now()
    RETURNING id, entra_oid, email, display_name, is_admin
  `;
  const { rows } = await pool.query<UserRow>(sql, [oid, email, displayName, isAdmin]);
  if (rows.length === 0) throw new Error('user upsert returned no rows');
  return rowToUser(rows[0]!);
}

export async function findUserById(id: string): Promise<SessionUser | null> {
  const pool = getPool();
  const { rows } = await pool.query<UserRow>(
    'SELECT id, entra_oid, email, display_name, is_admin FROM users WHERE id = $1',
    [id],
  );
  return rows[0] ? rowToUser(rows[0]) : null;
}
