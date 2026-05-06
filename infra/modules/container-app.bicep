param name string
param location string
param environmentId string
param managedIdentityId string
param acrLoginServer string
param image string

param cpu string = '0.25'
param memory string = '0.5Gi'
param minReplicas int = 0
param maxReplicas int = 3
param targetPort int = 80

@description('Liveness/readiness probe path served by the container.')
param probePath string = '/'

@description('Container Apps dev-service IDs to bind into the app (e.g. Postgres add-on). Each entry: { serviceId: <id>, name: <bindName> }.')
param serviceBinds array = []

@description('Plain-value env vars on the container. Each: { name, value }.')
param envVars array = []

@description('Key Vault-backed app secrets. Each: { name, keyVaultUrl } — managed identity reads them.')
param keyVaultSecrets array = []

@description('Env vars sourced from app secrets. Each: { name, secretRef } — secretRef must match a `keyVaultSecrets[].name`.')
param secretEnvVars array = []

var plainEnv = [for e in envVars: { name: e.name, value: e.value }]
var secretEnv = [for s in secretEnvVars: { name: s.name, secretRef: s.secretRef }]
var allEnv = concat(plainEnv, secretEnv)

resource app 'Microsoft.App/containerApps@2024-10-02-preview' = {
  name: name
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentityId}': {}
    }
  }
  properties: {
    environmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: targetPort
        transport: 'Auto'
        allowInsecure: false
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
      registries: [
        {
          server: acrLoginServer
          identity: managedIdentityId
        }
      ]
      secrets: [for s in keyVaultSecrets: {
        name: s.name
        keyVaultUrl: s.keyVaultUrl
        identity: managedIdentityId
      }]
    }
    template: {
      serviceBinds: [for b in serviceBinds: {
        serviceId: b.serviceId
        name: b.name
      }]
      containers: [
        {
          name: 'web'
          image: image
          resources: {
            cpu: json(cpu)
            memory: memory
          }
          env: allEnv
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: probePath
                port: targetPort
              }
              periodSeconds: 30
              timeoutSeconds: 3
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: {
                path: probePath
                port: targetPort
              }
              periodSeconds: 10
              timeoutSeconds: 3
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: [
          {
            name: 'http-scale'
            http: {
              metadata: {
                concurrentRequests: '50'
              }
            }
          }
        ]
      }
    }
  }
}

output id string = app.id
output name string = app.name
output fqdn string = app.properties.configuration.ingress.fqdn
