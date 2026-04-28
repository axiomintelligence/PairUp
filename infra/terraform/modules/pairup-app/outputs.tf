output "container_app_name" {
  value = azurerm_container_app.web.name
}

output "container_app_fqdn" {
  value = azurerm_container_app.web.ingress[0].fqdn
}

output "container_apps_environment_id" {
  value = azurerm_container_app_environment.this.id
}

output "container_apps_environment_name" {
  value = azurerm_container_app_environment.this.name
}

output "acr_name" {
  value = azurerm_container_registry.this.name
}

output "acr_login_server" {
  value = azurerm_container_registry.this.login_server
}

output "key_vault_name" {
  value = azurerm_key_vault.this.name
}

output "key_vault_uri" {
  value = azurerm_key_vault.this.vault_uri
}

output "managed_identity_id" {
  value = azurerm_user_assigned_identity.web.id
}

output "managed_identity_client_id" {
  value = azurerm_user_assigned_identity.web.client_id
}

output "managed_identity_principal_id" {
  value = azurerm_user_assigned_identity.web.principal_id
}

output "log_analytics_workspace_id" {
  value = azurerm_log_analytics_workspace.this.id
}

output "log_analytics_workspace_name" {
  value = azurerm_log_analytics_workspace.this.name
}

output "postgres_flex_fqdn" {
  description = "Empty when enable_postgres_flex=false (Phase 0 dev-service path)."
  value       = var.enable_postgres_flex ? azurerm_postgresql_flexible_server.this[0].fqdn : ""
}
