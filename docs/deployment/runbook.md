# PairUp deployment runbook (Azure UK South)

Day-1 bootstrap and day-2 operations for the deployment described in [azure-uksouth-plan.md](azure-uksouth-plan.md).

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

**Repository secrets**: none required for Phase 1 (the Postgres dev-service manages its own credentials and exposes them to the app via service binding).

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

### Inspect the Postgres dev-service

```bash
# Confirm the service exists and is running
az containerapp env service list \
  --name cae-pairup-uksouth \
  --resource-group rg-pairup-uksouth -o table

# Show the binding from the app's perspective
az containerapp show -n ca-pairup-web -g rg-pairup-uksouth \
  --query 'properties.template.serviceBinds'
```

### Connect to the dev-service Postgres ad-hoc

The dev-service Postgres has no public endpoint — connect from a one-shot container in the same Container Apps environment that runs `psql` against the bound service:

```bash
az containerapp exec \
  -n ca-pairup-web -g rg-pairup-uksouth \
  --command "/bin/sh -c 'apk add --no-cache postgresql-client >/dev/null && PGPASSWORD=\"\$POSTGRES_PASSWORD\" psql -h \"\$POSTGRES_HOST\" -U \"\$POSTGRES_USERNAME\" -d \"\$POSTGRES_DATABASE\"'"
```

(The Phase 2 backend container will read the same `POSTGRES_*` env vars at startup; no manual config needed.)

### Reset the dev-service (destroys data)

```bash
# Delete and recreate the add-on — credentials and any data are wiped
az containerapp env service delete \
  --name pairup-pg --environment cae-pairup-uksouth -g rg-pairup-uksouth --yes
# Then re-run `Infra deploy (Bicep)` with mode=deploy to recreate.
```

### Upgrade to managed Flexible Server later

When you outgrow the dev-service (need backups, SLA, point-in-time restore), swap `infra/modules/postgres-dev-service.bicep` for a `postgres-flexible.bicep` module that provisions `Microsoft.DBforPostgreSQL/flexibleServers` (B1ms or larger), and replace the `serviceBinds` entry on the container app with explicit `POSTGRES_*` env vars sourced from Key Vault. The rest of the topology stays the same.

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
| Bicep deploy stuck on Postgres add-on                | Dev-service provisioning is usually <1 min. If it hangs, check `az containerapp env service list` and the env's provisioning state. |
| Key Vault name in use error                          | Soft-delete from a prior run. `az keyvault purge -n kv-pairup-uksouth --location uksouth`.              |
| Smoke test passes but UI looks broken                | Check browser console; likely `localStorage` quota or a CSP header. We currently set no CSP — investigate other headers in `nginx.conf`. |
