data "azurerm_subscription" "current" {}

resource "azurerm_resource_group" "this" {
  name     = var.resource_group_name
  location = var.location
  tags     = var.tags
}

module "pairup_app" {
  source = "./modules/pairup-app"

  resource_group_name          = azurerm_resource_group.this.name
  location                     = azurerm_resource_group.this.location
  name_prefix                  = var.name_prefix
  region_tag                   = var.region_tag
  tenant_id                    = var.tenant_id
  log_analytics_retention_days = var.log_analytics_retention_days
  container_image              = var.container_image
  enable_postgres_flex         = var.enable_postgres_flex
  postgres_admin_login         = var.postgres_admin_login
  postgres_sku                 = var.postgres_sku
  tags                         = var.tags
}
