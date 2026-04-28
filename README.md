# PairUp

A demo job-share matcher: a static client-side app that helps colleagues find potential job-share partners. State lives in `localStorage` (key `pairup_v2`); no backend yet.

**Live**: https://ca-pairup-web.calmflower-39831488.uksouth.azurecontainerapps.io/

## Run locally

```bash
python3 -m http.server 8765
open http://localhost:8765/
```

`localStorage` is partitioned per origin, so prefer `http://` over opening `index.html` directly via `file://`.

## Project layout

```
.
├── index.html, app.js, data.js, styles.css   # the app
├── favicon.{ico,svg,png}
├── Dockerfile                                # nginx:alpine serving the static files
├── nginx.conf                                # gzip, security headers, /healthz
├── infra/                                    # Bicep — Azure Container Apps + ACR + Postgres dev-service + Key Vault
│   ├── main.bicep
│   ├── main.parameters.uksouth.json
│   └── modules/
└── .github/workflows/                        # GitHub Actions: infra-deploy + app-deploy (OIDC)
```

## Deployment (Azure UK South)

Hosted in resource group `rg-pairup-uksouth` (Microsoft Azure Sponsorship subscription). The architecture is documented in [docs/deployment/azure-uksouth-plan.md](docs/deployment/azure-uksouth-plan.md); day-2 ops are in [docs/deployment/runbook.md](docs/deployment/runbook.md).

**Stack**

- **Azure Container Apps** — hosts an nginx container serving the static files. Scales 0–3 on HTTP traffic.
- **Azure Container Registry** (`acrpairupuksouth`) — Basic tier, holds the `pairup-web` image.
- **Postgres dev-service add-on** (`pairup-pg`) — Postgres running inside the Container Apps environment, bound to the app via `serviceBinds` (injects `POSTGRES_HOST`/`USERNAME`/`PASSWORD`/`DATABASE` env vars). No SLA, no managed backups; suitable for a demo. Upgrade path to Postgres Flexible Server is a contained Bicep change.
- **Key Vault** — empty, reserved for future app secrets.
- **Log Analytics** — sink for container logs.
- **User-assigned managed identity** — used by the Container App for ACR pull and Key Vault access (no stored secrets).

**Estimated cost**: ~£6–11/month idle.

### Manual deploy from a workstation

```bash
az account set --subscription acb7f374-57b1-4bc8-bd61-676c3947b148
az configure --defaults location=uksouth group=rg-pairup-uksouth

# Provision / reconcile infra
az deployment group create -g rg-pairup-uksouth \
  -f infra/main.bicep -p @infra/main.parameters.uksouth.json

# Build and push the app image, then point the Container App at it
TAG=$(git rev-parse --short HEAD)
az acr build --registry acrpairupuksouth --image "pairup-web:${TAG}" --image "pairup-web:latest" --file Dockerfile .
az containerapp update -n ca-pairup-web -g rg-pairup-uksouth \
  --image "acrpairupuksouth.azurecr.io/pairup-web:${TAG}" \
  --revision-suffix "rev-${TAG}"
```

### Continuous deploy via GitHub Actions

Two workflows ship in [.github/workflows](.github/workflows):

- `infra-deploy.yml` — manual (`workflow_dispatch`); runs `what-if` or `deploy` against the Bicep templates. Production runs gate on the `production` GitHub environment.
- `app-deploy.yml` — runs on push to `main` when app files or the Dockerfile change. Builds in ACR, updates the Container App revision, and smoke-tests the public URL.

Both authenticate to Azure via OIDC. Bootstrap (App Registration, federated credentials, repo variables) is in [docs/deployment/runbook.md §1.3–§1.4](docs/deployment/runbook.md).
