output "resource_group_name" {
  value = azurerm_resource_group.this.name
}

output "container_app_name" {
  value = module.pairup_app.container_app_name
}

output "container_app_fqdn" {
  value = module.pairup_app.container_app_fqdn
}

output "acr_login_server" {
  value = module.pairup_app.acr_login_server
}

output "acr_name" {
  value = module.pairup_app.acr_name
}

output "key_vault_name" {
  value = module.pairup_app.key_vault_name
}

output "managed_identity_client_id" {
  value = module.pairup_app.managed_identity_client_id
}

output "log_analytics_workspace_name" {
  value = module.pairup_app.log_analytics_workspace_name
}

output "postgres_flex_fqdn" {
  value = module.pairup_app.postgres_flex_fqdn
}
