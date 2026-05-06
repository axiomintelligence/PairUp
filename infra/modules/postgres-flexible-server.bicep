@description('Flexible Server name (must be globally unique within the Postgres service).')
param name string

@description('Database name created on the server.')
param databaseName string = 'pairup'

@description('Region for the server.')
param location string

@description('Admin login (cannot be "azure_superuser", "admin", "administrator", "root", "postgres", "guest", "public").')
param administratorLogin string = 'pairupadmin'

@secure()
@description('Admin password. Generated and stored in Key Vault by main.bicep — do not commit.')
param administratorPassword string

@description('SKU. B1ms is the smallest Burstable tier (1 vCore, 2GB RAM).')
param skuName string = 'Standard_B1ms'

@description('Tier matching skuName. Burstable for B-series, GeneralPurpose for D-series.')
param tier string = 'Burstable'

@description('Postgres engine version.')
param postgresVersion string = '16'

@description('Storage size in GB. 32 is the minimum.')
param storageSizeGB int = 32

@description('Backup retention days (7-35).')
param backupRetentionDays int = 7

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: name
  location: location
  sku: {
    name: skuName
    tier: tier
  }
  properties: {
    administratorLogin: administratorLogin
    administratorLoginPassword: administratorPassword
    version: postgresVersion
    storage: {
      storageSizeGB: storageSizeGB
      autoGrow: 'Enabled'
    }
    backup: {
      backupRetentionDays: backupRetentionDays
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    network: {
      publicNetworkAccess: 'Enabled'
    }
    authConfig: {
      activeDirectoryAuth: 'Disabled'
      passwordAuth: 'Enabled'
    }
  }
}

resource db 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: server
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// Allow public Azure resources (Container Apps, etc.) to connect.
// The 0.0.0.0–0.0.0.0 range is the documented "Allow Azure services" pattern.
resource fwAllowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: server
  name: 'AllowAllAzureServicesAndResourcesWithinAzureIps'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

output id string = server.id
output name string = server.name
output fqdn string = server.properties.fullyQualifiedDomainName
output databaseName string = db.name
output administratorLogin string = administratorLogin
