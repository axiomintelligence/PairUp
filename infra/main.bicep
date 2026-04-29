targetScope = 'resourceGroup'

@description('Region for all resources')
param location string = resourceGroup().location

@description('Short name suffix used across resources')
param namePrefix string = 'pairup'

@description('Region tag used for resource names')
param regionTag string = 'uksouth'

@description('Postgres database name created on the Flexible Server.')
param postgresDatabaseName string = 'pairup'

@description('Postgres admin login.')
param postgresAdminLogin string = 'pairupadmin'

@description('Postgres admin password. Pass via az CLI `--parameters postgresAdminPassword=<from-vault>` and never commit. Generate with `openssl rand -base64 24` and stash in Key Vault.')
@secure()
param postgresAdminPassword string

@description('Container image to deploy. Leave default for first bootstrap; the app-deploy workflow updates this on each push.')
param containerImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

@description('Disable real auth on the live URL (Phase 1 demo before Entra tenant decision lands). When `true`, every request is authenticated as a fixed non-admin demo user; admin endpoints stay locked.')
param authDisabled bool = true

@description('Run migrations at API startup under a Postgres advisory lock (HLD §6 + §17). AXI-109 may flip this to a Container Apps Job, in which case set false.')
param runMigrationsOnStartup bool = true

var logAnalyticsName = 'log-${namePrefix}-${regionTag}'
var acrName = toLower('acr${namePrefix}${regionTag}')
var managedIdentityName = 'id-${namePrefix}-web'
var keyVaultName = 'kv-${namePrefix}-${regionTag}'
var postgresFlexName = '${namePrefix}-pg-flex'
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

// Key Vault holds the Postgres connection string the container app reads
// at runtime via `secrets[].keyVaultUrl`. The UAMI is granted Secrets User
// inside the keyvault module.
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

// Phase 1 Postgres: managed Flexible Server (B1ms). Replaces the dev-service
// add-on per AXI-124 / HLD §11.1. Public network access with Allow-Azure-
// Services firewall + TLS-only is the simplest reliable path on Container
// Apps Consumption (outbound IPs aren't deterministic). Phase 2 lifts to a
// private endpoint inside a shared VNet.
module postgresFlex 'modules/postgres-flexible.bicep' = {
  name: 'postgresFlex'
  params: {
    name: postgresFlexName
    location: location
    administratorLogin: postgresAdminLogin
    administratorPassword: postgresAdminPassword
    databaseName: postgresDatabaseName
  }
}

// Connection string the API reads from DATABASE_URL. URI-encode the
// password to survive any literal `@` / `/` / `?` characters that
// `openssl rand -base64` may emit. `sslmode=require` is mandatory on Flex.
var pgPasswordEncoded = uriComponent(postgresAdminPassword)
var databaseUrl = 'postgres://${postgresAdminLogin}:${pgPasswordEncoded}@${postgresFlex.outputs.fqdn}:5432/${postgresDatabaseName}?sslmode=require'

module databaseUrlSecret 'modules/keyvault-secret.bicep' = {
  name: 'databaseUrlSecret'
  params: {
    vaultName: keyVault.outputs.name
    secretName: 'database-url'
    secretValue: databaseUrl
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
    probePath: '/api/health'
    keyVaultSecrets: [
      {
        name: 'database-url'
        keyVaultUrl: databaseUrlSecret.outputs.uri
        identity: managedIdentity.outputs.id
      }
    ]
    env: [
      {
        name: 'DATABASE_URL'
        secretRef: 'database-url'
      }
      {
        name: 'PUBLIC_BASE_URL'
        value: 'https://ca-${namePrefix}-web.${containerAppsEnv.outputs.defaultDomain}'
      }
      {
        name: 'NODE_ENV'
        value: 'production'
      }
      {
        name: 'LOG_LEVEL'
        value: 'info'
      }
      {
        name: 'AUTH_DISABLED'
        value: '${authDisabled}'
      }
      {
        name: 'RUN_MIGRATIONS_ON_STARTUP'
        value: '${runMigrationsOnStartup}'
      }
    ]
  }
}

output resourceGroupName string = resourceGroup().name
output containerAppName string = containerApp.outputs.name
output containerAppFqdn string = containerApp.outputs.fqdn
output acrName string = acr.outputs.name
output acrLoginServer string = acr.outputs.loginServer
output postgresServerName string = postgresFlex.outputs.name
output postgresFqdn string = postgresFlex.outputs.fqdn
output postgresDatabaseName string = postgresDatabaseName
output keyVaultName string = keyVault.outputs.name
output managedIdentityClientId string = managedIdentity.outputs.clientId
output managedIdentityPrincipalId string = managedIdentity.outputs.principalId
