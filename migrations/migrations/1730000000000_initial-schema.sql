-- Up Migration

-- Required extensions:
--  citext     — case-insensitive text for email + allowlist
--  pgcrypto   — gen_random_uuid() (built into PG 13+ but extension required for older)
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── Identity ───────────────────────────────────────────────────────────────

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entra_oid     text   UNIQUE NOT NULL,
  email         citext UNIQUE NOT NULL,
  display_name  text   NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  is_admin      boolean NOT NULL DEFAULT false
);

-- Sessions are server-side opaque tokens (HLD §5.1). Authority is this table:
-- delete the row to revoke; cookie is just the lookup key.
CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issued_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  user_agent    text,
  ip            inet
);
CREATE INDEX sessions_user_id_idx   ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

-- ─── Profile ───────────────────────────────────────────────────────────────

CREATE TABLE profiles (
  user_id                uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status                 text   NOT NULL CHECK (status IN ('draft', 'published')),
  grade                  text   NOT NULL,
  directorates           text[] NOT NULL DEFAULT '{}',
  location               text   NOT NULL,
  overseas_post          text,
  fte                    text,
  days_negotiable        text   CHECK (days_negotiable IS NULL OR days_negotiable IN ('yes','possibly','no')),
  availability           text,
  skills                 text,
  working_pattern_notes  text,
  other_info             text,
  style                  text,
  -- days: { Mon: 'full'|'part'|'non'|'flexible', Tue: ..., Wed: ..., Thu: ..., Fri: ... }
  days                   jsonb  NOT NULL,
  -- visibility: { grade: 'must'|'open', directorates, location, days }
  visibility             jsonb  NOT NULL,
  published_at           timestamptz,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- Stage-1 SQL pre-filter indexes (HLD §7.2):
--  • (status, grade)              — common path for grade-gated searches
--  • GIN (directorates)           — array overlap (`&&`) lookups
--  • GIN (days)                   — jsonb containment for day-gate
--  • partial on status='published'— restricts the matching pool index size
CREATE INDEX profiles_status_grade_idx     ON profiles (status, grade);
CREATE INDEX profiles_directorates_gin_idx ON profiles USING GIN (directorates);
CREATE INDEX profiles_days_gin_idx         ON profiles USING GIN (days jsonb_path_ops);
CREATE INDEX profiles_published_user_idx   ON profiles (user_id) WHERE status = 'published';

-- Search prefs — added in design review; missing from HLD §6 but referenced
-- by API §7 (`GET|PUT /api/search-prefs`).
CREATE TABLE search_prefs (
  user_id       uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  grade         text NOT NULL DEFAULT 'definite'  CHECK (grade        IN ('definite','preferred','irrelevant')),
  directorates  text NOT NULL DEFAULT 'definite'  CHECK (directorates IN ('definite','preferred','irrelevant')),
  location      text NOT NULL DEFAULT 'preferred' CHECK (location     IN ('definite','preferred','irrelevant')),
  days          text NOT NULL DEFAULT 'preferred' CHECK (days         IN ('definite','preferred','irrelevant')),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ─── Connections ───────────────────────────────────────────────────────────

CREATE TABLE connection_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        text NOT NULL CHECK (status IN ('pending','accepted','declined','withdrawn')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  CHECK (from_user_id <> to_user_id),
  UNIQUE (from_user_id, to_user_id)
);
CREATE INDEX connection_requests_to_status_idx   ON connection_requests (to_user_id,   status);
CREATE INDEX connection_requests_from_status_idx ON connection_requests (from_user_id, status);

CREATE TABLE connections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (user_a_id < user_b_id),
  UNIQUE (user_a_id, user_b_id)
);
CREATE INDEX connections_user_a_idx ON connections (user_a_id);
CREATE INDEX connections_user_b_idx ON connections (user_b_id);

CREATE TABLE dismissals (
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dismissed_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, dismissed_user_id)
);

-- ─── Platform ──────────────────────────────────────────────────────────────

CREATE TABLE access_allowlist (
  email       citext PRIMARY KEY,
  added_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  added_at    timestamptz NOT NULL DEFAULT now(),
  note        text
);

-- Singleton config row (HLD §6: `CHECK (id = 1)`). Insert defaults below.
CREATE TABLE admin_config (
  id                    int PRIMARY KEY CHECK (id = 1),
  grade_penalty         text NOT NULL DEFAULT 'heavy' CHECK (grade_penalty IN ('hard','heavy','light','none')),
  outbound_pending_cap  int  NOT NULL DEFAULT 50      CHECK (outbound_pending_cap > 0),
  updated_by            uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at            timestamptz NOT NULL DEFAULT now()
);
INSERT INTO admin_config (id) VALUES (1);

CREATE TABLE audit_log (
  id              bigserial PRIMARY KEY,
  at              timestamptz NOT NULL DEFAULT now(),
  -- actor_user_id may be NULL (system actions) or set to NULL when the user is
  -- erased — HLD §10 requires "actor=[deleted]" semantics. We keep the FK but
  -- ON DELETE SET NULL so audit rows survive user deletions.
  actor_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  action          text NOT NULL,
  target          text,
  metadata        jsonb
);
CREATE INDEX audit_log_at_desc_idx ON audit_log (at DESC);
CREATE INDEX audit_log_action_idx  ON audit_log (action);


-- Down Migration

DROP INDEX IF EXISTS audit_log_action_idx;
DROP INDEX IF EXISTS audit_log_at_desc_idx;
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS admin_config;
DROP TABLE IF EXISTS access_allowlist;
DROP TABLE IF EXISTS dismissals;
DROP INDEX IF EXISTS connections_user_b_idx;
DROP INDEX IF EXISTS connections_user_a_idx;
DROP TABLE IF EXISTS connections;
DROP INDEX IF EXISTS connection_requests_from_status_idx;
DROP INDEX IF EXISTS connection_requests_to_status_idx;
DROP TABLE IF EXISTS connection_requests;
DROP TABLE IF EXISTS search_prefs;
DROP INDEX IF EXISTS profiles_published_user_idx;
DROP INDEX IF EXISTS profiles_days_gin_idx;
DROP INDEX IF EXISTS profiles_directorates_gin_idx;
DROP INDEX IF EXISTS profiles_status_grade_idx;
DROP TABLE IF EXISTS profiles;
DROP INDEX IF EXISTS sessions_expires_at_idx;
DROP INDEX IF EXISTS sessions_user_id_idx;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
