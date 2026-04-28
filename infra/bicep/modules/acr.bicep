param name string
param location string
param sku string = 'Basic'

@description('Principal IDs (managed identities) that need AcrPull on this registry.')
param pullPrincipalIds array = []

resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: name
  location: location
  sku: {
    name: sku
  }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
    anonymousPullEnabled: false
    zoneRedundancy: 'Disabled'
  }
}

var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

resource acrPullAssignments 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for principalId in pullPrincipalIds: {
  scope: acr
  name: guid(acr.id, principalId, acrPullRoleId)
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
  }
}]

output id string = acr.id
output name string = acr.name
output loginServer string = acr.properties.loginServer
