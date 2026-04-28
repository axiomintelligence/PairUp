locals {
  log_analytics_name      = "log-${var.name_prefix}-${var.region_tag}"
  acr_name                = lower("acr${var.name_prefix}${var.region_tag}")
  managed_identity_name   = "id-${var.name_prefix}-web"
  key_vault_name          = "kv-${var.name_prefix}-${var.region_tag}"
  postgres_flex_name      = "psql-${var.name_prefix}-${var.region_tag}"
  postgres_devsvc_name    = "${var.name_prefix}-pg"
  postgres_database_name  = "pairup"
  container_apps_env_name = "cae-${var.name_prefix}-${var.region_tag}"
  container_app_name      = "ca-${var.name_prefix}-web"

  # Built-in role definition IDs.
  acr_pull_role_id            = "7f951dda-4ed3-4680-a7ca-43fe172d538d"
  key_vault_secrets_user_role = "4633458b-17de-408a-b874-0445c86b69e6"

  # azapi needs the full ARM ID of the parent resource group.
  resource_group_id = "/subscriptions/${data.azurerm_subscription.current.subscription_id}/resourceGroups/${var.resource_group_name}"
}
