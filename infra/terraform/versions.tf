terraform {
  required_version = ">= 1.6.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.116"
    }
    azapi = {
      # Used for the Postgres dev-service add-on (Microsoft.App/containerApps
      # with `properties.configuration.service.type = postgres`) which the
      # azurerm provider does not yet expose cleanly. Drop once
      # azurerm gains first-class support, or drop entirely once PR 15 swaps
      # the dev-service for Postgres Flexible Server.
      source  = "Azure/azapi"
      version = "~> 1.15"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}
