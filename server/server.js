const path = require('node:path');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const cookieParser = require('cookie-parser');
const { pool, initSchema } = require('./db');
const { buildRouter: buildAuthRouter, requireUser, requireAdmin, AUTH_DEV_MODE } = require('./auth');

const PORT = Number(process.env.PORT || 8080);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-session-secret-please-override';
const SESSION_COOKIE_NAME = 'pairup_sid';
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

if (process.env.NODE_ENV === 'production' && SESSION_SECRET === 'dev-only-session-secret-please-override') {
  console.warn('[warn] SESSION_SECRET is unset in production — sessions will be guessable');
}

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

app.use(
  session({
    store: new PgSession({
      pool,
      tableName: 'session',
      createTableIfMissing: false, // schema handles it
    }),
    name: SESSION_COOKIE_NAME,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_TTL_MS,
      path: '/',
    },
  })
);

// ── Auth ───────────────────────────────────────────────────────────────────
app.use('/auth', buildAuthRouter());

// ── Healthz (unauthenticated, used by Container Apps probes) ───────────────
app.get('/healthz', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.type('text/plain').send('ok\n');
  } catch (e) {
    res.status(503).type('text/plain').send('db unavailable\n');
  }
});

// ── User state (per signed-in user) ────────────────────────────────────────

app.get('/api/state', requireUser, async (req, res, next) => {
  try {
    const uid = req.session.user.id;
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

async function writeState(req, res, next) {
  try {
    const uid = req.session.user.id;
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
app.put('/api/state', requireUser, writeState);
app.post('/api/state', requireUser, writeState);

app.delete('/api/state', requireUser, async (req, res, next) => {
  try {
    const uid = req.session.user.id;
    await pool.query('DELETE FROM user_state WHERE user_id = $1', [uid]);
    await pool.query(
      "INSERT INTO events (event_type, user_id, payload) VALUES ('profile_deleted', $1, '{\"by\":\"self\"}'::jsonb)",
      [uid]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ── Events (tracking) ──────────────────────────────────────────────────────
const ALLOWED_EVENT_TYPES = new Set([
  'profile_created',
  'profile_updated',
  'profile_deleted',
  'matches_suggested',
  'connection_request',
  'connection_accept',
  'connection_dismiss',
  'email_click',
]);

app.post('/api/events', requireUser, async (req, res, next) => {
  try {
    const uid = req.session.user.id;
    const { type, payload } = req.body || {};
    if (!type || typeof type !== 'string' || !ALLOWED_EVENT_TYPES.has(type)) {
      return res.status(400).json({ error: 'invalid_type' });
    }
    const safePayload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    await pool.query(
      'INSERT INTO events (event_type, user_id, payload) VALUES ($1, $2, $3::jsonb)',
      [type, uid, JSON.stringify(safePayload)]
    );
    res.status(204).end();
  } catch (e) { next(e); }
});

// ── Admin (gated by ALLOWED_ADMIN_EMAILS) ──────────────────────────────────

app.get('/api/admin/stats', requireAdmin, async (_req, res, next) => {
  try {
    const userQ = pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE state ? 'profile' AND state->'profile' IS NOT NULL AND state->'profile' <> 'null'::jsonb)::int AS with_profile,
        COUNT(*) FILTER (WHERE NOT disabled)::int AS active_users,
        COUNT(*) FILTER (WHERE disabled)::int AS disabled_users,
        COUNT(*) FILTER (WHERE updated_at >= NOW() - INTERVAL '7 days')::int  AS used_7d,
        COUNT(*) FILTER (WHERE updated_at >= NOW() - INTERVAL '30 days')::int AS used_30d
      FROM user_state
    `);
    const evQ = pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE event_type = 'profile_created')::int    AS profile_created_all,
        COUNT(*) FILTER (WHERE event_type = 'profile_created' AND created_at >= NOW() - INTERVAL '7 days')::int  AS profile_created_7d,
        COUNT(*) FILTER (WHERE event_type = 'profile_deleted')::int    AS profile_deleted_all,
        COUNT(*) FILTER (WHERE event_type = 'profile_deleted' AND created_at >= NOW() - INTERVAL '7 days')::int  AS profile_deleted_7d,
        COUNT(*) FILTER (WHERE event_type = 'matches_suggested')::int  AS matches_suggested_all,
        COUNT(*) FILTER (WHERE event_type = 'matches_suggested' AND created_at >= NOW() - INTERVAL '7 days')::int AS matches_suggested_7d,
        COUNT(*) FILTER (WHERE event_type = 'email_click')::int        AS email_clicks_all,
        COUNT(*) FILTER (WHERE event_type = 'email_click' AND created_at >= NOW() - INTERVAL '7 days')::int      AS email_clicks_7d,
        COUNT(*) FILTER (WHERE event_type = 'connection_request')::int AS connection_requests_all,
        COUNT(*) FILTER (WHERE event_type = 'connection_request' AND created_at >= NOW() - INTERVAL '7 days')::int AS connection_requests_7d
      FROM events
    `);
    const [u, e] = await Promise.all([userQ, evQ]);
    res.json({ ...u.rows[0], ...e.rows[0] });
  } catch (e) { next(e); }
});

app.get('/api/admin/users', requireAdmin, async (_req, res, next) => {
  try {
    const r = await pool.query(`
      SELECT
        us.user_id,
        us.state->'profile'->>'name'        AS name,
        us.state->'profile'->>'grade'       AS grade,
        us.state->'profile'->>'location'    AS location,
        us.state->'profile'->'directorates' AS directorates,
        (us.state->'profile'->>'lastActive')::bigint AS last_active,
        jsonb_array_length(COALESCE(us.state->'connections', '[]'::jsonb)) AS connections,
        jsonb_array_length(COALESCE(us.state->'sentRequests', '[]'::jsonb)) AS sent,
        jsonb_array_length(COALESCE(us.state->'receivedRequests', '[]'::jsonb)) AS received,
        us.disabled,
        us.disabled_at,
        us.created_at,
        us.updated_at,
        u.email,
        u.display_name AS auth_display_name
      FROM user_state us
      LEFT JOIN users u ON u.id::text = us.user_id
      ORDER BY us.updated_at DESC
      LIMIT 200
    `);
    res.json(r.rows);
  } catch (e) { next(e); }
});

app.patch('/api/admin/users/:id', requireAdmin, async (req, res, next) => {
  try {
    const { disabled } = req.body || {};
    if (typeof disabled !== 'boolean') {
      return res.status(400).json({ error: 'disabled must be boolean' });
    }
    const r = await pool.query(
      `UPDATE user_state
         SET disabled = $2,
             disabled_at = CASE WHEN $2 THEN NOW() ELSE NULL END
       WHERE user_id = $1
       RETURNING user_id, disabled, disabled_at`,
      [req.params.id, disabled]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'not_found' });
    res.json(r.rows[0]);
  } catch (e) { next(e); }
});

app.get('/api/admin/users/:id', requireAdmin, async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT us.user_id, us.state, us.disabled, us.disabled_at, us.created_at, us.updated_at,
              u.email, u.display_name AS auth_display_name
         FROM user_state us
         LEFT JOIN users u ON u.id::text = us.user_id
        WHERE us.user_id = $1`,
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'not_found' });
    res.json(r.rows[0]);
  } catch (e) { next(e); }
});

app.delete('/api/admin/users/:id', requireAdmin, async (req, res, next) => {
  try {
    const r = await pool.query(
      'DELETE FROM user_state WHERE user_id = $1 RETURNING user_id',
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true, deletedId: r.rows[0].user_id });
  } catch (e) { next(e); }
});

app.get('/api/admin/weights', requireUser, async (_req, res, next) => {
  try {
    const r = await pool.query("SELECT value FROM app_settings WHERE key = 'weights'");
    res.json(r.rows[0]?.value || { gradePenalty: 'heavy' });
  } catch (e) { next(e); }
});

app.put('/api/admin/weights', requireAdmin, async (req, res, next) => {
  try {
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

// ── Static + SPA fallback ──────────────────────────────────────────────────
// SPA root requires login; static assets remain public so the login page
// itself can render.

function htmlLoginGuard(req, res, next) {
  if (req.session.user) return next();
  // For an HTML page request, redirect to login. For everything else (assets,
  // health, etc.) fall through.
  if (req.accepts('html')) return res.redirect('/auth/login?next=' + encodeURIComponent(req.originalUrl));
  next();
}

app.use(
  express.static(PUBLIC_DIR, {
    etag: true,
    lastModified: true,
    index: false, // we handle '/' ourselves so the auth redirect runs
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-store');
      } else if (/\.(js|css)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      } else if (/\.(svg|ico|png|webp|woff2?)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
      }
    },
  })
);

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) return next();
  if (!req.session.user && req.accepts('html')) {
    return res.redirect('/auth/login?next=' + encodeURIComponent(req.originalUrl));
  }
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
    console.log(`[pairup] listening on :${PORT} (auth: ${AUTH_DEV_MODE ? 'dev-mode' : 'entra'})`);
  });
})();
