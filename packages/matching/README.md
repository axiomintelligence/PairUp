# `@pairup/matching`

Shared matching logic per HLD §4.1 + §7.2. Empty placeholder today; populated in PR 3 (AXI-112) when the current client-side `scoreMatch` / `rankScore` / `dayComplementarity` functions are lifted out of `apps/web-static/app.js` into typed pure functions.

Consumed by:

- `@pairup/web` Stage-2 in-process scoring.
- `@pairup/frontend` for any client-side preview if needed (likely not — server is authoritative).

Built with `tsc`, no Fastify or Postgres dependencies.
