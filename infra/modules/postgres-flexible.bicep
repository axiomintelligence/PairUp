// Postgres Flexible Server — managed Postgres with backups, point-in-time
// restore, and an SLA. Replaces the dev-service add-on (which has none of
// those) per AXI-124 / HLD §11.1.
//
// Network model for Phase 1: public network access ENABLED with the
// "Allow Azure services" firewall rule, so the Container Apps env (which
// has non-deterministic outbound IPs on the Consumption plan) can reach
// it. Strong password auth + TLS-only connections protect the surface.
// Phase 2 (AXI-124) lifts this into a private endpoint inside a VNet
// shared with the Container Apps env; this module exposes the shape so
// that swap is a parameter change.
//
// Sizing: Standard_B1ms (1 vCore, 2 GiB RAM, burstable) + 32 GB storage
// is the minimum supported tier and costs ~£11/mo. The HLD §11.1 pegs
// production at GP_Standard_D2s_v3 / 64 GB; bump `skuName`/`storageGb`
// when traffic ramps.

@description('Server name (lowercase, 3-63 chars, must be globally unique within Azure DNS).')
param name string

@description('Region — must match the Container Apps env so latency stays sub-ms.')
param location string

@description('Postgres major version. 16 is current LTS as of 2025.')
param postgresVersion string = '16'

@description('SKU name. B1ms = burstable 1 vCore, 2 GiB RAM. Phase 1 default.')
param skuName string = 'Standard_B1ms'

@description('SKU tier. Burstable for B-series, GeneralPurpose for D/E-series.')
param skuTier string = 'Burstable'

@description('Storage size in GB. 32 is the minimum supported.')
param storageGb int = 32

@description('Server admin login. Cannot be `azure_superuser`, `azure_pg_admin`, `admin`, `administrator`, `root`, `guest`, or `public`.')
param administratorLogin string = 'pairupadmin'

@description('Server admin password. Pass via secureString CLI param or Bicep keyVault reference; never commit.')
@secure()
param administratorPassword string

@description('Initial database name created on the server.')
param databaseName string = 'pairup'

@description('Days of automated backup retention. 7 is the minimum.')
param backupRetentionDays int = 7

@description('Enable geo-redundant backups. Off for Phase 1 (cost); on once the workload warrants region-failover.')
param geoRedundantBackup string = 'Disabled'

@description('Enable HA. Disabled for Phase 1 (cost); ZoneRedundant once warranted.')
param highAvailabilityMode string = 'Disabled'

resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: name
  location: location
  sku: {
    name: skuName
    tier: skuTier
  }
  properties: {
    version: postgresVersion
    administratorLogin: administratorLogin
    administratorLoginPassword: administratorPassword
    storage: {
      storageSizeGB: storageGb
      autoGrow: 'Enabled'
    }
    backup: {
      backupRetentionDays: backupRetentionDays
      geoRedundantBackup: geoRedundantBackup
    }
    highAvailability: {
      mode: highAvailabilityMode
    }
    network: {
      publicNetworkAccess: 'Enabled'
    }
    authConfig: {
      activeDirectoryAuth: 'Disabled' // AXI-124 swap: 'Enabled' + tenantId for MI-based auth
      passwordAuth: 'Enabled'
      tenantId: subscription().tenantId
    }
  }
}

// "Allow public access from any Azure service within Azure to this server"
// — this is the firewall rule that uses host 0.0.0.0/end 0.0.0.0 as a
// sentinel to allow any Azure-internal source. Container Apps Consumption
// outbound IPs aren't deterministic so this is the simplest reliable
// allow path until VNet integration lands.
resource fwAllowAzureServices 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: pg
  name: 'AllowAllAzureServicesAndResourcesWithinAzureIps'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource db 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: pg
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// Azure Postgres Flex blocks `CREATE EXTENSION` for any extension not listed
// in the `azure.extensions` server parameter. Migration 1730000000000_initial-
// schema requires `citext` (case-insensitive email) and `pgcrypto`
// (gen_random_uuid). Allowlisting them here lets migrations succeed on first
// boot. This is a static config change (no restart needed for these).
resource extAllowlist 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: pg
  name: 'azure.extensions'
  properties: {
    value: 'CITEXT,PGCRYPTO'
    source: 'user-override'
  }
}

// SSL is required by default on Flex; pg drivers must use sslmode=require.
// libpq parses `sslmode=require` from a query string on the connection URI
// without further config, which is what we emit in main.bicep.

output id string = pg.id
output name string = pg.name
output fqdn string = pg.properties.fullyQualifiedDomainName
output administratorLogin string = administratorLogin
output databaseName string = databaseName
