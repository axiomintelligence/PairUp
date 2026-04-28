# PairUp

A job-share matcher for FCDO staff. **Phase 0** today is a static client-side demo (the only deployable artefact); **Phase 1** (Fastify backend, Entra ID auth, Postgres Flex, full HLD §6 schema) is being built up commit-by-commit per [PairUp-Production-HLD-v1.0](docs/superpowers/specs/2026-04-22-productionise-pairup-design.md).

**Live (Phase 0 demo)**: https://ca-pairup-web.calmflower-39831488.uksouth.azurecontainerapps.io/

## Repository layout

This repo is an **npm workspaces monorepo**.

```
.
├── apps/
│   ├── web/              # @pairup/web — Phase 1 Fastify backend (TypeScript)
│   └── web-static/       # Phase 0 nginx static demo (the live URL today)
├── packages/
│   ├── frontend/         # @pairup/frontend — frontend modules, esbuild output (PR 11)
│   └── matching/         # @pairup/matching — shared scoring logic (PR 3)
├── migrations/           # node-pg-migrate SQL migrations (PR 4)
├── tests/                # Vitest / Playwright / k6 (PR 14)
├── infra/                # Bicep — Azure Container Apps + ACR + Postgres + Key Vault
├── docs/
│   ├── deployment/       # Azure deployment plan + runbook
│   └── superpowers/      # Productionise spec + HLD
└── .github/workflows/    # GitHub Actions (OIDC): infra-deploy + app-deploy
```

## Working with the monorepo

```bash
npm install                                  # installs all workspaces

npm --workspace @pairup/web run dev          # tsx watch on apps/web (port 8080)
npm --workspace @pairup/web run typecheck    # strict tsc
npm --workspace @pairup/web run build        # tsc → apps/web/dist

npm run typecheck                            # all workspaces
```

Workspace-package READMEs ([apps/web](apps/web/README.md), [packages/frontend](packages/frontend/README.md), [packages/matching](packages/matching/README.md), [migrations](migrations/README.md), [tests](tests/README.md)) cover scope and current status.

## Run the static demo locally

```bash
python3 -m http.server 8765 --directory apps/web-static
open http://localhost:8765/
```

`localStorage` is partitioned per origin, so prefer `http://` over opening `apps/web-static/index.html` directly via `file://`.

## Deployment (Azure UK South)

Phase 0 is hosted in resource group `rg-pairup-uksouth` (Microsoft Azure Sponsorship subscription). Architecture is documented in [docs/deployment/azure-uksouth-plan.md](docs/deployment/azure-uksouth-plan.md); day-2 ops are in [docs/deployment/runbook.md](docs/deployment/runbook.md).

**Phase 0 stack** (live today):

- **Azure Container Apps** — hosts an nginx container serving `apps/web-static/`. Scales 0–3 on HTTP traffic.
- **Azure Container Registry** (`acrpairupuksouth`) — Basic tier, holds the `pairup-web` image.
- **Postgres dev-service add-on** (`pairup-pg`) — Postgres running inside the Container Apps environment. No SLA, no managed backups; suitable for the demo. Phase 1 swaps this for Postgres Flexible Server (HLD §11).
- **Key Vault** — empty, reserved for future app secrets.
- **Log Analytics** — sink for container logs.
- **User-assigned managed identity** — used by the Container App for ACR pull and Key Vault access (no stored secrets).

Estimated cost: ~£6–11/month idle.

### Manual deploy of the Phase 0 demo

```bash
az account set --subscription acb7f374-57b1-4bc8-bd61-676c3947b148
az configure --defaults location=uksouth group=rg-pairup-uksouth

# Provision / reconcile infra (idempotent)
az deployment group create -g rg-pairup-uksouth \
  -f infra/main.bicep -p @infra/main.parameters.uksouth.json

# Build and push the static demo image, then point the Container App at it
TAG=$(git rev-parse --short HEAD)
az acr build --registry acrpairupuksouth \
  --image "pairup-web:${TAG}" --image "pairup-web:latest" \
  --file apps/web-static/Dockerfile apps/web-static
az containerapp update -n ca-pairup-web -g rg-pairup-uksouth \
  --image "acrpairupuksouth.azurecr.io/pairup-web:${TAG}" \
  --revision-suffix "rev-${TAG}"
```

### Continuous deploy via GitHub Actions

Two workflows ship in [.github/workflows](.github/workflows):

- `infra-deploy.yml` — manual (`workflow_dispatch`); runs `what-if` or `deploy` against the Bicep templates. Production runs gate on the `production` GitHub environment.
- `app-deploy.yml` — runs on push to `main` when files under `apps/web-static/` change. Builds in ACR, updates the Container App revision, and smoke-tests the public URL.

Both authenticate to Azure via OIDC. Bootstrap (App Registration, federated credentials, repo variables) is in [docs/deployment/runbook.md](docs/deployment/runbook.md). Phase 1 will replace `app-deploy.yml`'s build target with `apps/web/Dockerfile` once that container ships (PR 13 / AXI-122).
