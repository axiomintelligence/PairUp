# `infra/terraform/`

Canonical IaC for PairUp per HLD §3 + §17 (Terraform 1.6+). Resolves [AXI-107](https://linear.app/axiomintelligence/issue/AXI-107) — translates the previous `infra/bicep/` modules to Terraform.

```
infra/terraform/
├── versions.tf            # required_version + providers
├── providers.tf
├── main.tf                # resource group + module call
├── variables.tf
├── outputs.tf
├── envs/
│   ├── dev.tfvars         # Axiom Intelligence tenant (Phase 0 / Phase 1 dev)
│   └── prod.tfvars        # customer tenant (template — fill in before first apply)
└── modules/pairup-app/    # all Phase 0/1 resources, parameterised by enable_postgres_flex
```

## What it provisions

Mirrors the Phase 0 Bicep deployment exactly (same names, same SKUs, same identity model):

| Resource | Terraform | Bicep equivalent |
|---|---|---|
| Resource group | `azurerm_resource_group.this` | `infra/bicep/main.bicep` |
| Log Analytics workspace | `azurerm_log_analytics_workspace.this` | `modules/log-analytics.bicep` |
| User-assigned MI | `azurerm_user_assigned_identity.web` | `modules/managed-identity.bicep` |
| Container Registry (Basic) + AcrPull role | `azurerm_container_registry.this` + `azurerm_role_assignment.acr_pull_for_web` | `modules/acr.bicep` |
| Key Vault (RBAC) + Secrets User role | `azurerm_key_vault.this` + `azurerm_role_assignment.kv_secrets_user_for_web` | `modules/keyvault.bicep` |
| Container Apps Environment | `azurerm_container_app_environment.this` | `modules/container-apps-env.bicep` |
| Postgres dev-service add-on | `azapi_resource.postgres_dev_service` | `modules/postgres-dev-service.bicep` |
| Container App | `azurerm_container_app.web` | `modules/container-app.bicep` |

Set `enable_postgres_flex = true` in `envs/<env>.tfvars` to swap the dev-service for managed Postgres Flexible Server (HLD §11). PR 15 ([AXI-124](https://linear.app/axiomintelligence/issue/AXI-124)) flips this on.

## Local commands

```bash
cd infra/terraform

# Initialise + validate (no Azure auth required)
terraform init
terraform validate
terraform fmt -recursive -check
```

## Connecting Terraform to the live RG (one-time import)

The Phase 0 deployment is currently managed by the `infra/bicep/` module. Before swapping to Terraform as the source of truth, import each existing resource into TF state so the next `terraform apply` produces **no changes**.

> ⚠️ Run these from a workstation authenticated to the Microsoft Azure Sponsorship subscription (`acb7f374-…`). The `infra/bicep/` directory stays in the repo until this verifies clean.

```bash
SUB=acb7f374-57b1-4bc8-bd61-676c3947b148
RG=rg-pairup-uksouth
RG_ID="/subscriptions/$SUB/resourceGroups/$RG"

az account set --subscription "$SUB"

cd infra/terraform
terraform init

# Resource group
terraform import -var-file=envs/dev.tfvars azurerm_resource_group.this "$RG_ID"

# Log Analytics
terraform import -var-file=envs/dev.tfvars module.pairup_app.azurerm_log_analytics_workspace.this \
  "$RG_ID/providers/Microsoft.OperationalInsights/workspaces/log-pairup-uksouth"

# User-assigned managed identity
terraform import -var-file=envs/dev.tfvars module.pairup_app.azurerm_user_assigned_identity.web \
  "$RG_ID/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-pairup-web"

# ACR + AcrPull role assignment (the role-assignment id is shown by Azure when listed)
terraform import -var-file=envs/dev.tfvars module.pairup_app.azurerm_container_registry.this \
  "$RG_ID/providers/Microsoft.ContainerRegistry/registries/acrpairupuksouth"

ACR_ROLE_ID=$(az role assignment list \
  --assignee $(az identity show -n id-pairup-web -g $RG --query principalId -o tsv) \
  --scope "$RG_ID/providers/Microsoft.ContainerRegistry/registries/acrpairupuksouth" \
  --role AcrPull --query '[0].id' -o tsv)
terraform import -var-file=envs/dev.tfvars module.pairup_app.azurerm_role_assignment.acr_pull_for_web "$ACR_ROLE_ID"

# Key Vault + Secrets User role assignment
terraform import -var-file=envs/dev.tfvars module.pairup_app.azurerm_key_vault.this \
  "$RG_ID/providers/Microsoft.KeyVault/vaults/kv-pairup-uksouth"

KV_ROLE_ID=$(az role assignment list \
  --assignee $(az identity show -n id-pairup-web -g $RG --query principalId -o tsv) \
  --scope "$RG_ID/providers/Microsoft.KeyVault/vaults/kv-pairup-uksouth" \
  --role "Key Vault Secrets User" --query '[0].id' -o tsv)
terraform import -var-file=envs/dev.tfvars module.pairup_app.azurerm_role_assignment.kv_secrets_user_for_web "$KV_ROLE_ID"

# Container Apps Environment
terraform import -var-file=envs/dev.tfvars module.pairup_app.azurerm_container_app_environment.this \
  "$RG_ID/providers/Microsoft.App/managedEnvironments/cae-pairup-uksouth"

# Postgres dev-service (azapi)
terraform import -var-file=envs/dev.tfvars 'module.pairup_app.azapi_resource.postgres_dev_service[0]' \
  "$RG_ID/providers/Microsoft.App/containerApps/pairup-pg"

# Container App
terraform import -var-file=envs/dev.tfvars module.pairup_app.azurerm_container_app.web \
  "$RG_ID/providers/Microsoft.App/containerApps/ca-pairup-web"

# Verify: should show "No changes." (or only cosmetic rename diffs we accept)
terraform plan -var-file=envs/dev.tfvars
```

If the plan is clean, retire `infra/bicep/` and the `infra-deploy.yml` workflow (separate cleanup PR after a successful apply).

## Day-2 apply

```bash
terraform plan  -var-file=envs/dev.tfvars
terraform apply -var-file=envs/dev.tfvars
```

Production runs go through `.github/workflows/infra-deploy-tf.yml` (manual trigger; gated on the `production` GitHub environment).

## Provider notes

- **azurerm 3.x** for the bulk. `purge_protection_enabled` deliberately omitted on the Key Vault — tenant policy now requires it on, and explicitly setting it to `false` is rejected.
- **azapi 1.x** for the Postgres dev-service add-on (`Microsoft.App/containerApps` with `properties.configuration.service.type = "postgres"`); azurerm doesn't yet expose this configuration cleanly. PR 15 retires this dependency by switching to `azurerm_postgresql_flexible_server`.
- **random** for the Postgres Flex admin password (PR 15 only). Stored in `azurerm_key_vault_secret.postgres_admin_password`.
- **azuread** is not used here yet; PR 16 adds it for the Entra app registration + federated credential ([AXI-125](https://linear.app/axiomintelligence/issue/AXI-125)).

## State

State is local for now. Move to a remote backend (`azurerm` blob in a dedicated bootstrap RG) before any team apply — covered in the runbook.
