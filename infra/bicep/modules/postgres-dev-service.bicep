// Postgres "dev service" add-on — implemented as a Microsoft.App/containerApps
// resource with `configuration.service.type = "postgres"`. This is the
// current shape; the older `Microsoft.App/managedEnvironments/services` resource
// type is being deprecated.
//
// Cheap and convenient for demo workloads; no SLA, no managed backups.
// Apps in the same environment bind to this via `serviceBinds`, which
// injects POSTGRES_HOST / POSTGRES_USERNAME / POSTGRES_PASSWORD /
// POSTGRES_DATABASE env vars at runtime.

param name string
param location string
param environmentId string

resource pgService 'Microsoft.App/containerApps@2024-10-02-preview' = {
  name: name
  location: location
  properties: {
    environmentId: environmentId
    configuration: {
      service: {
        type: 'postgres'
      }
    }
  }
}

output id string = pgService.id
output name string = pgService.name
