targetScope = 'resourceGroup'

@description('Region for all resources')
param location string = resourceGroup().location

@description('Short name suffix used across resources')
param namePrefix string = 'pairup'

@description('Region tag used for resource names')
param regionTag string = 'uksouth'

@description('Postgres database name (used in connection-string envs once a backend binds to the dev service)')
param postgresDatabaseName string = 'pairup'

@description('Container image to deploy. Leave default for first bootstrap; the app-deploy workflow updates this on each push.')
param containerImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

var logAnalyticsName = 'log-${namePrefix}-${regionTag}'
var acrName = toLower('acr${namePrefix}${regionTag}')
var managedIdentityName = 'id-${namePrefix}-web'
var keyVaultName = 'kv-${namePrefix}-${regionTag}'
var postgresServiceName = '${namePrefix}-pg'
var containerAppsEnvName = 'cae-${namePrefix}-${regionTag}'
var containerAppName = 'ca-${namePrefix}-web'

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

// Key Vault is kept for future application secrets even though the Postgres
// dev-service manages its own credentials and exposes them via service binding.
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

module containerAppsEnv 'modules/container-apps-env.bicep' = {
  name: 'containerAppsEnv'
  params: {
    name: containerAppsEnvName
    location: location
    logAnalyticsWorkspaceName: logAnalytics.outputs.name
  }
}

module postgres 'modules/postgres-dev-service.bicep' = {
  name: 'postgresDevService'
  params: {
    environmentId: containerAppsEnv.outputs.id
    location: location
    name: postgresServiceName
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
    serviceBinds: [
      {
        serviceId: postgres.outputs.id
        name: 'postgres'
      }
    ]
  }
}

output resourceGroupName string = resourceGroup().name
output containerAppName string = containerApp.outputs.name
output containerAppFqdn string = containerApp.outputs.fqdn
output acrName string = acr.outputs.name
output acrLoginServer string = acr.outputs.loginServer
output postgresServiceName string = postgres.outputs.name
output postgresDatabaseName string = postgresDatabaseName
output keyVaultName string = keyVault.outputs.name
output managedIdentityClientId string = managedIdentity.outputs.clientId
output managedIdentityPrincipalId string = managedIdentity.outputs.principalId
