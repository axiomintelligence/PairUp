# PairUp — Azure deployment plan (UK South)

## 1. Context

PairUp is currently a static client-side demo (HTML/CSS/JS, state in `localStorage`). We want to:
1. Host it as a containerised app in **Azure Container Apps**, region **UK South**.
2. Provision a **lightweight Postgres** in the same environment, ready for a future backend.

Subscription: **Microsoft Azure Sponsorship** (`acb7f374-57b1-4bc8-bd61-676c3947b148`), tenant **AXIOM INTELLIGENCE LTD**.

For Postgres we use the **Container Apps Postgres add-on (dev service)** — Postgres runs as a managed service inside the Container Apps environment, costs pence/day on the env's Consumption billing, and exposes credentials via service binding rather than a Key Vault secret. Trade-off: no SLA, no managed backups; suitable for a demo, not for production data. Upgrade path to Postgres Flexible Server (B1ms, ~£10–13/mo) is a contained Bicep change.

> ⚠️ Sponsorship subscriptions have a credit cap. Estimated steady-state cost (§7) is ~£5–8/month; mostly ACR + Container Apps idle.

This plan covers Phase 1 (static frontend + idle Postgres add-on). Phase 2 (backend API wired to Postgres) is out of scope here and will need a separate plan once the data model is decided.

---

## 2. Architecture

```
                    ┌────────────────────────────────────────────────────┐
                    │  Resource group: rg-pairup-uksouth                 │
                    │                                                    │
   GitHub Actions ──┼─► ACR (acrpairupuksouth)                           │
   (push to main)   │     │                                              │
                    │     ▼                                              │
                    │  Container Apps Environment (cae-pairup-uksouth)   │
                    │     └─► Container App: ca-pairup-web (nginx)       │
                    │            ↑ public HTTPS ingress                  │
                    │                                                    │
   Internet  ───────┼──► https://ca-pairup-web.<hash>.uksouth...azurecontainerapps.io
                    │                                                    │
                    │  Postgres dev-service add-on (pairup-pg)           │
                    │     - lives inside the CAE, bound to the app       │
                    │     - injects POSTGRES_HOST / USERNAME / PASSWORD  │
                    │       / DATABASE env vars at runtime               │
                    │                                                    │
                    │  Log Analytics Workspace (log-pairup-uksouth)      │
                    │  Key Vault (kv-pairup-uksouth) — future app secrets│
                    └────────────────────────────────────────────────────┘
```

In Phase 1, the static frontend has no reason to talk to Postgres yet, but the service binding is already in place — the future backend container only has to read `POSTGRES_*` env vars to connect.

---

## 3. Resources to provision

| Resource                  | Name                       | SKU / Tier                          | Notes                                                    |
|---------------------------|----------------------------|-------------------------------------|----------------------------------------------------------|
| Resource group            | `rg-pairup-uksouth`        | —                                   | All resources scoped here                                |
| Log Analytics Workspace   | `log-pairup-uksouth`       | PerGB2018, 30-day retention         | Sink for Container Apps + diagnostics                    |
| Container Registry        | `acrpairupuksouth`         | **Basic** (£4/mo)                   | Globally unique alphanumeric                             |
| Container Apps Env        | `cae-pairup-uksouth`       | Consumption                         | Linked to Log Analytics; hosts both the app and the DB   |
| Container App             | `ca-pairup-web`            | 0.25 vCPU / 0.5 GiB, scale 0–3      | Image from ACR, public ingress on port 80                |
| Managed Identity          | `id-pairup-web`            | User-assigned                       | AcrPull on registry, Secrets User on Key Vault           |
| Key Vault                 | `kv-pairup-uksouth`        | Standard                            | Reserved for future app secrets                          |
| Postgres dev-service      | `pairup-pg` (in CAE)       | Container Apps add-on               | No SLA, no managed backups; creds injected via binding   |
| Postgres database         | `pairup`                   | —                                   | Default DB created by the add-on on first connect        |

**Why these choices**
- **ACR Basic** over Standard: 10 GB included is plenty for a static-site image; no geo-replication needed.
- **Postgres dev-service** over Flexible Server B1ms: at this scale we don't need the SLA or managed backups, and the add-on is roughly an order of magnitude cheaper. The Bicep is structured so we can swap to Flexible Server later by replacing one module.
- **User-assigned managed identity** so the Container App can pull from ACR and read Key Vault without storing secrets in env vars.
- **Service binding** (rather than secret env vars) because the add-on auto-rotates and injects connection details at runtime — nothing for us to seed or rotate.

---

## 4. Repo artefacts to add

```
PairUp/
├── Dockerfile                          # nginx:alpine serving the static files
├── nginx.conf                          # gzip, security headers, SPA-style fallback
├── .dockerignore
├── infra/
│   ├── main.bicep                      # top-level: RG-scoped deployment of all resources
│   ├── modules/
│   │   ├── log-analytics.bicep
│   │   ├── acr.bicep
│   │   ├── managed-identity.bicep
│   │   ├── keyvault.bicep
│   │   ├── postgres.bicep
│   │   ├── container-apps-env.bicep
│   │   └── container-app.bicep
│   └── main.parameters.uksouth.json    # region, names, SKUs for this env
├── .github/
│   └── workflows/
│       ├── infra-deploy.yml            # manual trigger: az login (OIDC) + Bicep what-if/deploy
│       └── app-deploy.yml              # on push to main: build image, push to ACR, update CA
└── docs/deployment/
    ├── azure-uksouth-plan.md           # this file
    └── runbook.md                      # day-2 operations (rotate DB password, scale, rollback)
```

**Dockerfile sketch**
```dockerfile
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html app.js data.js styles.css favicon.ico favicon.svg favicon-32.png /usr/share/nginx/html/
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O - http://localhost/ >/dev/null || exit 1
```

---

## 5. CI/CD flow

**Auth**: GitHub → Azure via **OIDC federated credentials** (no long-lived secrets in GitHub). Requires creating an App Registration with a federated credential bound to the `axiomintelligence/PairUp` repo + `main` branch, granted **Contributor** on `rg-pairup-uksouth` and **AcrPush** on the registry.

**`infra-deploy.yml`** — manual (`workflow_dispatch`):
1. `az login` via OIDC.
2. `az deployment group what-if` on `infra/main.bicep` → posts diff as a step summary.
3. Gated approval (GitHub environment `production`).
4. `az deployment group create`.

**`app-deploy.yml`** — `on: push: branches: [main]`, paths: app files only:
1. `az login` via OIDC.
2. `az acr build` (server-side build — no Docker daemon needed in the runner).
3. `az containerapp update --image acrpairupuksouth.azurecr.io/pairup-web:${{ github.sha }}` — Container Apps creates a new revision and shifts traffic.
4. Smoke test: `curl -fsS https://<fqdn>/` returns 200 and contains the `FCDOPairUp` brand string.

Rollback: Container Apps keeps prior revisions — `az containerapp revision activate --revision <previous>` flips traffic back in seconds.

---

## 6. Step-by-step execution

### One-time bootstrap (run by a human, ~15 min)

1. **Pick names that are globally unique** (ACR + Postgres). Defaults above assume `pairupuksouth` is free; the deploy will fail-fast if not.
2. **Set CLI defaults** locally:
   ```bash
   az account set --subscription acb7f374-57b1-4bc8-bd61-676c3947b148
   az configure --defaults location=uksouth group=rg-pairup-uksouth
   ```
3. **Create the resource group**:
   ```bash
   az group create -n rg-pairup-uksouth -l uksouth
   ```
4. **Register required resource providers** (idempotent; first-time subs only):
   ```bash
   for ns in Microsoft.App Microsoft.OperationalInsights Microsoft.ContainerRegistry \
             Microsoft.DBforPostgreSQL Microsoft.KeyVault Microsoft.ManagedIdentity; do
     az provider register --namespace "$ns"
   done
   ```
5. **Create the GitHub OIDC App Registration** (one-off), grant role assignments, add `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` as repo variables. Exact `az ad` commands will live in `runbook.md`.
6. **First Bicep deploy**: trigger `infra-deploy.yml` from the GitHub Actions UI. Approve the what-if diff. This provisions everything in §3.
7. **Seed the Postgres admin password** into Key Vault (Bicep generates it via `newGuid()` and stores it; we just confirm it's there).

### Recurring deploy (automated, ~3 min per push)

1. Push to `main`.
2. `app-deploy.yml` runs: ACR build → Container App update → smoke test → done.

---

## 7. Cost estimate (UK South, sponsorship sub)

| Item                            | £/month (idle)     |
|---------------------------------|--------------------|
| Container Apps (scale-to-zero)  | ~£0–2              |
| ACR Basic                       | £4                 |
| Postgres dev-service add-on     | ~£1–3              |
| Log Analytics (low volume)      | £1–2               |
| Key Vault                       | <£0.50             |
| **Total**                       | **~£6–11 / month** |

Numbers are approximate and based on current UK South retail prices — the sponsorship credit absorbs them while it lasts.

---

## 8. Decisions (locked in)

1. **Postgres credentials** — managed automatically by the dev-service add-on; no admin username/password to seed or rotate. (Was `pairup_admin` for Flexible Server.)
2. **Network posture** — the Postgres add-on is reachable only from container apps in the same environment, so there is no public endpoint or firewall to manage.
3. **Custom domain** — default `*.uksouth.azurecontainerapps.io` for now; revisit before Phase 2.
4. **Postgres major version** — whatever the add-on currently ships (PG 16 at time of writing); the add-on is rolled by Microsoft.
5. **Naming** — `*-pairup-uksouth` convention.

---

## 9. Verification (post-deploy)

End-to-end smoke checks once Phase 1 is live:

- `az containerapp show -n ca-pairup-web -g rg-pairup-uksouth --query properties.runningStatus` → `Running`.
- `curl -fsS https://<ca-fqdn>/` returns 200 and the response body contains `FCDOPairUp`.
- Browse the URL, confirm Privacy / About / Refresh buttons render and `localStorage` (`pairup_v2`) is writeable.
- Container Apps logs visible in Log Analytics: `ContainerAppConsoleLogs_CL | take 20`.
- Postgres add-on bound to the app: `az containerapp show -n ca-pairup-web --query 'properties.template.serviceBinds'` lists the `postgres` binding.
- Key Vault exists and the managed identity has Secrets User on it (ready for future app secrets).

---

## 10. What I will do next, once you confirm §8

1. Add the `Dockerfile`, `nginx.conf`, `.dockerignore`.
2. Write the Bicep modules + parameters file under `infra/`.
3. Write the two GitHub Actions workflows.
4. Write `docs/deployment/runbook.md` covering OIDC bootstrap, password rotation, scale, rollback.
5. Stop short of actually creating Azure resources — leave the first `az group create` + workflow trigger to you, so you control when the meter starts.
