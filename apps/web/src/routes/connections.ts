import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getPool } from '../db/pool.js';
import { writeAudit } from '../db/audit.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { Errors } from '../errors.js';

// ───────────────────────────────────────────────────────────────────────────
// Connection request lifecycle (HLD §6 + §7).
//
// State machine:
//   pending  → accepted   (creates a connections row)
//   pending  → declined
//   pending  → withdrawn  (only the sender can withdraw)
//
// Idempotency on POST /api/requests is enforced by the UNIQUE
// (from_user_id, to_user_id) constraint from PR 4. Repeating the call with
// the same (from, to) returns the existing row.
//
// Outbound-pending cap (HLD §6.1): a user can hold at most
// admin_config.outbound_pending_cap (default 50) open outbound `pending`
// requests; over that → 409 conflict.
//
// connections.user_a_id < user_b_id (CHECK from PR 4) — we sort the pair
// before insert to keep the constraint happy.
// ───────────────────────────────────────────────────────────────────────────

const RequestStatus = z.enum(['pending', 'accepted', 'declined', 'withdrawn']);
type RequestStatus = z.infer<typeof RequestStatus>;

const RequestSchema = z.object({
  id: z.string().uuid(),
  fromUserId: z.string().uuid(),
  toUserId: z.string().uuid(),
  status: RequestStatus,
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
});

const CreateRequestBody = z.object({
  toUserId: z.string().uuid(),
});

const RequestParams = z.object({
  id: z.string().uuid(),
});

const RequestsResponse = z.object({
  inbound: z.array(RequestSchema),
  outbound: z.array(RequestSchema),
});

const ConnectionSchema = z.object({
  id: z.string().uuid(),
  otherUserId: z.string().uuid(),
  otherDisplayName: z.string(),
  createdAt: z.string().datetime(),
});

const ConnectionsResponse = z.object({
  connections: z.array(ConnectionSchema),
});

interface RequestRow {
  id: string;
  from_user_id: string;
  to_user_id: string;
  status: RequestStatus;
  created_at: Date;
  resolved_at: Date | null;
}

function rowToRequest(row: RequestRow): z.infer<typeof RequestSchema> {
  return {
    id: row.id,
    fromUserId: row.from_user_id,
    toUserId: row.to_user_id,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    resolvedAt: row.resolved_at?.toISOString() ?? null,
  };
}

async function getOutboundPendingCap(): Promise<number> {
  const pool = getPool();
  const { rows } = await pool.query<{ cap: number }>(
    'SELECT outbound_pending_cap AS cap FROM admin_config WHERE id = 1',
  );
  return rows[0]?.cap ?? 50;
}

async function fetchRequest(id: string): Promise<RequestRow | null> {
  const pool = getPool();
  const { rows } = await pool.query<RequestRow>(
    `SELECT id, from_user_id, to_user_id, status, created_at, resolved_at
     FROM connection_requests WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function registerConnectionsRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'POST',
    url: '/api/requests',
    preHandler: [verifyCsrf],
    schema: {
      tags: ['connections'],
      summary:
        'Send a connection request (idempotent on (from,to)). 409 if outbound pending ' +
        'cap reached; 30/hour rate-limit per HLD §7.1.',
      body: CreateRequestBody,
      response: { 200: RequestSchema, 201: RequestSchema },
      security: [{ sessionCookie: [] }],
    },
    config: {
      rateLimit: { max: 30, timeWindow: '1 hour' },
    },
    handler: async (req, reply) => {
      const fromUserId = req.session!.user.id;
      const { toUserId } = req.body as z.infer<typeof CreateRequestBody>;
      if (toUserId === fromUserId) throw Errors.conflict('Cannot send a request to yourself');

      const pool = getPool();

      // Verify the recipient exists and has a published profile.
      const { rows: targetRows } = await pool.query<{ user_id: string }>(
        `SELECT p.user_id
         FROM profiles p
         WHERE p.user_id = $1 AND p.status = 'published'`,
        [toUserId],
      );
      if (targetRows.length === 0) throw Errors.notFound('Recipient is not in the matching pool');

      const cap = await getOutboundPendingCap();
      const { rows: pendingCountRows } = await pool.query<{ count: string }>(
        `SELECT count(*)::int AS count
         FROM connection_requests
         WHERE from_user_id = $1 AND status = 'pending'`,
        [fromUserId],
      );
      const open = Number(pendingCountRows[0]?.count ?? 0);

      // Check existing — idempotent on the unique (from_user_id, to_user_id).
      const { rows: existingRows } = await pool.query<RequestRow>(
        `SELECT id, from_user_id, to_user_id, status, created_at, resolved_at
         FROM connection_requests
         WHERE from_user_id = $1 AND to_user_id = $2`,
        [fromUserId, toUserId],
      );
      if (existingRows[0]) {
        // If existing is pending or accepted, no-op. If declined/withdrawn, allow re-create
        // by recycling the row to pending.
        const existing = existingRows[0];
        if (existing.status === 'pending' || existing.status === 'accepted') {
          reply.code(200);
          return rowToRequest(existing);
        }
        if (open >= cap) {
          throw Errors.conflict(
            `Outbound pending request cap (${cap}) reached — withdraw or wait for replies`,
          );
        }
        const { rows: updated } = await pool.query<RequestRow>(
          `UPDATE connection_requests
           SET status = 'pending', resolved_at = NULL, created_at = now()
           WHERE id = $1
           RETURNING id, from_user_id, to_user_id, status, created_at, resolved_at`,
          [existing.id],
        );
        await writeAudit({
          actorUserId: fromUserId,
          action: 'request.created',
          target: existing.id,
        });
        reply.code(201);
        return rowToRequest(updated[0]!);
      }

      if (open >= cap) {
        throw Errors.conflict(
          `Outbound pending request cap (${cap}) reached — withdraw or wait for replies`,
        );
      }

      const { rows: created } = await pool.query<RequestRow>(
        `INSERT INTO connection_requests (from_user_id, to_user_id, status)
         VALUES ($1, $2, 'pending')
         RETURNING id, from_user_id, to_user_id, status, created_at, resolved_at`,
        [fromUserId, toUserId],
      );
      await writeAudit({
        actorUserId: fromUserId,
        action: 'request.created',
        target: created[0]!.id,
      });
      reply.code(201);
      return rowToRequest(created[0]!);
    },
  });

  r.route({
    method: 'POST',
    url: '/api/requests/:id/accept',
    preHandler: [verifyCsrf],
    schema: {
      tags: ['connections'],
      summary: 'Recipient accepts a pending request — creates a connections row.',
      params: RequestParams,
      response: { 200: RequestSchema },
      security: [{ sessionCookie: [] }],
    },
    handler: async (req) => {
      const userId = req.session!.user.id;
      const { id } = req.params as z.infer<typeof RequestParams>;
      const existing = await fetchRequest(id);
      if (!existing || existing.to_user_id !== userId) throw Errors.notFound();
      if (existing.status !== 'pending')
        throw Errors.conflict(`Request is ${existing.status}; can only accept pending`);

      const pool = getPool();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query<RequestRow>(
          `UPDATE connection_requests
           SET status = 'accepted', resolved_at = now()
           WHERE id = $1 AND status = 'pending'
           RETURNING id, from_user_id, to_user_id, status, created_at, resolved_at`,
          [id],
        );
        if (!rows[0]) throw Errors.conflict('Race — request no longer pending');
        const [a, b] =
          rows[0].from_user_id < rows[0].to_user_id
            ? [rows[0].from_user_id, rows[0].to_user_id]
            : [rows[0].to_user_id, rows[0].from_user_id];
        await client.query(
          `INSERT INTO connections (user_a_id, user_b_id)
           VALUES ($1, $2)
           ON CONFLICT (user_a_id, user_b_id) DO NOTHING`,
          [a, b],
        );
        await writeAudit(
          { actorUserId: userId, action: 'request.accepted', target: id },
          client,
        );
        await writeAudit(
          { actorUserId: userId, action: 'connection.created', target: `${a}:${b}` },
          client,
        );
        await client.query('COMMIT');
        return rowToRequest(rows[0]);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  });

  r.route({
    method: 'POST',
    url: '/api/requests/:id/decline',
    preHandler: [verifyCsrf],
    schema: {
      tags: ['connections'],
      summary: 'Recipient declines a pending request.',
      params: RequestParams,
      response: { 200: RequestSchema },
      security: [{ sessionCookie: [] }],
    },
    handler: async (req) => {
      const userId = req.session!.user.id;
      const { id } = req.params as z.infer<typeof RequestParams>;
      const existing = await fetchRequest(id);
      if (!existing || existing.to_user_id !== userId) throw Errors.notFound();
      if (existing.status !== 'pending')
        throw Errors.conflict(`Request is ${existing.status}; can only decline pending`);

      const pool = getPool();
      const { rows } = await pool.query<RequestRow>(
        `UPDATE connection_requests
         SET status = 'declined', resolved_at = now()
         WHERE id = $1 AND status = 'pending'
         RETURNING id, from_user_id, to_user_id, status, created_at, resolved_at`,
        [id],
      );
      if (!rows[0]) throw Errors.conflict('Race — request no longer pending');
      await writeAudit({ actorUserId: userId, action: 'request.declined', target: id });
      return rowToRequest(rows[0]);
    },
  });

  r.route({
    method: 'POST',
    url: '/api/requests/:id/withdraw',
    preHandler: [verifyCsrf],
    schema: {
      tags: ['connections'],
      summary: 'Sender withdraws a pending request.',
      params: RequestParams,
      response: { 200: RequestSchema },
      security: [{ sessionCookie: [] }],
    },
    handler: async (req) => {
      const userId = req.session!.user.id;
      const { id } = req.params as z.infer<typeof RequestParams>;
      const existing = await fetchRequest(id);
      if (!existing || existing.from_user_id !== userId) throw Errors.notFound();
      if (existing.status !== 'pending')
        throw Errors.conflict(`Request is ${existing.status}; can only withdraw pending`);

      const pool = getPool();
      const { rows } = await pool.query<RequestRow>(
        `UPDATE connection_requests
         SET status = 'withdrawn', resolved_at = now()
         WHERE id = $1 AND status = 'pending'
         RETURNING id, from_user_id, to_user_id, status, created_at, resolved_at`,
        [id],
      );
      if (!rows[0]) throw Errors.conflict('Race — request no longer pending');
      await writeAudit({ actorUserId: userId, action: 'request.withdrawn', target: id });
      return rowToRequest(rows[0]);
    },
  });

  r.route({
    method: 'GET',
    url: '/api/requests',
    schema: {
      tags: ['connections'],
      summary: 'List inbound + outbound requests for the session user.',
      response: { 200: RequestsResponse },
      security: [{ sessionCookie: [] }],
    },
    handler: async (req) => {
      const userId = req.session!.user.id;
      const pool = getPool();
      const { rows: inbound } = await pool.query<RequestRow>(
        `SELECT id, from_user_id, to_user_id, status, created_at, resolved_at
         FROM connection_requests
         WHERE to_user_id = $1
         ORDER BY created_at DESC`,
        [userId],
      );
      const { rows: outbound } = await pool.query<RequestRow>(
        `SELECT id, from_user_id, to_user_id, status, created_at, resolved_at
         FROM connection_requests
         WHERE from_user_id = $1
         ORDER BY created_at DESC`,
        [userId],
      );
      return {
        inbound: inbound.map(rowToRequest),
        outbound: outbound.map(rowToRequest),
      };
    },
  });

  r.route({
    method: 'GET',
    url: '/api/connections',
    schema: {
      tags: ['connections'],
      summary: 'List the session user’s accepted connections.',
      response: { 200: ConnectionsResponse },
      security: [{ sessionCookie: [] }],
    },
    handler: async (req) => {
      const userId = req.session!.user.id;
      const pool = getPool();
      const { rows } = await pool.query<{
        id: string;
        other_id: string;
        other_name: string;
        created_at: Date;
      }>(
        `SELECT c.id,
                CASE WHEN c.user_a_id = $1 THEN c.user_b_id ELSE c.user_a_id END AS other_id,
                u.display_name AS other_name,
                c.created_at
         FROM connections c
         JOIN users u
           ON u.id = CASE WHEN c.user_a_id = $1 THEN c.user_b_id ELSE c.user_a_id END
         WHERE c.user_a_id = $1 OR c.user_b_id = $1
         ORDER BY c.created_at DESC`,
        [userId],
      );
      return {
        connections: rows.map((row) => ({
          id: row.id,
          otherUserId: row.other_id,
          otherDisplayName: row.other_name,
          createdAt: row.created_at.toISOString(),
        })),
      };
    },
  });
}
