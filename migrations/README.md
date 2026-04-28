# `migrations/`

Versioned SQL migrations applied via [`node-pg-migrate`](https://salsita.github.io/node-pg-migrate/) per HLD §6 + §17.

## Schema (10 tables)

The first migration `1730000000000_initial-schema.sql` ships the full HLD §6 surface plus the `search_prefs` table from the design review:

| Table | Purpose |
|---|---|
| `users` | Identity (Entra `oid`, email, display_name, is_admin) |
| `sessions` | Server-side opaque session tokens (HLD §5.1) |
| `profiles` | Profile data + visibility settings; matching pool |
| `search_prefs` | Searcher's per-dimension prefs (definite / preferred / irrelevant) — added in design review |
| `connection_requests` | Request lifecycle (pending → accepted/declined/withdrawn) |
| `connections` | Accepted pairs (`UNIQUE (user_a, user_b)`, `CHECK user_a < user_b`) |
| `dismissals` | Hidden suggestions per user |
| `access_allowlist` | Beta-cohort gate when `ACCESS_ALLOWLIST_ENABLED=true` |
| `admin_config` | Singleton (`CHECK id=1`) — grade_penalty, outbound_pending_cap |
| `audit_log` | One row per state-changing API call (HLD §13) |

Indexes per HLD §7.2 stage-1 pre-filter: `profiles (status, grade)`, GIN on `directorates`, GIN on `days`, partial index on `status='published'`. Plus `connection_requests` indexes by `(to_user_id, status)` and `(from_user_id, status)`, `audit_log (at DESC)`, and so on.

Cascading deletes on `users` make the right-to-erasure path (HLD §10) a single `DELETE FROM users` for the session user.

## Running migrations

The HLD-as-written behaviour (per §6 / §17) is to run migrations on API startup, serialised across replicas via a Postgres advisory lock — see [`apps/web/src/db/migrate.ts`](../apps/web/src/db/migrate.ts).

[`AXI-109`](https://linear.app/axiomintelligence/issue/AXI-109) captures the open question of whether to keep this pattern or move migrations to a one-shot Container Apps Job. The standalone CLI is already in place for that path:

```bash
# Local dev — apply pending migrations
DATABASE_URL=postgres://pairup:pairup@localhost:5432/pairup \
  npm --workspace @pairup/web run migrate

# Roll back the most recent migration
DATABASE_URL=... npm --workspace @pairup/web run migrate:down
```

Set `RUN_MIGRATIONS_ON_STARTUP=false` on the API container to disable the startup runner if AXI-109 lands as option B.

## Adding a new migration

```bash
# Pick a UNIX-millisecond timestamp prefix and write a new file:
touch migrations/migrations/$(node -e 'console.log(Date.now())')_my-change.sql
```

Each file holds two sections:

```sql
-- Up Migration
ALTER TABLE foo ADD COLUMN bar text;

-- Down Migration
ALTER TABLE foo DROP COLUMN bar;
```

Keep migrations additive when possible (HLD §6 constraint — schema rolls forward; ad-hoc rollback is fix-forward, not `down`).
