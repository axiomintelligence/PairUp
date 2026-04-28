param name string
param location string

@description('Principal IDs (managed identities or users) granted Key Vault Secrets User on this vault.')
param secretsUserPrincipalIds array = []

resource kv 'Microsoft.KeyVault/vaults@2024-04-01-preview' = {
  name: name
  location: location
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    // enablePurgeProtection omitted — Azure tenant policy now requires it
    // enabled-by-default and rejects `false`. Once enabled it is irreversible
    // and the vault can't be purged before its soft-delete window expires.
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
  }
}

var secretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'

resource secretsUserAssignments 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for principalId in secretsUserPrincipalIds: {
  scope: kv
  name: guid(kv.id, principalId, secretsUserRoleId)
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', secretsUserRoleId)
  }
}]

output id string = kv.id
output name string = kv.name
output uri string = kv.properties.vaultUri
