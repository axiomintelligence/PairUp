// Single-secret writer.
//
// Lets us keep the value off the Bicep template (`@secure()` parameter) and
// flowing into the vault in a single deployment. The container app then
// references it via `keyVaultUrl` + UAMI for runtime resolution.

param vaultName string
param secretName string

@secure()
param secretValue string

resource kv 'Microsoft.KeyVault/vaults@2024-04-01-preview' existing = {
  name: vaultName
}

resource secret 'Microsoft.KeyVault/vaults/secrets@2024-04-01-preview' = {
  parent: kv
  name: secretName
  properties: {
    value: secretValue
    attributes: {
      enabled: true
    }
  }
}

output id string = secret.id
output name string = secret.name
@description('Vault URI for `secrets[].keyVaultUrl` on container apps. The container app resolves the latest version when no version segment is appended.')
output uri string = secret.properties.secretUri
