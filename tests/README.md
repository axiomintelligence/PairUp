# `tests/`

Test suite per HLD §14. Empty placeholder today; populated in PR 14 (AXI-123).

- **Unit (Vitest)** — `packages/matching` and authz helpers, ~80% line coverage.
- **Integration (testcontainers)** — Fastify + Postgres in container; covers auth, ownership, connection-request state transitions, GDPR cascade.
- **End-to-end (Playwright + mock-oidc)** — "publish profile then see matches" and "send request → other user accepts → both see connection".
- **Load (k6)** — three scenarios against a 20k seeded dev pool. Pass criteria gate Phase 4.
