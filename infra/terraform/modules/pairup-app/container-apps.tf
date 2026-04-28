resource "azurerm_container_app_environment" "this" {
  name                       = local.container_apps_env_name
  resource_group_name        = var.resource_group_name
  location                   = var.location
  log_analytics_workspace_id = azurerm_log_analytics_workspace.this.id
  tags                       = var.tags

  workload_profile {
    name                  = "Consumption"
    workload_profile_type = "Consumption"
  }
}

# ─── Postgres dev-service add-on (Phase 0) ─────────────────────────────────
# Microsoft.App/containerApps with `properties.configuration.service.type =
# postgres`. azurerm_container_app does not yet expose this configuration
# field cleanly, so we ship via azapi. PR 15 (AXI-124) replaces this with
# Postgres Flexible Server when var.enable_postgres_flex flips to true; the
# dev-service is then destroyed.
resource "azapi_resource" "postgres_dev_service" {
  count     = var.enable_postgres_flex ? 0 : 1
  type      = "Microsoft.App/containerApps@2024-10-02-preview"
  name      = local.postgres_devsvc_name
  parent_id = local.resource_group_id
  location  = var.location

  body = jsonencode({
    properties = {
      environmentId = azurerm_container_app_environment.this.id
      configuration = {
        service = {
          type = "postgres"
        }
      }
    }
  })

  schema_validation_enabled = false
}

resource "azurerm_container_app" "web" {
  name                         = local.container_app_name
  resource_group_name          = var.resource_group_name
  container_app_environment_id = azurerm_container_app_environment.this.id
  revision_mode                = "Single"
  workload_profile_name        = "Consumption"
  tags                         = var.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.web.id]
  }

  registry {
    server   = azurerm_container_registry.this.login_server
    identity = azurerm_user_assigned_identity.web.id
  }

  ingress {
    # External today (Phase 0 demo). PR 17 (AXI-126) flips to internal per
    # HLD §11 once the customer-tenant network path is in place.
    external_enabled           = true
    target_port                = 80
    transport                  = "auto"
    allow_insecure_connections = false

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = 0
    max_replicas = 3

    container {
      name   = "web"
      image  = var.container_image
      cpu    = 0.25
      memory = "0.5Gi"

      liveness_probe {
        transport               = "HTTP"
        path                    = "/"
        port                    = 80
        interval_seconds        = 30
        timeout                 = 3
        failure_count_threshold = 3
      }

      readiness_probe {
        transport               = "HTTP"
        path                    = "/"
        port                    = 80
        interval_seconds        = 10
        timeout                 = 3
        failure_count_threshold = 3
      }
    }

    http_scale_rule {
      name                = "http-scale"
      concurrent_requests = "50"
    }
  }

  depends_on = [
    # Make sure the AcrPull role assignment is in place before the container
    # app tries to pull from ACR.
    azurerm_role_assignment.acr_pull_for_web,
  ]
}
