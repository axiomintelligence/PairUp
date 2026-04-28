# `@pairup/web`

Phase 1 backend — Fastify + TypeScript. Will serve `/api/*` and the built static bundle from `packages/frontend` once those land.

## Scripts

```bash
npm --workspace @pairup/web run dev        # tsx watch — local development
npm --workspace @pairup/web run typecheck  # strict tsc, no emit
npm --workspace @pairup/web run build      # tsc → apps/web/dist
npm --workspace @pairup/web run start      # node apps/web/dist/index.js
```

## Endpoints (current)

- `GET /api/health` — liveness; returns `{ status: "ok" }`. Stub today; gains real checks in PR 2 (AXI-111).
- `GET /api/ready` — readiness; returns `{ status: "ready" }`. Stub today; gains DB-pool warm + Entra metadata fetch in later PRs.

The full HLD §7 surface lands across PRs 5–10.
