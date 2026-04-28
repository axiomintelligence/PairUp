// Auth types shared across the OIDC client, session machinery, and authz
// middleware. Keep these aligned with the `users` and `sessions` columns in
// migrations/migrations/1730000000000_initial-schema.sql.

export interface IdTokenClaims {
  iss: string;
  aud: string | string[];
  sub: string;
  oid?: string;
  tid?: string;
  email?: string;
  preferred_username?: string;
  name?: string;
  exp: number;
  iat?: number;
  nbf?: number;
  nonce?: string;
  roles?: string[];
}

export interface SessionUser {
  id: string;            // users.id (uuid)
  entraOid: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
}

export interface SessionRow {
  id: string;
  user_id: string;
  issued_at: Date;
  last_seen_at: Date;
  expires_at: Date;
}

export interface AuthenticatedSession {
  session: SessionRow;
  user: SessionUser;
}

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Populated by the access-gate preHandler. Always defined on routes that
     * passed the gate; absent on auth/ops routes that opt out.
     */
    session?: AuthenticatedSession;
  }
}
