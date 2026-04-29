import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getPool } from '../db/pool.js';
import { writeAudit } from '../db/audit.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { requireAdmin } from '../middleware/admin.js';
import { Errors } from '../errors.js';

// HLD §5.4 admin capabilities — explicitly excludes impersonation, editing
// other users' profiles, and viewing any user's raw profile JSON. Surface
// here is stats / scoring tunables / allowlist / audit.

const StatsResponse = z.object({
  users: z.number().int().nonnegative(),
  publishedProfiles: z.number().int().nonnegative(),
  pendingRequests: z.number().int().nonnegative(),
  acceptedConnections: z.number().int().nonnegative(),
  signupsLast7Days: z.number().int().nonnegative(),
});

const WeightsSchema = z.object({
  gradePenalty: z.enum(['hard', 'heavy', 'light', 'none']),
  outboundPendingCap: z.number().int().min(1).max(10_000),
});

const Email = z.string().email().max(254);

// Bulk operations validate each email per-row in the handler so we can return
// partial success ({added, alreadyPresent, rejected:[{email, reason}]}) per
// HLD §5.4 allowlist UX. Top-level zod just enforces "is a string array,
// length 1..1000".
const BulkAddBody = z.object({
  emails: z.array(z.string().min(1).max(254)).min(1).max(1000),
  note: z.string().max(500).nullish(),
});
const BulkAddResponse = z.object({
  added: z.number().int().nonnegative(),
  alreadyPresent: z.number().int().nonnegative(),
  rejected: z.array(z.object({ email: z.string(), reason: z.string() })),
});

const BulkRemoveBody = z.object({
  emails: z.array(z.string().min(1).max(254)).min(1).max(1000),
});

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BulkRemoveResponse = z.object({
  removed: z.number().int().nonnegative(),
  notPresent: z.number().int().nonnegative(),
});

const AllowlistEntry = z.object({
  email: z.string(),
  addedBy: z.string().uuid().nullable(),
  addedAt: z.string().datetime(),
  note: z.string().nullable(),
});

const AllowlistListQuery = z.object({
  q: z.string().optional(),
  cursor: z.string().optional(),
});
const AllowlistListResponse = z.object({
  entries: z.array(AllowlistEntry),
  nextCursor: z.string().nullable(),
});

const AuditEntry = z.object({
  id: z.string(),
  at: z.string().datetime(),
  actorUserId: z.string().uuid().nullable(),
  action: z.string(),
  target: z.string().nullable(),
});
const AuditQuery = z.object({
  action: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
const AuditResponse = z.object({
  entries: z.array(AuditEntry),
});

const SingleAllowlistAdd = z.object({
  email: Email,
  note: z.string().max(500).nullish(),
});

const PAGE = 100;

function csvEscape(value: string | null): string {
  if (value == null) return '';
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // HLD §7.1: admin routes = 120/minute/session.
  const adminRateLimit = { rateLimit: { max: 120, timeWindow: '1 minute' } };

  // ─── Stats ─────────────────────────────────────────────────────────────

  r.route({
    method: 'GET',
    url: '/api/admin/stats',
    schema: { tags: ['admin'], response: { 200: StatsResponse } },
    preHandler: [requireAdmin],
    config: adminRateLimit,
    handler: async () => {
      const pool = getPool();
      const [u, pp, pr, cn, su] = await Promise.all([
        pool.query<{ c: string }>('SELECT count(*)::text AS c FROM users'),
        pool.query<{ c: string }>(
          "SELECT count(*)::text AS c FROM profiles WHERE status = 'published'",
        ),
        pool.query<{ c: string }>(
          "SELECT count(*)::text AS c FROM connection_requests WHERE status = 'pending'",
        ),
        pool.query<{ c: string }>('SELECT count(*)::text AS c FROM connections'),
        pool.query<{ c: string }>(
          "SELECT count(*)::text AS c FROM users WHERE created_at >= now() - interval '7 days'",
        ),
      ]);
      return {
        users: Number(u.rows[0]!.c),
        publishedProfiles: Number(pp.rows[0]!.c),
        pendingRequests: Number(pr.rows[0]!.c),
        acceptedConnections: Number(cn.rows[0]!.c),
        signupsLast7Days: Number(su.rows[0]!.c),
      };
    },
  });

  // ─── Weights / scoring config ──────────────────────────────────────────

  r.route({
    method: 'GET',
    url: '/api/admin/weights',
    schema: { tags: ['admin'], response: { 200: WeightsSchema } },
    preHandler: [requireAdmin],
    config: adminRateLimit,
    handler: async () => {
      const pool = getPool();
      const { rows } = await pool.query<{
        grade_penalty: 'hard' | 'heavy' | 'light' | 'none';
        outbound_pending_cap: number;
      }>(
        'SELECT grade_penalty, outbound_pending_cap FROM admin_config WHERE id = 1',
      );
      const row = rows[0]!;
      return {
        gradePenalty: row.grade_penalty,
        outboundPendingCap: row.outbound_pending_cap,
      };
    },
  });

  r.route({
    method: 'PUT',
    url: '/api/admin/weights',
    schema: { tags: ['admin'], body: WeightsSchema, response: { 200: WeightsSchema } },
    config: adminRateLimit,
    preHandler: [requireAdmin, verifyCsrf],
    handler: async (req) => {
      const body = req.body as z.infer<typeof WeightsSchema>;
      const pool = getPool();
      const { rows } = await pool.query<{
        grade_penalty: 'hard' | 'heavy' | 'light' | 'none';
        outbound_pending_cap: number;
      }>(
        `UPDATE admin_config
         SET grade_penalty = $1,
             outbound_pending_cap = $2,
             updated_by = $3,
             updated_at = now()
         WHERE id = 1
         RETURNING grade_penalty, outbound_pending_cap`,
        [body.gradePenalty, body.outboundPendingCap, req.session!.user.id],
      );
      await writeAudit({
        actorUserId: req.session!.user.id,
        action: 'admin_config.updated',
        target: 'admin_config',
        metadata: body as unknown as Record<string, unknown>,
      });
      const row = rows[0]!;
      return {
        gradePenalty: row.grade_penalty,
        outboundPendingCap: row.outbound_pending_cap,
      };
    },
  });

  // ─── Allowlist (HLD §5.4 + spec allowlist UX) ──────────────────────────

  r.route({
    method: 'GET',
    url: '/api/admin/allowlist',
    schema: {
      tags: ['admin'],
      querystring: AllowlistListQuery,
      response: { 200: AllowlistListResponse },
    },
    preHandler: [requireAdmin],
    config: adminRateLimit,
    handler: async (req) => {
      const { q, cursor } = req.query as z.infer<typeof AllowlistListQuery>;
      const pool = getPool();
      const params: unknown[] = [];
      const filters: string[] = [];
      if (q) {
        params.push(`%${q}%`);
        filters.push(`email ILIKE $${params.length}`);
      }
      if (cursor) {
        params.push(cursor);
        filters.push(`email > $${params.length}`);
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      params.push(PAGE + 1);
      const limitIndex = params.length;
      const { rows } = await pool.query<{
        email: string;
        added_by: string | null;
        added_at: Date;
        note: string | null;
      }>(
        `SELECT email, added_by, added_at, note
         FROM access_allowlist ${where}
         ORDER BY email ASC
         LIMIT $${limitIndex}`,
        params,
      );
      const slice = rows.slice(0, PAGE);
      const last = slice[slice.length - 1];
      return {
        entries: slice.map((row) => ({
          email: row.email,
          addedBy: row.added_by,
          addedAt: row.added_at.toISOString(),
          note: row.note,
        })),
        nextCursor: rows.length > PAGE && last ? last.email : null,
      };
    },
  });

  r.route({
    method: 'GET',
    url: '/api/admin/allowlist.csv',
    schema: { tags: ['admin'] },
    preHandler: [requireAdmin],
    config: adminRateLimit,
    handler: async (_req, reply) => {
      const pool = getPool();
      const { rows } = await pool.query<{
        email: string;
        added_by: string | null;
        added_at: Date;
        note: string | null;
      }>(
        `SELECT email, added_by, added_at, note FROM access_allowlist ORDER BY email`,
      );
      const lines = ['email,added_by,added_at,note'];
      for (const row of rows) {
        lines.push(
          [
            csvEscape(row.email),
            csvEscape(row.added_by),
            row.added_at.toISOString(),
            csvEscape(row.note),
          ].join(','),
        );
      }
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', `attachment; filename="allowlist-${new Date().toISOString().slice(0, 10)}.csv"`);
      return lines.join('\n');
    },
  });

  r.route({
    method: 'POST',
    url: '/api/admin/allowlist',
    schema: { tags: ['admin'], body: SingleAllowlistAdd, response: { 201: AllowlistEntry } },
    config: adminRateLimit,
    preHandler: [requireAdmin, verifyCsrf],
    handler: async (req, reply) => {
      const body = req.body as z.infer<typeof SingleAllowlistAdd>;
      const email = body.email.toLowerCase();
      const pool = getPool();
      const { rows } = await pool.query<{
        email: string;
        added_by: string | null;
        added_at: Date;
        note: string | null;
      }>(
        `INSERT INTO access_allowlist (email, added_by, note)
         VALUES ($1, $2, $3)
         ON CONFLICT (email) DO UPDATE
           SET note = COALESCE(EXCLUDED.note, access_allowlist.note)
         RETURNING email, added_by, added_at, note`,
        [email, req.session!.user.id, body.note ?? null],
      );
      await writeAudit({
        actorUserId: req.session!.user.id,
        action: 'allowlist.added',
        target: email,
      });
      reply.code(201);
      const row = rows[0]!;
      return {
        email: row.email,
        addedBy: row.added_by,
        addedAt: row.added_at.toISOString(),
        note: row.note,
      };
    },
  });

  r.route({
    method: 'POST',
    url: '/api/admin/allowlist/bulk-add',
    schema: { tags: ['admin'], body: BulkAddBody, response: { 200: BulkAddResponse } },
    config: adminRateLimit,
    preHandler: [requireAdmin, verifyCsrf],
    handler: async (req) => {
      const { emails, note } = req.body as z.infer<typeof BulkAddBody>;
      const pool = getPool();

      const seen = new Set<string>();
      const cleaned: string[] = [];
      const rejected: Array<{ email: string; reason: string }> = [];
      for (const e of emails) {
        const trimmed = e.trim();
        if (!EMAIL_REGEX.test(trimmed)) {
          rejected.push({ email: e, reason: 'not a valid email' });
          continue;
        }
        const lower = trimmed.toLowerCase();
        if (seen.has(lower)) {
          rejected.push({ email: e, reason: 'duplicate in input' });
          continue;
        }
        seen.add(lower);
        cleaned.push(lower);
      }

      if (cleaned.length === 0) {
        return { added: 0, alreadyPresent: 0, rejected };
      }

      const { rows: existingRows } = await pool.query<{ email: string }>(
        'SELECT email FROM access_allowlist WHERE email = ANY($1::citext[])',
        [cleaned],
      );
      const alreadyPresent = new Set(existingRows.map((r) => r.email.toLowerCase()));
      const toInsert = cleaned.filter((e) => !alreadyPresent.has(e));

      if (toInsert.length > 0) {
        await pool.query(
          `INSERT INTO access_allowlist (email, added_by, note)
           SELECT unnest($1::citext[]), $2, $3
           ON CONFLICT (email) DO NOTHING`,
          [toInsert, req.session!.user.id, note ?? null],
        );
      }

      await writeAudit({
        actorUserId: req.session!.user.id,
        action: 'allowlist.added',
        target: `bulk:${toInsert.length}`,
        metadata: { added: toInsert.length, already_present: alreadyPresent.size, rejected: rejected.length },
      });

      return { added: toInsert.length, alreadyPresent: alreadyPresent.size, rejected };
    },
  });

  r.route({
    method: 'POST',
    url: '/api/admin/allowlist/bulk-remove',
    schema: { tags: ['admin'], body: BulkRemoveBody, response: { 200: BulkRemoveResponse } },
    config: adminRateLimit,
    preHandler: [requireAdmin, verifyCsrf],
    handler: async (req) => {
      const { emails } = req.body as z.infer<typeof BulkRemoveBody>;
      const pool = getPool();
      const lower = Array.from(new Set(emails.map((e) => e.toLowerCase())));
      const { rowCount } = await pool.query(
        'DELETE FROM access_allowlist WHERE email = ANY($1::citext[])',
        [lower],
      );
      await writeAudit({
        actorUserId: req.session!.user.id,
        action: 'allowlist.removed',
        target: `bulk:${rowCount ?? 0}`,
      });
      return { removed: rowCount ?? 0, notPresent: lower.length - (rowCount ?? 0) };
    },
  });

  r.route({
    method: 'DELETE',
    url: '/api/admin/allowlist/:email',
    schema: {
      tags: ['admin'],
      params: z.object({ email: Email }),
      response: { 204: z.null() },
    },
    config: adminRateLimit,
    preHandler: [requireAdmin, verifyCsrf],
    handler: async (req, reply) => {
      const { email } = req.params as { email: string };
      const pool = getPool();
      const { rowCount } = await pool.query(
        'DELETE FROM access_allowlist WHERE email = $1',
        [email.toLowerCase()],
      );
      if (rowCount === 0) throw Errors.notFound('Email not in allowlist');
      await writeAudit({
        actorUserId: req.session!.user.id,
        action: 'allowlist.removed',
        target: email.toLowerCase(),
      });
      reply.code(204).send();
    },
  });

  // ─── Audit ─────────────────────────────────────────────────────────────

  r.route({
    method: 'GET',
    url: '/api/admin/audit',
    schema: {
      tags: ['admin'],
      querystring: AuditQuery,
      response: { 200: AuditResponse },
    },
    preHandler: [requireAdmin],
    config: adminRateLimit,
    handler: async (req) => {
      const { action, limit } = req.query as z.infer<typeof AuditQuery>;
      const pool = getPool();
      const { rows } = await pool.query<{
        id: string;
        at: Date;
        actor_user_id: string | null;
        action: string;
        target: string | null;
      }>(
        action
          ? `SELECT id::text, at, actor_user_id, action, target
             FROM audit_log
             WHERE action = $1
             ORDER BY id DESC LIMIT $2`
          : `SELECT id::text, at, actor_user_id, action, target
             FROM audit_log
             ORDER BY id DESC LIMIT $1`,
        action ? [action, limit] : [limit],
      );
      return {
        entries: rows.map((row) => ({
          id: row.id,
          at: row.at.toISOString(),
          actorUserId: row.actor_user_id,
          action: row.action,
          target: row.target,
        })),
      };
    },
  });
}
