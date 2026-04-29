# PairUp deployment runbook (Azure UK South)

Day-1 bootstrap and day-2 operations for the deployment described in [azure-uksouth-plan.md](azure-uksouth-plan.md).

> **End-of-life:** [../decommission.md](../decommission.md) carries the T-30 / T-14 / T-0 / T+30 sequence, audit-log handover, and `terraform destroy` step.
>
> **Privacy:** [../dpia.md](../dpia.md) is the DPIA template — DPO sign-off gates Phase 2 (HLD §16.2).

Subscription: `acb7f374-57b1-4bc8-bd61-676c3947b148` (Microsoft Azure Sponsorship, AXIOM INTELLIGENCE LTD).
Resource group: `rg-pairup-uksouth`.

All commands assume:

```bash
az account set --subscription acb7f374-57b1-4bc8-bd61-676c3947b148
az configure --defaults location=uksouth group=rg-pairup-uksouth
```

---

## 1. One-time bootstrap

### 1.1 Register required resource providers

```bash
for ns in Microsoft.App Microsoft.OperationalInsights Microsoft.ContainerRegistry \
          Microsoft.KeyVault Microsoft.ManagedIdentity Microsoft.Insights; do
  az provider register --namespace "$ns"
done
```

> The Postgres dev-service is hosted by `Microsoft.App`, so no separate `Microsoft.DBforPostgreSQL` provider is needed.

### 1.2 Create the resource group

```bash
az group create -n rg-pairup-uksouth -l uksouth --tags app=pairup environment=production
```

### 1.3 Create GitHub OIDC App Registration

```bash
APP_NAME="github-pairup-deploy"
APP_ID=$(az ad app create --display-name "$APP_NAME" --query appId -o tsv)
SP_ID=$(az ad sp create --id "$APP_ID" --query id -o tsv)
SUB_ID=$(az account show --query id -o tsv)
RG_ID=$(az group show -n rg-pairup-uksouth --query id -o tsv)

# Grant Contributor on the resource group (RG-scoped, not subscription-scoped)
az role assignment create \
  --assignee-object-id "$SP_ID" --assignee-principal-type ServicePrincipal \
  --role Contributor --scope "$RG_ID"

# User Access Administrator is needed because Bicep creates role assignments
# (AcrPull on the registry, Key Vault Secrets User on the vault).
az role assignment create \
  --assignee-object-id "$SP_ID" --assignee-principal-type ServicePrincipal \
  --role "User Access Administrator" --scope "$RG_ID"

# Federated credential — main branch
az ad app federated-credential create --id "$APP_ID" --parameters '{
  "name": "github-main",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:axiomintelligence/PairUp:ref:refs/heads/main",
  "audiences": ["api://AzureADTokenExchange"]
}'

# Federated credential — production environment (used by infra-deploy on `mode=deploy`)
az ad app federated-credential create --id "$APP_ID" --parameters '{
  "name": "github-env-production",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:axiomintelligence/PairUp:environment:production",
  "audiences": ["api://AzureADTokenExchange"]
}'

echo "AZURE_CLIENT_ID:       $APP_ID"
echo "AZURE_TENANT_ID:       $(az account show --query tenantId -o tsv)"
echo "AZURE_SUBSCRIPTION_ID: $SUB_ID"
```

### 1.4 Configure GitHub repo

In `axiomintelligence/PairUp` → **Settings → Secrets and variables → Actions**:

**Repository variables**:
- `AZURE_CLIENT_ID` = `$APP_ID` from above
- `AZURE_TENANT_ID` = `12c068b0-44ec-490a-bb12-fe9512f110ad`
- `AZURE_SUBSCRIPTION_ID` = `acb7f374-57b1-4bc8-bd61-676c3947b148`

**Repository secrets**:

- `POSTGRES_ADMIN_PASSWORD` — Postgres Flex admin password. Generate once with
  `gh secret set POSTGRES_ADMIN_PASSWORD --body "$(openssl rand -base64 24 | tr -d '+/=')"`
  and store the same value somewhere safe (e.g. 1Password) — Bicep redeploys are
  idempotent against the same value but rotating the secret rewrites the live
  `database-url` in Key Vault and roll-forwards on the next container revision.

Then in **Settings → Environments**, create an environment called `production` and add required reviewers (yourself). The infra deploy step gates on this.

### 1.5 First infra deploy

1. GitHub → **Actions → Infra deploy (Bicep) → Run workflow → mode = `what-if`**. Review the diff.
2. Re-run with **mode = `deploy`**, approve the production gate. ~5–8 minutes.
3. The container app comes up with the public placeholder image (`mcr.microsoft.com/k8se/quickstart:latest`).

### 1.6 First app deploy

Push any change to the app files (or trigger `App deploy` manually). The workflow will:
- Build `pairup-web:<sha>` in ACR.
- Update the container app to that image.
- Smoke-test the public URL.

---

## 2. Day-2 operations

### Get the public URL

```bash
az containerapp show -n ca-pairup-web --query 'properties.configuration.ingress.fqdn' -o tsv
```

### Tail container logs

```bash
az containerapp logs show -n ca-pairup-web --follow --tail 100
```

Or in Log Analytics:

```kusto
ContainerAppConsoleLogs_CL
| where ContainerAppName_s == "ca-pairup-web"
| order by TimeGenerated desc
| take 100
```

### Roll back to the previous revision

```bash
# List revisions, newest first
az containerapp revision list -n ca-pairup-web -o table

# Activate a known-good revision and shift 100% traffic
az containerapp revision activate -n ca-pairup-web --revision <name>
az containerapp ingress traffic set -n ca-pairup-web --revision-weight <name>=100
```

### Inspect Postgres Flex

```bash
# Server status, SKU, FQDN
az postgres flexible-server show -n pairup-pg-flex -g rg-pairup-uksouth -o table

# DATABASE_URL secret on Key Vault (fetched by the container app at runtime)
az keyvault secret show --vault-name kv-pairup-uksouth --name database-url --query value -o tsv

# How the container app references it
az containerapp show -n ca-pairup-web -g rg-pairup-uksouth \
  --query 'properties.configuration.secrets'
```

### Connect to Postgres Flex ad-hoc

The Flex server has public network access enabled with the `AllowAllAzureServicesAndResourcesWithinAzureIps` firewall rule. To connect from your laptop, add a one-shot rule with your current IP, run psql, then remove it:

```bash
MY_IP=$(curl -s https://ifconfig.me)
az postgres flexible-server firewall-rule create \
  -n pairup-pg-flex -g rg-pairup-uksouth \
  --rule-name laptop-$(date +%s) \
  --start-ip-address "$MY_IP" --end-ip-address "$MY_IP"

# Pull the connection string the app uses, then connect
PGURL=$(az keyvault secret show --vault-name kv-pairup-uksouth --name database-url --query value -o tsv)
psql "$PGURL"

# Tear down the rule afterward
az postgres flexible-server firewall-rule delete \
  -n pairup-pg-flex -g rg-pairup-uksouth \
  --rule-name laptop-<the-timestamp> --yes
```

### Reset the database (destroys data)

```bash
# Drop and recreate the `pairup` database (server kept). Migrations rerun
# from scratch on the next container revision (RUN_MIGRATIONS_ON_STARTUP=true).
psql "$PGURL_AS_ADMIN" -c 'DROP DATABASE pairup; CREATE DATABASE pairup;'

# Force a new container revision so migrate-on-startup fires
az containerapp update -n ca-pairup-web -g rg-pairup-uksouth \
  --revision-suffix reset-$(date +%H%M)
```

### Rotate the Postgres admin password

```bash
NEW_PW=$(openssl rand -base64 24 | tr -d '+/=')
az postgres flexible-server update \
  -n pairup-pg-flex -g rg-pairup-uksouth \
  --admin-password "$NEW_PW"
gh secret set POSTGRES_ADMIN_PASSWORD --body "$NEW_PW"
# Then re-run `Infra deploy (Bicep)` with mode=deploy. It rewrites `database-url`
# in Key Vault. Force a new container revision to pick up the new secret value.
az containerapp update -n ca-pairup-web -g rg-pairup-uksouth \
  --revision-suffix pwrot-$(date +%H%M)
```

### Decommission the legacy dev-service add-on

Phase 0/1 used a Container Apps Postgres dev-service add-on (`pairup-pg`). Once Postgres Flex is live and the app is migrated, remove the dev-service:

```bash
# Confirm nothing still binds to it
az containerapp show -n ca-pairup-web -g rg-pairup-uksouth \
  --query 'properties.template.serviceBinds' # should be []

# Delete (the resource is a containerApps with configuration.service.type=postgres)
az containerapp delete -n pairup-pg -g rg-pairup-uksouth --yes
```

### Upgrade Postgres Flex sizing

```bash
# Scale up SKU (downtime: ~30-60s vertical scale)
az postgres flexible-server update \
  -n pairup-pg-flex -g rg-pairup-uksouth \
  --sku-name Standard_D2s_v3 --tier GeneralPurpose

# Or grow storage (online, no downtime)
az postgres flexible-server update \
  -n pairup-pg-flex -g rg-pairup-uksouth \
  --storage-size 64
```

### Move Postgres Flex behind a private endpoint (Phase 2 / AXI-124)

The current topology uses public network access + firewall rule. To lift into the same VNet as Container Apps:

1. Create a VNet + subnets (Postgres delegation + Container Apps env subnet).
2. Recreate the Container Apps env with `vnetConfiguration.infrastructureSubnetId` (existing env can't be vnet-integrated in place).
3. Switch `postgres-flexible.bicep` from `publicNetworkAccess: 'Enabled'` to `network.delegatedSubnetResourceId` (private DNS zone integration).
4. Delete the `AllowAllAzureServicesAndResourcesWithinAzureIps` firewall rule.

### Scale tweaks

```bash
# Bump max replicas
az containerapp update -n ca-pairup-web --max-replicas 5

# Pin to always-on (no scale-to-zero)
az containerapp update -n ca-pairup-web --min-replicas 1
```

### Tear it all down

```bash
az group delete -n rg-pairup-uksouth --yes --no-wait
# Key Vault soft-delete keeps the vault for 7 days; purge if you need the name back:
az keyvault purge -n kv-pairup-uksouth --location uksouth
```

---

## 3. Troubleshooting

| Symptom                                              | Likely cause / fix                                                                                      |
|------------------------------------------------------|---------------------------------------------------------------------------------------------------------|
| `infra-deploy` fails on role assignments            | The OIDC SP needs **User Access Administrator** on the RG (see §1.3). Re-run after granting.            |
| `app-deploy` fails at `az acr build`                 | ACR name conflict (globally unique). Rename `acrName` in `infra/main.bicep` and redeploy infra.         |
| Container App ingress 503 after first infra deploy   | Expected — placeholder image health probes failing. Trigger `app-deploy` to push the real image.        |
| Bicep deploy stuck on Postgres Flex                  | Initial provision is 5-8 min; SKU/storage updates are quicker. Check `az postgres flexible-server show -n pairup-pg-flex` for `state`.    |
| Key Vault name in use error                          | Soft-delete from a prior run. `az keyvault purge -n kv-pairup-uksouth --location uksouth`.              |
| Container app can't reach Postgres Flex (`db:failing`) | Confirm `AllowAllAzureServicesAndResourcesWithinAzureIps` firewall rule is in place; verify TLS via `psql "$PGURL"` from your laptop with a temp firewall rule. |
| `database-url` in Key Vault, but app reports `db:unconfigured` | UAMI is missing Key Vault Secrets User on the vault, or the secretRef name doesn't match. Check `az containerapp show … --query 'properties.configuration.secrets'`. |
| Smoke test passes but UI looks broken                | Check browser console; likely `localStorage` quota or a CSP header. We currently set no CSP — investigate other headers in `nginx.conf`. |
