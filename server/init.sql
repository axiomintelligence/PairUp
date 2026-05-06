-- PairUp schema. Run on first boot via server/db.js initSchema().

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

CREATE INDEX IF NOT EXISTS idx_user_state_updated_at ON user_state (updated_at DESC);
