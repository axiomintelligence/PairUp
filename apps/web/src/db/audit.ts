import type { PoolClient } from 'pg';
import { getPool } from './pool.js';

export type AuditAction =
  | 'profile.update'
  | 'profile.publish'
  | 'profile.unpublish'
  | 'profile.delete'
  | 'session.created'
  | 'session.deleted'
  | 'request.created'
  | 'request.accepted'
  | 'request.declined'
  | 'request.withdrawn'
  | 'connection.created'
  | 'dismissal.created'
  | 'dismissal.removed'
  | 'allowlist.added'
  | 'allowlist.removed'
  | 'admin_config.updated'
  | 'user.deleted';

export interface AuditWriteInput {
  actorUserId: string | null;
  action: AuditAction;
  target?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Append an audit_log row. HLD §13: every state-changing API call writes one
 * of these. Pass an existing client to enrol in the route's transaction;
 * otherwise the write happens on its own short-lived connection.
 */
export async function writeAudit(
  input: AuditWriteInput,
  client?: PoolClient,
): Promise<void> {
  const sql = `
    INSERT INTO audit_log (actor_user_id, action, target, metadata)
    VALUES ($1, $2, $3, $4)
  `;
  const params = [
    input.actorUserId,
    input.action,
    input.target ?? null,
    input.metadata ? JSON.stringify(input.metadata) : null,
  ];
  if (client) {
    await client.query(sql, params);
  } else {
    await getPool().query(sql, params);
  }
}
