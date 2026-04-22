# PairUp Productionisation — Design

**Date:** 2026-04-22
**Branch:** `feat/productionise-azure`
**Status:** Design — awaiting user review before implementation plan
**Expected lifespan:** ~6 months from go-live to decommission

## Goal

Take the current static-only PairUp prototype (a single-user demo backed by 120 synthetic FCDO profiles in `data.js`) and make it a real, stable, multi-user application that real FCDO staff can use to find job-share partners. The app must:

- Hold real users' profiles in a real database.
- Authenticate real users via FCDO Entra ID (Azure AD).
- Remove all synthetic data and match people as they enter information in the DB.
- Be stable at up to ~20,000 registered users with expected DAU ≤ 20%.
- Be easy for the build team to modify quickly.
- Deploy generically across both our dev tenant and the customer's tenant.

## Decisions (locked)

| Area | Decision |
|---|---|
| Hosting | Azure Container Apps |
| Auth | Entra ID SSO (Authorization Code + PKCE, server-side session cookie) |
| Database | Azure Database for PostgreSQL Flexible Server, private endpoint only |
| Backend stack | Node.js + TypeScript + Fastify |
| Frontend | Keep vanilla JS; modularise with esbuild build step |
| Packaging | Single container (Fastify serves `/` static + `/api/*`) |
| IaC | Terraform |
| CI/CD | Azure DevOps multi-stage YAML pipeline, parameterised for multiple tenants |
| Matching | Server-side (SQL pre-filter → in-process scoring) |
| Access model | Tenant check for regular users; Entra app role `Admin` for admins; DB-backed allowlist behind a feature flag during beta |
| Profile visibility | Opt-in: `draft` → `published` |
| GDPR | Delete-my-data and export-my-data endpoints; DPIA signed by DPO before Phase 2 |
| Notifications | **Deferred** — not in v1 (see Deferred Scope) |

## Architecture

### Runtime components

All in one Azure resource group per environment.

- **Container App `pairup-web`** — Fastify serving built frontend at `/` and `/api/*`. Internal ingress, HTTPS. Deployed into the existing Container Apps Environment (customer-provided in prod; our own in dev).
- **Postgres Flexible Server `pairup-db-{env}`** — private endpoint only, PITR 7 days, PgBouncer enabled, managed-identity auth from the API.
- **Azure Container Registry** — customer-provided in prod (dedicated `acr/pairup` repo); our own in dev. Image pull via managed identity.
- **Log Analytics Workspace** — customer-provided in prod; our own in dev. Receives ACA + DB logs.
- **Entra ID app registration `PairUp-{env}`** — one redirect URI per env; declares one app role `Admin`.

### Request flow

```
Browser → ACA ingress → Fastify
  Static assets        → serve from /public
  /api/auth/login      → 302 to Entra /authorize (PKCE)
  /api/auth/callback   → verify id_token, upsert user, set session cookie, 302 /
  /api/*               → session cookie required, DB query, JSON response
```

### Repo layout

```
/apps/web              Fastify entrypoint (TS). Serves /api and static /public.
/apps/web/public       Built frontend bundle (esbuild output, gitignored).
/packages/frontend/src Frontend modules (state, api, render/*, auth, admin/*).
/packages/matching     Shared scoring logic (consumed by API).
/infra/terraform       Terraform root + pairup-app module; envs/<env>.tfvars.
/migrations            SQL migrations (node-pg-migrate).
/docs                  DPIA, runbooks, decommission plan, this spec.
/.azure-pipelines      Pipeline YAML.
```

### Environments

| Env | Tenant | Purpose |
|---|---|---|
| `dev` | Our Azure | Build team iterates; integration + load testing; seeded fake users. |
| `prod` | Customer Azure | Real users. |

Same Terraform; two tfvars files pointing at each env's existing ACR, LAW, CAE resource IDs via data sources.

### Access model

| Who | Mechanism |
|---|---|
| Regular users | Must have a valid session from an id_token whose `tid` claim matches the configured FCDO tenant ID. No AD group required. |
| Beta cohort (Phase 2-3) | `ACCESS_ALLOWLIST_ENABLED=true` — user's email must also be in `access_allowlist` table. Flag flipped to `false` at Phase 4 cutover. |
| Admins | Entra **app role** `Admin` assigned in the Enterprise Application blade. Token carries `roles: ["Admin"]`; server sets `is_admin=true` on login. |

The current `ADMIN_PASS = 'pairup-admin'` hardcoded password and `sessionStorage.pairup_admin` flag are deleted.

### Scaling and capacity

Scale trigger: **HTTP concurrency** (ACA native scaler), target 50 concurrent requests per replica.

Per-replica size: `0.5 vCPU / 1 GiB RAM` to start; upgrade to `1 vCPU / 2 GiB` only if load tests show CPU-bound behaviour.

| Env | Min replicas | Max replicas |
|---|---|---|
| dev | 1 | 3 |
| prod (beta) | 2 | 5 |
| prod (open) | 2 | 10 |

Postgres: D2s_v3 (General Purpose) in prod, B2s (Burstable) in dev. API pool size 10 per replica (cap = 100 connections at max scale).

**PgBouncer enabled** on Flexible Server (transaction pooling mode, port 6432). PgBouncer is the connection pooler built into Azure Postgres Flexible Server: the API sees its pool of 100 connections, but PgBouncer multiplexes them across a much smaller set (~25) of real Postgres backends. This protects the server from connection exhaustion during scale-out bursts or rolling deploys (where old and new replica sets briefly coexist), at zero behavioural cost for this app — our queries are plain parameterised CRUD and don't depend on session-scoped features (`LISTEN/NOTIFY`, session-level prepared statements) that transaction pooling disables.

Capacity reasoning for 20k users is in `docs/capacity-reasoning.md` (to be produced in implementation); the short form: steady-state peak ≈50 RPS, open-day burst ≈200 RPS, both comfortably within 10 replicas × 50 concurrent = 500 capacity. The only component that changes character at 20k is notifications, which are deferred.

## Data model

### Tables (Postgres)

All timestamps `timestamptz`. All primary keys `uuid` (`gen_random_uuid()`) unless noted.

```sql
users (
  id             uuid PK,
  entra_oid      text UNIQUE NOT NULL,
  email          citext UNIQUE NOT NULL,
  display_name   text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  is_admin       boolean NOT NULL DEFAULT false
)

profiles (
  user_id                uuid PK REFERENCES users(id) ON DELETE CASCADE,
  status                 text NOT NULL,   -- 'draft' | 'published'
  grade                  text NOT NULL,
  directorates           text[] NOT NULL,
  location               text NOT NULL,
  overseas_post          text,
  fte                    text,
  days_negotiable        text,
  availability           text,
  skills                 text,
  working_pattern_notes  text,
  other_info             text,
  style                  text,
  days                   jsonb NOT NULL,        -- { Mon: 'full'|'part'|'non'|'flexible', ... }
  visibility             jsonb NOT NULL,        -- { grade, directorates, location, days }
  published_at           timestamptz,
  updated_at             timestamptz NOT NULL DEFAULT now()
)
-- Indexes: (status, grade); GIN (directorates); GIN (days); partial index on status='published'.

sessions (
  id            uuid PK,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issued_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  user_agent    text,
  ip            inet
)

connection_requests (
  id            uuid PK,
  from_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        text NOT NULL,   -- 'pending' | 'accepted' | 'declined' | 'withdrawn'
  created_at    timestamptz NOT NULL,
  resolved_at   timestamptz,
  UNIQUE (from_user_id, to_user_id)
)

connections (
  id          uuid PK,
  user_a_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL,
  CHECK (user_a_id < user_b_id),
  UNIQUE (user_a_id, user_b_id)
)

dismissals (
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dismissed_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at         timestamptz NOT NULL,
  PRIMARY KEY (user_id, dismissed_user_id)
)

access_allowlist (
  email     citext PRIMARY KEY,
  added_by  uuid REFERENCES users(id),
  added_at  timestamptz NOT NULL DEFAULT now(),
  note      text
)

admin_config (
  id                   int PRIMARY KEY CHECK (id = 1),
  grade_penalty        text NOT NULL DEFAULT 'heavy',   -- 'hard'|'heavy'|'light'|'none'
  outbound_pending_cap int  NOT NULL DEFAULT 50,        -- max open outbound pending per user
  updated_by           uuid REFERENCES users(id),
  updated_at           timestamptz NOT NULL DEFAULT now()
)

audit_log (
  id              bigserial PRIMARY KEY,
  at              timestamptz NOT NULL DEFAULT now(),
  actor_user_id   uuid REFERENCES users(id),
  action          text NOT NULL,   -- e.g. 'profile.publish', 'user.deleted'
  target          text,
  metadata        jsonb
)
```

### Business constraints (enforced in the API, not the DB)

- A user has at most one profile (guaranteed by PK on `profiles.user_id`).
- A user may have at most `admin_config.outbound_pending_cap` (default 50) open outbound pending `connection_requests`. Prevents "message everyone" abuse. Violations return `409 conflict`.
- `POST /api/requests` is idempotent on `(from_user_id, to_user_id)`.
- Only `status='published'` profiles enter the matching pool.

### Migrations

`node-pg-migrate`, versioned, applied by the API container at startup under a Postgres advisory lock to prevent multi-replica races.

## Auth and authorization

### Sign-in flow

Entra ID OIDC Authorization Code + PKCE; scopes `openid profile email`.

1. `GET /api/auth/login` → 302 to Entra `/authorize` with PKCE challenge + state.
2. `GET /api/auth/callback?code=&state=` → verify state + PKCE, exchange `code` for `id_token` using the Container App's managed identity as the client assertion (Entra **federated credential** — no client secret anywhere), validate signature/issuer/audience/**tenant**, upsert `users` by `entra_oid` (updating `email`, `display_name`, `last_seen_at`, `is_admin`), insert a row in `sessions`, issue HttpOnly cookie (Secure, SameSite=Lax, 8h idle / 24h absolute) carrying the opaque session ID, 302 `/`.
3. `POST /api/auth/logout` → clear cookie, delete session row, 302 Entra end-session endpoint.

Server-side sessions (not JWTs in localStorage): immune to XSS token exfiltration, trivially revocable, fits same-origin browser-only shape. Cookie value is a random 256-bit opaque session ID — no HMAC, no signing key, no secret to store. Authority is the `sessions` table row.

### Authorization layers

1. **Access gate** — every `/api/*` except `/api/auth/*` and `/api/health|/api/ready` requires a valid session. If `ACCESS_ALLOWLIST_ENABLED=true`, user email must be in `access_allowlist` or response is `403 not_in_beta`.
2. **Ownership** — routes that act on "me" (`/api/profile/me`, `/api/me`, etc.) take no user ID from the URL; the server derives it from the session. Eliminates IDOR.
3. **Admin** — `/api/admin/*` routes are wrapped by a Fastify `preHandler` plugin that checks `session.user.is_admin`.

### CSRF

Cookie `SameSite=Lax` blocks most cross-site POST CSRF. State-changing endpoints additionally require a `X-CSRF-Token` header carrying a double-submit token the frontend reads from a non-HttpOnly `csrf` cookie set at login.

### Admin capabilities (minimal)

- View counts: users, published profiles, pending requests, accepted connections, signups/day.
- Edit `admin_config` (scoring tunables).
- Manage `access_allowlist`.
- View recent `audit_log` entries (last 500, filterable).

Explicitly **not included**: impersonation, editing other users' profiles, viewing any user's raw profile JSON. Reduces GDPR blast radius.

### Maintaining the `access_allowlist` in beta

The allowlist is the gate during Phases 2–3. It needs to be comfortable to maintain for a cohort that starts at ~50 and grows to ~500, then disappears entirely when `ACCESS_ALLOWLIST_ENABLED` is flipped off.

Admin-UI operations, all backed by the `/api/admin/allowlist` endpoints and all writing to `audit_log`:

- **Single add / remove** — type an email, press add. Fine for tactical additions (someone emails the service owner asking for access).
- **Bulk add** — paste a block of emails (one per line or comma-separated) into a textarea; server splits, lowercases, validates shape, deduplicates against existing rows, and reports back: `{ added: N, already_present: M, rejected: [email, reason] }`. This is how the cohort grows from 50 → 500 in one sitting rather than 450 clicks.
- **Bulk remove** — same shape, inverse.
- **CSV export** — download the current list with `added_by` and `added_at` for audit and handover. Also usable as "what did we promise cohort 1?" evidence before widening.
- **Filter / search** in the admin table view so finding one entry among 500 is one keystroke.

**Deliberately excluded:**

- Domain-wildcard entries (`*@fcdo.gov.uk`). Would collapse the beta gate — we already have tenant-wide access the moment the flag flips off, so a wildcard adds no value and only risks accidentally opening early.
- Entra group-driven allowlist. AD groups were rejected earlier for the same reason: messy to maintain, and a DB-backed list is simpler, faster to edit, and fully under the admin UI's control.

**Lifecycle:** at Phase 4 cutover we set `ACCESS_ALLOWLIST_ENABLED=false` via Terraform and redeploy. The table stays in place (intact audit trail) but is no longer read. We keep it untouched for the remaining ~6-month lifespan; it's destroyed with the rest of the DB at decommission.

## API surface (v1)

Implicitly `v1` at the `/api/` prefix. If a breaking change ever needs to happen, `/api/v2/*` ships alongside.

```
# Auth
GET    /api/auth/login
GET    /api/auth/callback
POST   /api/auth/logout
GET    /api/auth/me

# Profile
GET    /api/profile/me
PUT    /api/profile/me
POST   /api/profile/me/publish
POST   /api/profile/me/unpublish
DELETE /api/me
GET    /api/me/export

# Matching
GET    /api/matches?cursor=
POST   /api/matches/:id/dismiss
DELETE /api/matches/:id/dismiss
GET    /api/search-prefs
PUT    /api/search-prefs

# Requests / connections
POST   /api/requests
POST   /api/requests/:id/accept
POST   /api/requests/:id/decline
POST   /api/requests/:id/withdraw
GET    /api/requests
GET    /api/connections

# Admin
GET    /api/admin/stats
GET    /api/admin/weights
PUT    /api/admin/weights
GET    /api/admin/allowlist           # paginated list, supports ?q= filter
GET    /api/admin/allowlist.csv       # CSV export with added_by, added_at
POST   /api/admin/allowlist           # add single { email, note? }
POST   /api/admin/allowlist/bulk-add  # { emails: string[] } → { added, already_present, rejected }
POST   /api/admin/allowlist/bulk-remove # { emails: string[] } → { removed, not_present }
DELETE /api/admin/allowlist/:email
GET    /api/admin/audit

# Ops
GET    /api/health
GET    /api/ready
```

### Conventions

- Request / response bodies: JSON, validated by `zod`. Same schemas generate OpenAPI served at `/api/docs` (admin-only).
- Errors: `{ error: { code, message } }` with stable codes (`not_authenticated`, `not_in_beta`, `profile_incomplete`, `not_found`, `conflict`, `rate_limited`). `profile_incomplete` fires on `POST /api/profile/me/publish` when required fields fail validation; `conflict` fires when the outbound-pending-request cap is hit.
- Every mutation writes an `audit_log` row.

### Rate limits (`@fastify/rate-limit`, keyed on session user)

| Route | Limit |
|---|---|
| `POST /api/requests` | 30 / hour |
| `PUT /api/profile/me` | 120 / hour |
| Admin routes | 120 / minute |
| Global fallback | 600 / minute |

Plus the per-user hard cap of **50 open outbound pending requests**.

### Matching

Two stages:

1. **SQL pre-filter** on `profiles`: `status='published'`, not self, not dismissed, visibility gates (current user's search prefs + candidate's `visibility` settings) satisfied. Indexed; returns typically 100–300 rows even at 20k users.
2. **In-process scoring** in Node, same logic as current client-side `scoreMatch` / `rankScore` / day complementarity, lifted into `packages/matching`. Paginated cursor-style (keyset on `(score, user_id)`), 20 per page.

Response strips fields the viewer shouldn't see (`email`, other users' visibility settings).

## Frontend changes

### New source layout (`packages/frontend/src`)

```
state.ts          Client cache; server is the source of truth.
api.ts            Typed fetch wrapper, one function per endpoint.
render/profile.ts
render/matches.ts
render/connections.ts
render/modals.ts
auth.ts           Login redirect + session check.
admin/             Admin UI, lazy-loaded when isAdmin.
main.ts           Bootstrap.
```

Build: `esbuild`, output to `apps/web/public/`. Source maps in dev, minified in prod.

### Removed from current `app.js`

- `DUMMY_PROFILES`, `data.js` file, all references.
- `maybeBootstrapInbound`, `maybeBootstrapHiddenSuggested`, `schedulePendingAccept`, `rehydrateTimers`.
- `ADMIN_PASS` constant and the password unlock modal.
- Client-side scoring (`scoreMatch`, `rankScore`, `getMatches`) — moved to server.
- `localStorage` usage reduced to UI-only state (last active tab, banner-dismiss flags).

### New UI affordances

- **Sign-in screen** — one button, redirects to `/api/auth/login`.
- **Draft / Published status chip** on the profile tab; explicit "Publish — make me discoverable" action.
- **Delete my data** — two-step confirm, types `DELETE` to confirm.
- **Export my data** — downloads JSON (profile + connections); also a CSV of connections.
- **Empty states** — honest language for a mostly-empty launch pool: "We don't have many profiles yet. Publish yours, and invite colleagues."

## GDPR and privacy

- Privacy notice linked in header. Lawful basis: legitimate interest (internal HR tool for the controller, FCDO) + explicit consent at publish (user actively chooses "Publish"). Retention: bounded by the app's 6-month lifespan.
- **Right of access**: `GET /api/me/export` returns all of the user's data.
- **Right to erasure**: `DELETE /api/me` hard-deletes `users`, `profiles`, `sessions`, `dismissals`, `connection_requests` (cascade), removes the user from `connections` (cascade). Audit row is written with `actor='[deleted]'` so no PII persists in `audit_log`.
- **Data minimisation**: only `oid`, `email`, `display_name`, `last_seen_at` beyond what the user volunteers in their profile. No profile photo. No org-tree metadata.
- **DPIA**: one-page DPIA in `/docs`, signed by FCDO DPO before Phase 2 (private beta).
- **Decommissioning**: at T+6 months, prominent in-app export prompt at T-30 through T-0, then app is taken down and the final Postgres snapshot destroyed per FCDO retention policy.

## Ops

### Logging

Structured JSON logs to stdout (Fastify's pino) → ACA → Log Analytics. Each request log carries `request_id`, `user_id`, route, status, duration. PII fields (`email`, profile free-text) are redacted at log time; only the DB is the source of truth for those.

### Metrics

ACA built-ins (RPS, p95, replica count) plus four custom Log Analytics counters:

- `matches_returned`
- `requests_sent`
- `connections_made`
- `profiles_published`

One dashboard in Log Analytics.

### Alerts (Action Group → email distribution list)

| Alert | Threshold |
|---|---|
| p95 latency | > 1s for 5 min |
| 5xx rate | > 1% for 5 min |
| Postgres CPU | > 80% for 10 min |
| Replicas at max | 10 min |
| Auth failure spike | > 10× baseline (Entra outage or attack) |

### Backup and DR

- Postgres PITR: 7 days.
- No cross-region DR — proportional to 6-month lifespan. If the region fails, restore to fresh server in the same region from latest backup: RTO ≈ 1h, RPO ≈ 1h. Documented and accepted.

### Secrets

**No secrets in the system.** Every credential is either (a) the Container App's managed identity (Azure-managed; no value ever leaves Azure) or (b) a random opaque token in the app's own database (session IDs, CSRF tokens).

- **Entra token exchange** uses a federated credential on the app registration that trusts the Container App's MI issuer. No client secret, no certificate.
- **Postgres** uses Azure AD authentication via the same MI.
- **ACR** image pull uses MI.
- **Session cookie** is a server-side opaque token, DB-backed, no signing key.
- **CSRF** double-submit token is random, no signing key.

Terraform state holds no secret values (only resource IDs and MI assignments). Azure DevOps variable groups hold no secrets. If a third-party outbound credential is introduced later (e.g. if notifications are built), that is the point at which Key Vault is added — a ~1-hour Terraform addition.

### Deploy and rollback

- ACA revisions with traffic splitting. Every deploy creates a new revision at 0%; pipeline promotes 0% → 100% after smoke tests pass. One-click rollback by shifting traffic to previous revision.
- Min 2 replicas in prod ensures rolling deploys never cut off all traffic.
- `/api/health` (liveness) vs `/api/ready` (readiness including DB pool warm + Entra metadata fetched) gate traffic to each replica.

## Testing strategy

- **Unit**: matching/scoring in `packages/matching`, validation schemas, authz helpers. Target ~80% line coverage on matching + authz, pragmatic elsewhere.
- **Integration**: Fastify + Postgres via `testcontainers`; covers auth, ownership, connection-request state transitions, delete-my-data cascade.
- **E2E**: Playwright, two golden-path flows — "publish profile then see matches" and "send request → other user accepts → both see connection." Entra replaced with a local mock OIDC server (`mock-oidc`).
- **Load**: k6 scenarios in the dev env against a 20k seeded pool:
  - Steady-state: 100 RPS for 30 min. Expect p95 < 300ms, zero 5xx.
  - Open-day burst: ramp 0 → 400 RPS over 2 min, hold 10 min. Expect replicas 6–8, p95 < 800ms during ramp, no errors.
  - Pathological matching pool: all 20k users same grade + directorate, 50 RPS on `/api/matches`. Expect p95 < 600ms.

Pass criteria for the load scenarios are the go/no-go gate for **Phase 4** (open to all).

## Rollout plan

| Phase | Duration | Gate to next |
|---|---|---|
| 0. Build in dev | 2–3 weeks | Feature-complete against spec; unit + integration tests pass; k6 steady-state passes. |
| 1. Internal test (dev tenant) | 1 week | Team uses as real users, P0/P1 cleared. Security review completed. |
| 2. Private beta (customer tenant, allowlist, ~50 users) | 2 weeks | No P0/P1 open. DPO signs DPIA. |
| 3. Widen beta (~500 users) | 1–2 weeks | Load tests pass; no p95 / 5xx regression. |
| 4. Open to all | — | Flip `ACCESS_ALLOWLIST_ENABLED=false`. |
| 5. Decommission | T+6 months from Phase 4 | Runbook: T-30 announce, T-14 export prompt prominent, T-0 app down, snapshot destroyed. |

## Security review before Phase 2

Checklist-driven, OWASP ASVS L1 plus items most likely to bite this app:

- Session cookie flags (HttpOnly, Secure, SameSite=Lax).
- CSRF double-submit token on state-changing routes.
- Strict CSP header (default-src 'self').
- Authorization check on every non-public route.
- Rate limits wired and tested.
- Managed-identity scopes minimised.
- Postgres private-endpoint-only, no public path.
- No secrets in logs; PII redaction verified.
- id_token validation: signature, issuer, audience, tenant, expiry, nonce.
- Anti-abuse: outbound pending request cap enforced and tested.

Findings are gating for Phase 2.

## Deferred scope

### Notifications (email)

Not in v1. If users request it, or engagement data shows people miss activity, add as a follow-up sub-project. Rough shape:

- Azure Communication Services (transactional) or SendGrid.
- SPF / DKIM / DMARC setup with FCDO IT.
- ~5–20k emails/day peak at 20k users; well inside ACS free tier for 6 months.
- Email kinds: "someone sent you a connection request", "your request was accepted". Nothing marketing.
- Build effort ≈ 1 week including domain-auth paperwork.

### React / framework rewrite of frontend

Not in v1. Current vanilla-JS-with-modules fits the lifespan. Reconsider only if we extend the app beyond 6 months.

### Notification push / in-app banners for real-time events

Not in v1. Users see updates on next page load. Polling or SSE is a follow-up.

### Multi-profile per user

Out of scope. One profile per user, enforced by PK.

## Decommissioning runbook (outline)

Lives in `/docs/decommission.md`, finalised during Phase 3. Key milestones:

- **T-30 days**: in-app banner announcing shutdown date.
- **T-14 days**: export-my-data link prominently surfaced; email from service owner (manual, not via ACS).
- **T-0**: ingress removed; Container App stopped; final Postgres snapshot taken.
- **T+30 days**: snapshot destroyed per FCDO retention policy; Terraform `destroy` for the prod stack (keeping non-sensitive Terraform state archive).

## Open items / explicit non-decisions

None outstanding. All design choices above are locked pending user review of this document.
