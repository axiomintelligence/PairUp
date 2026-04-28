data "azurerm_subscription" "current" {}

resource "azurerm_log_analytics_workspace" "this" {
  name                = local.log_analytics_name
  resource_group_name = var.resource_group_name
  location            = var.location
  sku                 = "PerGB2018"
  retention_in_days   = var.log_analytics_retention_days
  tags                = var.tags
}
