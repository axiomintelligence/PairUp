-- Up Migration

-- HLD §5.1: cookie value is a "random 256-bit opaque session identifier".
-- The session row's `id` is a uuid (122 bits of randomness), so we add a
-- separate token column carrying the full 256-bit value used as the cookie.
ALTER TABLE sessions
  ADD COLUMN token text NOT NULL;

CREATE UNIQUE INDEX sessions_token_idx ON sessions (token);


-- Down Migration

DROP INDEX IF EXISTS sessions_token_idx;
ALTER TABLE sessions DROP COLUMN IF EXISTS token;
