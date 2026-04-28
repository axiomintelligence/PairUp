provider "azurerm" {
  features {
    key_vault {
      # Soft-delete is mandatory under the current tenant policy (HLD §16.1)
      # so we never rely on purge to recreate vaults.
      purge_soft_delete_on_destroy = false
    }
    resource_group {
      prevent_deletion_if_contains_resources = true
    }
  }
}

provider "azapi" {}
