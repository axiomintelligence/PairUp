resource "azurerm_key_vault" "this" {
  name                = local.key_vault_name
  resource_group_name = var.resource_group_name
  location            = var.location
  tenant_id           = var.tenant_id
  sku_name            = "standard"

  enable_rbac_authorization  = true
  soft_delete_retention_days = 7
  # purge_protection_enabled is omitted: tenant policy now requires it on, and
  # explicitly setting it to false is rejected. Azure defaults it appropriately.

  public_network_access_enabled = true

  network_acls {
    default_action = "Allow"
    bypass         = "AzureServices"
  }

  tags = var.tags
}

resource "azurerm_role_assignment" "kv_secrets_user_for_web" {
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.web.principal_id
}
