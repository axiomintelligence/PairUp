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
param targetPort int = 8080

@description('Container Apps dev-service IDs to bind into the app (e.g. Postgres add-on). Each entry: { serviceId: <id>, name: <bindName> }. Empty for the Phase 1 Postgres-Flex topology.')
param serviceBinds array = []

@description('Plain env vars (name + value).')
param env array = []

@description('Key Vault-backed secrets. Each entry: { name: <secretRef>, keyVaultUrl: <https://...>, identity: <UAMI resource id> }. Referenced from `env` via `secretRef`.')
param keyVaultSecrets array = []

@description('Probe path for liveness + readiness. /api/health for the Fastify backend; / for the legacy nginx Phase 0 image.')
param probePath string = '/api/health'

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
      // Container Apps `secrets` block — every entry exposes the secret as
      // `secretref:<name>` to env vars. `keyVaultUrl` resolves to "latest" when
      // no version segment is appended; the UAMI must have `Key Vault Secrets
      // User` on the vault (see keyvault.bicep).
      secrets: [for s in keyVaultSecrets: {
        name: s.name
        keyVaultUrl: s.keyVaultUrl
        identity: s.identity
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
          env: env
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
