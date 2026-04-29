import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getPool } from '../db/pool.js';
import { writeAudit } from '../db/audit.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { SESSION_COOKIE, CSRF_COOKIE, clearedCookieOptions } from '../auth/cookies.js';

// ───────────────────────────────────────────────────────────────────────────
// HLD §10 GDPR endpoints.
//
// Right of access: GET /api/me/export returns the user's full profile +
// connections + requests as a JSON bundle (with a CSV connections subset for
// the UI download button — wired in PR 11).
//
// Right to erasure: DELETE /api/me cascades the user's row, which under the
// FKs from PR 4 wipes profiles, sessions, dismissals, search_prefs,
// connection_requests (cascade), and removes them from connections (cascade).
// audit_log keeps the audit trail with actor=NULL — PR 4 set ON DELETE SET
// NULL on actor_user_id specifically so audit history survives deletion (HLD
// §10 "no PII persists in audit_log").
// ───────────────────────────────────────────────────────────────────────────

const ExportResponse = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string(),
    displayName: z.string(),
    isAdmin: z.boolean(),
    createdAt: z.string().datetime(),
    lastSeenAt: z.string().datetime(),
  }),
  profile: z
    .object({
      status: z.string(),
      grade: z.string(),
      directorates: z.array(z.string()),
      location: z.string(),
      days: z.record(z.string()),
      visibility: z.record(z.string()),
      publishedAt: z.string().datetime().nullable(),
      updatedAt: z.string().datetime(),
    })
    .nullable(),
  searchPrefs: z
    .object({
      grade: z.string(),
      directorates: z.string(),
      location: z.string(),
      days: z.string(),
    })
    .nullable(),
  requests: z.array(
    z.object({
      id: z.string().uuid(),
      direction: z.enum(['inbound', 'outbound']),
      otherUserId: z.string().uuid(),
      status: z.string(),
      createdAt: z.string().datetime(),
      resolvedAt: z.string().datetime().nullable(),
    }),
  ),
  connections: z.array(
    z.object({
      id: z.string().uuid(),
      otherUserId: z.string().uuid(),
      createdAt: z.string().datetime(),
    }),
  ),
  exportedAt: z.string().datetime(),
});

export async function registerMeRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/api/me/export',
    schema: {
      tags: ['gdpr'],
      summary:
        'Right of access — returns the user’s full profile, search prefs, ' +
        'connection requests, and connections as a JSON bundle.',
      response: { 200: ExportResponse },
      security: [{ sessionCookie: [] }],
    },
    handler: async (req) => {
      const userId = req.session!.user.id;
      const pool = getPool();

      const [user, profile, prefs, requests, conns] = await Promise.all([
        pool.query<{
          id: string;
          email: string;
          display_name: string;
          is_admin: boolean;
          created_at: Date;
          last_seen_at: Date;
        }>(
          `SELECT id, email, display_name, is_admin, created_at, last_seen_at
           FROM users WHERE id = $1`,
          [userId],
        ),
        pool.query<{
          status: string;
          grade: string;
          directorates: string[];
          location: string;
          days: Record<string, string>;
          visibility: Record<string, string>;
          published_at: Date | null;
          updated_at: Date;
        }>(
          `SELECT status, grade, directorates, location, days, visibility,
                  published_at, updated_at
           FROM profiles WHERE user_id = $1`,
          [userId],
        ),
        pool.query<{
          grade: string;
          directorates: string;
          location: string;
          days: string;
        }>(
          `SELECT grade, directorates, location, days
           FROM search_prefs WHERE user_id = $1`,
          [userId],
        ),
        pool.query<{
          id: string;
          from_user_id: string;
          to_user_id: string;
          status: string;
          created_at: Date;
          resolved_at: Date | null;
        }>(
          `SELECT id, from_user_id, to_user_id, status, created_at, resolved_at
           FROM connection_requests
           WHERE from_user_id = $1 OR to_user_id = $1
           ORDER BY created_at`,
          [userId],
        ),
        pool.query<{ id: string; user_a_id: string; user_b_id: string; created_at: Date }>(
          `SELECT id, user_a_id, user_b_id, created_at
           FROM connections WHERE user_a_id = $1 OR user_b_id = $1
           ORDER BY created_at`,
          [userId],
        ),
      ]);
      const u = user.rows[0]!;

      return {
        user: {
          id: u.id,
          email: u.email,
          displayName: u.display_name,
          isAdmin: u.is_admin,
          createdAt: u.created_at.toISOString(),
          lastSeenAt: u.last_seen_at.toISOString(),
        },
        profile: profile.rows[0]
          ? {
              status: profile.rows[0].status,
              grade: profile.rows[0].grade,
              directorates: profile.rows[0].directorates,
              location: profile.rows[0].location,
              days: profile.rows[0].days,
              visibility: profile.rows[0].visibility,
              publishedAt: profile.rows[0].published_at?.toISOString() ?? null,
              updatedAt: profile.rows[0].updated_at.toISOString(),
            }
          : null,
        searchPrefs: prefs.rows[0] ?? null,
        requests: requests.rows.map((r) => ({
          id: r.id,
          direction: r.from_user_id === userId ? ('outbound' as const) : ('inbound' as const),
          otherUserId: r.from_user_id === userId ? r.to_user_id : r.from_user_id,
          status: r.status,
          createdAt: r.created_at.toISOString(),
          resolvedAt: r.resolved_at?.toISOString() ?? null,
        })),
        connections: conns.rows.map((c) => ({
          id: c.id,
          otherUserId: c.user_a_id === userId ? c.user_b_id : c.user_a_id,
          createdAt: c.created_at.toISOString(),
        })),
        exportedAt: new Date().toISOString(),
      };
    },
  });

  r.route({
    method: 'DELETE',
    url: '/api/me',
    preHandler: [verifyCsrf],
    schema: {
      tags: ['gdpr'],
      summary:
        'Right to erasure — hard-deletes the user. Cascades to profile, sessions, ' +
        'dismissals, search_prefs, connection_requests; removes them from connections. ' +
        'audit_log keeps history with actor=NULL.',
      response: { 204: z.null() },
      security: [{ sessionCookie: [] }],
    },
    handler: async (req, reply) => {
      const userId = req.session!.user.id;
      const pool = getPool();
      // Write the deletion audit row BEFORE the cascade, so actor_user_id is
      // still resolvable at write time. ON DELETE SET NULL on the FK is what
      // keeps the row after the cascade (HLD §10 "actor=[deleted]").
      await writeAudit({
        actorUserId: userId,
        action: 'user.deleted',
        target: userId,
        metadata: { mechanism: 'self-service' },
      });
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
      // Clear cookies — session row is already gone via FK cascade.
      reply.setCookie(SESSION_COOKIE, '', clearedCookieOptions('/'));
      reply.setCookie(CSRF_COOKIE, '', { ...clearedCookieOptions('/'), httpOnly: false });
      reply.code(204).send();
    },
  });
}
