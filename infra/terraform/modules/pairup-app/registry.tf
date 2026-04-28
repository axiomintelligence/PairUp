resource "azurerm_container_registry" "this" {
  name                = local.acr_name
  resource_group_name = var.resource_group_name
  location            = var.location
  sku                 = "Basic"
  admin_enabled       = false

  # HLD §11.1 — image pull is via the Container App's managed identity, not a
  # registry password.
  public_network_access_enabled = true
  anonymous_pull_enabled        = false

  tags = var.tags
}

resource "azurerm_role_assignment" "acr_pull_for_web" {
  scope                = azurerm_container_registry.this.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.web.principal_id
}
