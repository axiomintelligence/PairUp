const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const { pool, initSchema } = require('./db');

const PORT = Number(process.env.PORT || 8080);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const COOKIE_NAME = 'pairup_uid';
const COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const ADMIN_PASSPHRASE = process.env.ADMIN_PASSPHRASE || '';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ensureUserId(req, res) {
  let uid = req.cookies[COOKIE_NAME];
  if (!uid || !UUID_RE.test(uid)) {
    uid = crypto.randomUUID();
    res.cookie(COOKIE_NAME, uid, {
      httpOnly: true,
      secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE_MS,
      path: '/',
    });
  }
  return uid;
}

// ── API ────────────────────────────────────────────────────────────────────

app.get('/api/state', async (req, res, next) => {
  try {
    const uid = ensureUserId(req, res);
    const r = await pool.query('SELECT state FROM user_state WHERE user_id = $1', [uid]);
    if (r.rows.length === 0) {
      await pool.query(
        'INSERT INTO user_state (user_id, state) VALUES ($1, $2::jsonb) ON CONFLICT DO NOTHING',
        [uid, '{}']
      );
      return res.json({ userId: uid, state: {} });
    }
    res.json({ userId: uid, state: r.rows[0].state || {} });
  } catch (e) { next(e); }
});

// POST is an alias for PUT to support navigator.sendBeacon on pagehide.
async function writeState(req, res, next) {
  try {
    const uid = ensureUserId(req, res);
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'state must be an object' });
    }
    await pool.query(
      `INSERT INTO user_state (user_id, state, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (user_id) DO UPDATE
         SET state = EXCLUDED.state, updated_at = NOW()`,
      [uid, JSON.stringify(req.body)]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
}
app.put('/api/state', writeState);
app.post('/api/state', writeState);

app.delete('/api/state', async (req, res, next) => {
  try {
    const uid = ensureUserId(req, res);
    await pool.query('DELETE FROM user_state WHERE user_id = $1', [uid]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

function verifyAdminPassphrase(req) {
  if (!ADMIN_PASSPHRASE) return false;
  const supplied = req.headers['x-admin-passphrase'] || '';
  if (typeof supplied !== 'string' || supplied.length !== ADMIN_PASSPHRASE.length) return false;
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(ADMIN_PASSPHRASE));
}

app.post('/api/admin/check', (req, res) => {
  if (!ADMIN_PASSPHRASE) return res.status(503).json({ error: 'admin disabled' });
  if (!verifyAdminPassphrase(req)) return res.status(403).json({ error: 'forbidden' });
  res.json({ ok: true });
});

app.get('/api/admin/weights', async (req, res, next) => {
  try {
    const r = await pool.query("SELECT value FROM app_settings WHERE key = 'weights'");
    res.json(r.rows[0]?.value || { gradePenalty: 'heavy' });
  } catch (e) { next(e); }
});

function requireAdmin(req, res) {
  if (!ADMIN_PASSPHRASE) {
    res.status(503).json({ error: 'admin disabled' });
    return false;
  }
  if (!verifyAdminPassphrase(req)) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

app.get('/api/admin/stats', async (req, res, next) => {
  if (!requireAdmin(req, res)) return;
  try {
    const r = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE state ? 'profile' AND state->'profile' IS NOT NULL AND state->'profile' <> 'null'::jsonb)::int AS with_profile,
        COUNT(*) FILTER (WHERE updated_at >= NOW() - INTERVAL '7 days')::int AS active_7d,
        COUNT(*) FILTER (WHERE updated_at >= NOW() - INTERVAL '30 days')::int AS active_30d
      FROM user_state
    `);
    res.json(r.rows[0]);
  } catch (e) { next(e); }
});

app.get('/api/admin/users', async (req, res, next) => {
  if (!requireAdmin(req, res)) return;
  try {
    const r = await pool.query(`
      SELECT
        user_id,
        state->'profile'->>'name'        AS name,
        state->'profile'->>'grade'       AS grade,
        state->'profile'->>'location'    AS location,
        state->'profile'->'directorates' AS directorates,
        (state->'profile'->>'lastActive')::bigint AS last_active,
        jsonb_array_length(COALESCE(state->'connections', '[]'::jsonb)) AS connections,
        jsonb_array_length(COALESCE(state->'sentRequests', '[]'::jsonb)) AS sent,
        jsonb_array_length(COALESCE(state->'receivedRequests', '[]'::jsonb)) AS received,
        updated_at
      FROM user_state
      ORDER BY updated_at DESC
      LIMIT 200
    `);
    res.json(r.rows);
  } catch (e) { next(e); }
});

app.get('/api/admin/users/:id', async (req, res, next) => {
  if (!requireAdmin(req, res)) return;
  try {
    const r = await pool.query(
      'SELECT user_id, state, updated_at FROM user_state WHERE user_id = $1',
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'not_found' });
    res.json(r.rows[0]);
  } catch (e) { next(e); }
});

app.delete('/api/admin/users/:id', async (req, res, next) => {
  if (!requireAdmin(req, res)) return;
  try {
    const r = await pool.query(
      'DELETE FROM user_state WHERE user_id = $1 RETURNING user_id',
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true, deletedId: r.rows[0].user_id });
  } catch (e) { next(e); }
});

app.put('/api/admin/weights', async (req, res, next) => {
  try {
    if (!ADMIN_PASSPHRASE) return res.status(503).json({ error: 'admin disabled (no passphrase configured)' });
    if (!verifyAdminPassphrase(req)) return res.status(403).json({ error: 'forbidden' });
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'invalid body' });
    }
    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('weights', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(req.body)]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.get('/healthz', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.type('text/plain').send('ok\n');
  } catch (e) {
    res.status(503).type('text/plain').send('db unavailable\n');
  }
});

// ── Static + SPA fallback ──────────────────────────────────────────────────

app.use(
  express.static(PUBLIC_DIR, {
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-store');
      } else if (/\.(js|css)$/.test(filePath)) {
        // App code/styles aren't content-hashed yet — let browsers revalidate.
        res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      } else if (/\.(svg|ico|png|webp|woff2?)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
      }
    },
  })
);

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error('[err]', err);
  res.status(500).json({ error: 'internal_error' });
});

// ── Boot ───────────────────────────────────────────────────────────────────

(async () => {
  let attempts = 0;
  while (true) {
    try {
      await initSchema();
      break;
    } catch (e) {
      attempts++;
      console.error(`[boot] schema init failed (attempt ${attempts}):`, e.message);
      if (attempts >= 30) {
        console.error('[boot] giving up on schema init');
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  app.listen(PORT, () => {
    console.log(`[pairup] listening on :${PORT}`);
  });
})();
