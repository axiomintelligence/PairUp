# `migrations/`

Versioned SQL migrations applied via `node-pg-migrate` per HLD §6 + §17. Empty placeholder today; the nine-table schema lands in PR 4 (AXI-113):

- `users`, `profiles`, `sessions`, `connection_requests`, `connections`, `dismissals`, `access_allowlist`, `admin_config`, `audit_log` plus the `search_prefs` table flagged in design review.
- Indexes: `(status, grade)`, GIN on `directorates`, GIN on `days`, partial index on `status='published'`.
- All UUID PKs via `gen_random_uuid()`; all timestamps `timestamptz`; cascading deletes on `users` for the right-to-erasure path.

Execution model is gated by AXI-109 (on API startup with advisory lock vs as a one-shot Container Apps Job). PR 4 cannot land until that decision is made.
