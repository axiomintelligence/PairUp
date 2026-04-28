# Postgres Flexible Server — Phase 1 (HLD §11). Gated by enable_postgres_flex.
# When true, this replaces the dev-service add-on. PR 15 (AXI-124) flips this.

resource "random_password" "postgres_admin" {
  count            = var.enable_postgres_flex ? 1 : 0
  length           = 32
  min_lower        = 4
  min_upper        = 4
  min_numeric      = 4
  min_special      = 2
  special          = true
  override_special = "!@#%&*-_=+:"
}

resource "azurerm_postgresql_flexible_server" "this" {
  count               = var.enable_postgres_flex ? 1 : 0
  name                = local.postgres_flex_name
  resource_group_name = var.resource_group_name
  location            = var.location

  version      = "16"
  sku_name     = var.postgres_sku
  storage_mb   = 32 * 1024
  storage_tier = "P4"
  zone         = "1"

  administrator_login    = var.postgres_admin_login
  administrator_password = random_password.postgres_admin[0].result

  authentication {
    active_directory_auth_enabled = true
    password_auth_enabled         = true
    tenant_id                     = var.tenant_id
  }

  backup_retention_days         = 7
  geo_redundant_backup_enabled  = false
  public_network_access_enabled = true

  tags = var.tags
}

resource "azurerm_postgresql_flexible_server_database" "pairup" {
  count     = var.enable_postgres_flex ? 1 : 0
  name      = local.postgres_database_name
  server_id = azurerm_postgresql_flexible_server.this[0].id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

resource "azurerm_key_vault_secret" "postgres_admin_password" {
  count        = var.enable_postgres_flex ? 1 : 0
  name         = "postgres-admin-password"
  value        = random_password.postgres_admin[0].result
  key_vault_id = azurerm_key_vault.this.id

  depends_on = [
    azurerm_role_assignment.kv_secrets_user_for_web,
  ]
}

resource "azurerm_monitor_diagnostic_setting" "postgres_flex" {
  count                      = var.enable_postgres_flex ? 1 : 0
  name                       = "send-to-log-analytics"
  target_resource_id         = azurerm_postgresql_flexible_server.this[0].id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.this.id

  enabled_log {
    category = "PostgreSQLLogs"
  }

  metric {
    category = "AllMetrics"
  }
}
