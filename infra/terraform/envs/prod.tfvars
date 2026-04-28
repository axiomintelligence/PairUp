# prod / customer Azure tenant. Template — fill in customer-provided values
# before the first apply.
subscription_id     = "00000000-0000-0000-0000-000000000000" # FIXME — customer subscription
tenant_id           = "00000000-0000-0000-0000-000000000000" # FIXME — customer tenant
location            = "uksouth"
name_prefix         = "pairup"
region_tag          = "uksouth"
resource_group_name = "rg-uks-pairup-prd"

tags = {
  app         = "pairup"
  environment = "prod"
}

# Phase 1 prod-tier values (HLD §11.2).
enable_postgres_flex = true
postgres_sku         = "GP_Standard_D2s_v3"
