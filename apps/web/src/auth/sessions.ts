import { randomBytes } from 'node:crypto';
import { getPool } from '../db/pool.js';
import type { AuthenticatedSession, SessionRow, SessionUser } from './types.js';

// HLD §5.1: 8h idle timeout, 24h absolute timeout.
export const SESSION_IDLE_MS = 8 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 24 * 60 * 60 * 1000;

const TOKEN_BYTES = 32; // 256-bit (HLD §5.1)

/** Random 256-bit opaque token, URL-safe base64 (no padding). */
function generateOpaqueToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

interface CreateSessionInput {
  userId: string;
  userAgent: string | null;
  ip: string | null;
}

interface CreatedSession {
  cookieValue: string;
  session: SessionRow;
}

/**
 * Create a new session row and return the opaque cookie token. The cookie
 * value is the session's `token` column — there is no signing key (HLD §9.1).
 * Authority for the session lives in the row.
 */
export async function createSession(input: CreateSessionInput): Promise<CreatedSession> {
  const pool = getPool();
  const cookieValue = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + SESSION_ABSOLUTE_MS);

  const sql = `
    INSERT INTO sessions (id, user_id, token, issued_at, last_seen_at, expires_at, user_agent, ip)
    VALUES (gen_random_uuid(), $1, $2, now(), now(), $3, $4, $5::inet)
    RETURNING id, user_id, issued_at, last_seen_at, expires_at
  `;
  const { rows } = await pool.query<SessionRow>(sql, [
    input.userId,
    cookieValue,
    expiresAt,
    input.userAgent,
    input.ip,
  ]);
  const row = rows[0];
  if (!row) throw new Error('session insert returned no rows');

  return { cookieValue, session: row };
}

/**
 * Look up a session by its cookie token. Applies idle + absolute timeouts and
 * touches `last_seen_at` on success. Returns null if missing or expired.
 */
export async function lookupSession(token: string): Promise<AuthenticatedSession | null> {
  const pool = getPool();
  const sql = `
    SELECT
      s.id, s.user_id, s.issued_at, s.last_seen_at, s.expires_at,
      u.entra_oid, u.email, u.display_name, u.is_admin
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = $1
  `;
  const { rows } = await pool.query<{
    id: string;
    user_id: string;
    issued_at: Date;
    last_seen_at: Date;
    expires_at: Date;
    entra_oid: string;
    email: string;
    display_name: string;
    is_admin: boolean;
  }>(sql, [token]);
  const row = rows[0];
  if (!row) return null;

  const now = Date.now();
  if (now > row.expires_at.getTime() || now - row.last_seen_at.getTime() > SESSION_IDLE_MS) {
    await deleteSessionByToken(token);
    return null;
  }

  // Touch last_seen_at — small write, fine at expected RPS (HLD §3.2 ≤ 50
  // steady-state). Optimise to sampled writes later if PG CPU climbs.
  await pool.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [row.id]);

  const session: SessionRow = {
    id: row.id,
    user_id: row.user_id,
    issued_at: row.issued_at,
    last_seen_at: row.last_seen_at,
    expires_at: row.expires_at,
  };
  const user: SessionUser = {
    id: row.user_id,
    entraOid: row.entra_oid,
    email: row.email,
    displayName: row.display_name,
    isAdmin: row.is_admin,
  };
  return { session, user };
}

export async function deleteSessionByToken(token: string): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}
