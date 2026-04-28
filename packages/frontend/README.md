# `@pairup/frontend`

Frontend modules per HLD §4.1. Empty placeholder today; populated in PR 11 (AXI-120) when the current monolithic `apps/web-static/app.js` is split into typed modules and built with esbuild.

Planned modules:

```
src/
├── state.ts        # client cache; server is the source of truth
├── api.ts          # typed fetch wrapper, one fn per endpoint
├── auth.ts         # login redirect + session check
├── render/
│   ├── profile.ts
│   ├── matches.ts
│   ├── connections.ts
│   └── modals.ts
├── admin/          # lazy-loaded when isAdmin
└── main.ts         # bootstrap
```

Build: `esbuild` → `apps/web/public/` (consumed by Fastify static middleware).
