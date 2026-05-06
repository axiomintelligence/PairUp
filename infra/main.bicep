targetScope = 'resourceGroup'

@description('Region for all resources')
param location string = resourceGroup().location

@description('Short name suffix used across resources')
param namePrefix string = 'pairup'

@description('Region tag used for resource names')
param regionTag string = 'uksouth'

@description('Postgres database name')
param postgresDatabaseName string = 'pairup'

@description('Container image to deploy. Leave default for first bootstrap; the app-deploy workflow updates this on each push.')
param containerImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

@secure()
@description('Postgres administrator password. Default is a deterministic uniqueString-based value; override at deploy time to rotate.')
param postgresAdminPassword string = 'Pg!${take(uniqueString(resourceGroup().id, 'pgseed'), 8)}_${take(uniqueString(resourceGroup().id, 'pgseed2'), 12)}aZ1'

@secure()
@description('App admin passphrase (gates /api/admin/* routes). Default is deterministic; override at deploy time.')
param adminPassphrase string = 'admin-${take(uniqueString(resourceGroup().id, 'adminseed'), 12)}'

var logAnalyticsName = 'log-${namePrefix}-${regionTag}'
var acrName = toLower('acr${namePrefix}${regionTag}')
var managedIdentityName = 'id-${namePrefix}-web'
var keyVaultName = 'kv-${namePrefix}-${regionTag}'
var postgresServerName = 'psql-${namePrefix}-${regionTag}'
var containerAppsEnvName = 'cae-${namePrefix}-${regionTag}'
var containerAppName = 'ca-${namePrefix}-web'
var postgresAdminLogin = 'pairupadmin'

module logAnalytics 'modules/log-analytics.bicep' = {
  name: 'logAnalytics'
  params: {
    name: logAnalyticsName
    location: location
  }
}

module managedIdentity 'modules/managed-identity.bicep' = {
  name: 'managedIdentity'
  params: {
    name: managedIdentityName
    location: location
  }
}

module acr 'modules/acr.bicep' = {
  name: 'acr'
  params: {
    name: acrName
    location: location
    pullPrincipalIds: [
      managedIdentity.outputs.principalId
    ]
  }
}

module keyVault 'modules/keyvault.bicep' = {
  name: 'keyVault'
  params: {
    name: keyVaultName
    location: location
    secretsUserPrincipalIds: [
      managedIdentity.outputs.principalId
    ]
  }
}

// Look up the existing vault as a top-level resource so we can attach secrets to it.
resource kvRef 'Microsoft.KeyVault/vaults@2024-04-01-preview' existing = {
  name: keyVaultName
  dependsOn: [ keyVault ]
}

resource pgPasswordSecret 'Microsoft.KeyVault/vaults/secrets@2024-04-01-preview' = {
  parent: kvRef
  name: 'postgres-admin-password'
  properties: {
    value: postgresAdminPassword
    contentType: 'text/plain'
  }
}

resource adminPassphraseSecret 'Microsoft.KeyVault/vaults/secrets@2024-04-01-preview' = {
  parent: kvRef
  name: 'app-admin-passphrase'
  properties: {
    value: adminPassphrase
    contentType: 'text/plain'
  }
}

module containerAppsEnv 'modules/container-apps-env.bicep' = {
  name: 'containerAppsEnv'
  params: {
    name: containerAppsEnvName
    location: location
    logAnalyticsWorkspaceName: logAnalytics.outputs.name
  }
}

module postgres 'modules/postgres-flexible-server.bicep' = {
  name: 'postgresFlexibleServer'
  params: {
    name: postgresServerName
    databaseName: postgresDatabaseName
    location: location
    administratorLogin: postgresAdminLogin
    administratorPassword: postgresAdminPassword
  }
}

module containerApp 'modules/container-app.bicep' = {
  name: 'containerApp'
  params: {
    name: containerAppName
    location: location
    environmentId: containerAppsEnv.outputs.id
    managedIdentityId: managedIdentity.outputs.id
    acrLoginServer: acr.outputs.loginServer
    image: containerImage
    targetPort: 8080
    probePath: '/healthz'
    envVars: [
      { name: 'PGHOST',     value: postgres.outputs.fqdn }
      { name: 'PGPORT',     value: '5432' }
      { name: 'PGUSER',     value: postgresAdminLogin }
      { name: 'PGDATABASE', value: postgresDatabaseName }
      { name: 'PGSSL',      value: 'require' }
      { name: 'NODE_ENV',   value: 'production' }
    ]
    keyVaultSecrets: [
      { name: 'pg-password',     keyVaultUrl: '${kvRef.properties.vaultUri}secrets/postgres-admin-password' }
      { name: 'admin-passphrase', keyVaultUrl: '${kvRef.properties.vaultUri}secrets/app-admin-passphrase' }
    ]
    secretEnvVars: [
      { name: 'PGPASSWORD',       secretRef: 'pg-password' }
      { name: 'ADMIN_PASSPHRASE', secretRef: 'admin-passphrase' }
    ]
  }
  dependsOn: [
    pgPasswordSecret
    adminPassphraseSecret
  ]
}

output resourceGroupName string = resourceGroup().name
output containerAppName string = containerApp.outputs.name
output containerAppFqdn string = containerApp.outputs.fqdn
output acrName string = acr.outputs.name
output acrLoginServer string = acr.outputs.loginServer
output postgresServerName string = postgres.outputs.name
output postgresFqdn string = postgres.outputs.fqdn
output postgresDatabaseName string = postgresDatabaseName
output keyVaultName string = keyVault.outputs.name
output managedIdentityClientId string = managedIdentity.outputs.clientId
output managedIdentityPrincipalId string = managedIdentity.outputs.principalId
