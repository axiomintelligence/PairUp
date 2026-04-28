# dev / Phase 0 / Phase 1 in our Axiom Intelligence tenant.
# Subscription: Microsoft Azure Sponsorship.
subscription_id     = "acb7f374-57b1-4bc8-bd61-676c3947b148"
tenant_id           = "12c068b0-44ec-490a-bb12-fe9512f110ad"
location            = "uksouth"
name_prefix         = "pairup"
region_tag          = "uksouth"
resource_group_name = "rg-pairup-uksouth"

tags = {
  app         = "pairup"
  environment = "dev"
}

# Phase 1 toggles — flip these when their PRs land.
enable_postgres_flex = false
postgres_sku         = "B_Standard_B2s" # dev tier per HLD §11.2
