// Microsoft Entra ID (Azure AD) authentication for PairUp.
// Mirrors DUNE's pattern: tokens persisted in DB (user_tokens), session
// payload kept tiny (just userId + email + name + isAdmin).
//
// Local dev bypass: when AUTH_DEV_MODE=true the /auth/login route serves a
// no-op form that lets you sign in as any email — useful when no Entra app
// registration is wired up yet.

const crypto = require('node:crypto');
const express = require('express');
const { Issuer, generators } = require('openid-client');
const { pool } = require('./db');

const ALLOWED_ADMIN_EMAILS = (process.env.ALLOWED_ADMIN_EMAILS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const AUTH_DEV_MODE = process.env.AUTH_DEV_MODE === 'true';

function isAdminEmail(email) {
  if (!email) return false;
  if (ALLOWED_ADMIN_EMAILS.length === 0) return false;
  return ALLOWED_ADMIN_EMAILS.includes(String(email).toLowerCase());
}

async function upsertUser({ entraOid, email, displayName }) {
  const r = await pool.query(
    `INSERT INTO users (entra_oid, email, display_name, last_seen)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (entra_oid) DO UPDATE
       SET email = EXCLUDED.email,
           display_name = EXCLUDED.display_name,
           last_seen = NOW()
     RETURNING id, entra_oid, email, display_name`,
    [entraOid, email, displayName || null]
  );
  return r.rows[0];
}

async function saveTokens(userId, tokens) {
  await pool.query(
    `INSERT INTO user_tokens (user_id, access_token, refresh_token, id_token, expires_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET access_token = EXCLUDED.access_token,
           refresh_token = COALESCE(EXCLUDED.refresh_token, user_tokens.refresh_token),
           id_token = EXCLUDED.id_token,
           expires_at = EXCLUDED.expires_at,
           updated_at = NOW()`,
    [
      userId,
      tokens.access_token || null,
      tokens.refresh_token || null,
      tokens.id_token || null,
      tokens.expires_at ? new Date(tokens.expires_at * 1000) : null,
    ]
  );
}

let _client; // cached openid-client.Client
async function getClient() {
  if (_client) return _client;
  const issuerUrl = process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER;
  const clientId = process.env.AUTH_MICROSOFT_ENTRA_ID_ID;
  const clientSecret = process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET;
  const redirectUri = process.env.AUTH_REDIRECT_URI;
  if (!issuerUrl || !clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'Missing AUTH_MICROSOFT_ENTRA_ID_ISSUER / _ID / _SECRET or AUTH_REDIRECT_URI env vars'
    );
  }
  const issuer = await Issuer.discover(issuerUrl);
  _client = new issuer.Client({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uris: [redirectUri],
    response_types: ['code'],
  });
  return _client;
}

function buildRouter() {
  const router = express.Router();

  // ── Identity check (always available) ─────────────────────────────────
  router.get('/me', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'unauthenticated' });
    res.json({
      id: req.session.user.id,
      email: req.session.user.email,
      displayName: req.session.user.displayName || null,
      isAdmin: !!req.session.user.isAdmin,
      authMode: AUTH_DEV_MODE ? 'dev' : 'entra',
    });
  });

  // ── Logout ────────────────────────────────────────────────────────────
  router.post('/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });
  router.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
  });

  // ── Dev-mode login form ───────────────────────────────────────────────
  if (AUTH_DEV_MODE) {
    router.get('/login', (_req, res) => {
      res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>PairUp — dev login</title>
  <style>
    body{font-family:system-ui,sans-serif;background:#f1f5f9;color:#0f172a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}
    .box{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px;max-width:380px;width:100%;box-shadow:0 4px 12px rgba(15,23,42,.08)}
    h1{font-size:18px;margin:0 0 6px}
    p{font-size:13px;color:#475569;margin:0 0 18px}
    label{display:block;font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#475569;margin:10px 0 5px;font-family:ui-monospace,monospace}
    input{width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;box-sizing:border-box}
    button{width:100%;margin-top:18px;padding:11px;background:#1e40af;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer}
    button:hover{background:#1d4ed8}
    .tag{font-family:ui-monospace,monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#94a3b8;background:#fef3c7;color:#b45309;border:1px solid #fcd34d;border-radius:4px;padding:2px 8px;display:inline-block;margin-bottom:14px}
  </style>
</head>
<body>
  <form class="box" method="post" action="/auth/dev-login">
    <div class="tag">DEV MODE</div>
    <h1>Sign in to PairUp</h1>
    <p>EntraID is bypassed locally. Enter any details and we'll create the user.</p>
    <label for="email">Email</label>
    <input type="email" id="email" name="email" required value="dev@example.com">
    <label for="name">Display name</label>
    <input type="text" id="name" name="name" value="Dev User">
    <button type="submit">Continue</button>
  </form>
</body>
</html>`);
    });

    router.post('/dev-login', express.urlencoded({ extended: false }), async (req, res) => {
      const email = String(req.body.email || '').trim().toLowerCase();
      const name = String(req.body.name || '').trim() || null;
      if (!email) return res.status(400).send('email required');
      // Stable synthetic OID per email so re-logging in finds the same user row.
      const entraOid = 'dev:' + crypto.createHash('sha256').update(email).digest('hex').slice(0, 24);
      const u = await upsertUser({ entraOid, email, displayName: name });
      req.session.user = {
        id: u.id,
        email: u.email,
        displayName: u.display_name,
        isAdmin: isAdminEmail(u.email),
      };
      const next = req.query.next && String(req.query.next).startsWith('/') ? req.query.next : '/';
      res.redirect(next);
    });
    return router;
  }

  // ── Real Entra OIDC flow ──────────────────────────────────────────────
  router.get('/login', async (req, res, next) => {
    try {
      const client = await getClient();
      const state = generators.state();
      const nonce = generators.nonce();
      const codeVerifier = generators.codeVerifier();
      const codeChallenge = generators.codeChallenge(codeVerifier);
      req.session.oidc = { state, nonce, codeVerifier };
      if (req.query.next && String(req.query.next).startsWith('/')) {
        req.session.oidc.next = String(req.query.next);
      }
      const url = client.authorizationUrl({
        scope: 'openid profile email offline_access User.Read',
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
      });
      res.redirect(url);
    } catch (e) { next(e); }
  });

  router.get('/callback', async (req, res, next) => {
    try {
      const client = await getClient();
      const oidc = req.session.oidc;
      if (!oidc) return res.status(400).send('No OIDC state in session — start over at /auth/login.');
      const params = client.callbackParams(req);
      const tokenSet = await client.callback(
        process.env.AUTH_REDIRECT_URI,
        params,
        { state: oidc.state, nonce: oidc.nonce, code_verifier: oidc.codeVerifier }
      );
      const claims = tokenSet.claims();
      const entraOid = claims.oid || claims.sub;
      const email = claims.preferred_username || claims.email || claims.upn;
      const displayName = claims.name || null;
      if (!entraOid || !email) return res.status(400).send('Identity claims missing oid/email.');
      const u = await upsertUser({ entraOid, email, displayName });
      await saveTokens(u.id, tokenSet);
      const next = oidc.next || '/';
      delete req.session.oidc;
      req.session.user = {
        id: u.id,
        email: u.email,
        displayName: u.display_name,
        isAdmin: isAdminEmail(u.email),
      };
      res.redirect(next);
    } catch (e) { next(e); }
  });

  return router;
}

function requireUser(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'unauthenticated' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'unauthenticated' });
  }
  if (!req.session.user.isAdmin) {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
}

module.exports = {
  buildRouter,
  requireUser,
  requireAdmin,
  isAdminEmail,
  AUTH_DEV_MODE,
};
