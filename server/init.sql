-- PairUp schema. Run on every server boot via server/db.js initSchema().
-- All statements are idempotent.

-- Identity: rows here are real authenticated users (Entra ID OID +
-- email + display name). Replaces the cookie-UUID identity model.
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entra_oid     TEXT UNIQUE NOT NULL,
  email         TEXT NOT NULL,
  display_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (lower(email));

-- Auth tokens stored server-side (not in cookies — Microsoft tokens are
-- large enough to blow the HTTP header limit otherwise).
CREATE TABLE IF NOT EXISTS user_tokens (
  user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  access_token   TEXT,
  refresh_token  TEXT,
  id_token       TEXT,
  expires_at     TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- connect-pg-simple session store. Schema follows that library's defaults.
CREATE TABLE IF NOT EXISTS "session" (
  sid     TEXT PRIMARY KEY,
  sess    JSONB NOT NULL,
  expire  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_expire ON "session" (expire);

CREATE TABLE IF NOT EXISTS user_state (
  user_id      TEXT PRIMARY KEY,
  state        JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_settings (
  key          TEXT PRIMARY KEY,
  value        JSONB NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Disabled flag on user_state — admins can suspend a user without deleting.
ALTER TABLE user_state ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE user_state ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ;
ALTER TABLE user_state ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Append-only event log for tracking. user_id may be null for anonymous events
-- (e.g. someone hits the page without ever creating a row in user_state).
CREATE TABLE IF NOT EXISTS events (
  id           BIGSERIAL PRIMARY KEY,
  event_type   TEXT NOT NULL,
  user_id      TEXT,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_type_created ON events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_user_created ON events (user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_state_updated_at ON user_state (updated_at DESC);
