import type { FastifyRequest } from 'fastify';
import { Errors } from '../errors.js';

// HLD §5.2 layer 3: /api/admin/* routes require session.user.is_admin.
// Used as a Fastify preHandler on the admin route group (PR 10 / AXI-119).
export async function requireAdmin(req: FastifyRequest): Promise<void> {
  const auth = req.session;
  if (!auth) throw Errors.notAuthenticated();
  if (!auth.user.isAdmin) throw Errors.forbidden('Admin role required');
}
