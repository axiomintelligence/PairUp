# PairUp

A demo job-share matcher that helps colleagues find potential job-share partners. State persists in Postgres via a tiny Express API; identity is a per-browser UUID cookie (no login).

**Live**: https://ca-pairup-web.livelyflower-37ae75e9.uksouth.azurecontainerapps.io/

## Run locally

```bash
docker compose up --build
open http://localhost:8080/
```

Brings up two containers: `db` (postgres:16-alpine) and `web` (the same Node image we ship). Local admin passphrase is `localdev`.

## Project layout

```
.
├── index.html, app.js, data.js, styles.css   # the SPA — served as static files
├── favicon.{ico,svg,png}
├── server/                                   # Node 20 / Express API + db helper
│   ├── server.js                             #   /api/state, /api/admin/*, /healthz
│   ├── db.js                                 #   pg pool + idempotent schema init
│   ├── init.sql                              #   user_state, app_settings
│   └── package.json
├── Dockerfile                                # node:20-alpine, serves static + API
├── docker-compose.yml                        # local web + db
├── infra/                                    # Bicep — Container Apps + ACR + KV + Postgres Flexible Server
│   ├── main.bicep
│   ├── main.parameters.uksouth.json
│   └── modules/
└── .github/workflows/                        # GitHub Actions: infra-deploy + app-deploy (OIDC)
```

## Deployment (Azure UK South)

Hosted in resource group `rg-pairup-uksouth` (Microsoft Azure Sponsorship subscription). Background and design notes are in [docs/deployment/azure-uksouth-plan.md](docs/deployment/azure-uksouth-plan.md); day-2 ops are in [docs/deployment/runbook.md](docs/deployment/runbook.md).

**Stack**

- **Azure Container Apps** (`ca-pairup-web`) — runs a Node 20 container that serves the SPA *and* `/api/*`. Listens on `:8080`, probes `/healthz`. Scales 0–3 on HTTP traffic.
- **Azure Container Registry** (`acrpairupuksouth`) — Basic tier, holds the `pairup-web` image.
- **Azure Database for PostgreSQL Flexible Server** (`psql-pairup-uksouth`) — Burstable B1ms (1 vCore, 2 GB RAM, 32 GB storage), 7-day backups. Public access with the *Allow Azure Services* firewall rule so the Container App can connect.
- **Key Vault** (`kv-pairup-uksouth`) — holds `postgres-admin-password` and `app-admin-passphrase`. The Container App reads them via the managed identity as `PGPASSWORD` and `ADMIN_PASSPHRASE` env vars.
- **Log Analytics** — sink for container logs.
- **User-assigned managed identity** (`id-pairup-web`) — used for ACR pull and Key Vault secret reads.

**Estimated cost**: ~£18–25/month idle (Container Apps + ACR Basic + Flexible Server B1ms + storage + Log Analytics).

### Manual deploy from a workstation

```bash
az account set --subscription acb7f374-57b1-4bc8-bd61-676c3947b148
az configure --defaults location=uksouth group=rg-pairup-uksouth

# Build and push the image first so the Container App can pass its readiness probe.
TAG=$(git rev-parse --short HEAD)
az acr build --registry acrpairupuksouth --resource-group rg-pairup-uksouth \
  --image "pairup-web:${TAG}" --image "pairup-web:latest" --file Dockerfile .

# Provision / reconcile infra and roll the Container App to the new image.
az deployment group create -g rg-pairup-uksouth \
  -f infra/main.bicep -p @infra/main.parameters.uksouth.json \
  -p containerImage="acrpairupuksouth.azurecr.io/pairup-web:${TAG}"
```

The Postgres admin password and app admin passphrase have deterministic defaults derived from the resource group ID; pass `-p postgresAdminPassword=… -p adminPassphrase=…` to override (and rotate by re-deploying with new values).

### Continuous deploy via GitHub Actions

Two workflows ship in [.github/workflows](.github/workflows):

- `infra-deploy.yml` — manual (`workflow_dispatch`); runs `what-if` or `deploy` against the Bicep templates. Production runs gate on the `production` GitHub environment.
- `app-deploy.yml` — runs on push to `main` when app files, the server, or the Dockerfile change. Builds in ACR, updates the Container App revision, and smoke-tests the public URL.

Both authenticate to Azure via OIDC. Bootstrap (App Registration, federated credentials, repo variables) is in [docs/deployment/runbook.md §1.3–§1.4](docs/deployment/runbook.md).
