targetScope = 'resourceGroup'

@description('Azure region for all Quizatz resources.')
param location string = resourceGroup().location

@description('Globally unique Storage account name.')
param storageAccountName string

@description('Container App name.')
param containerAppName string = 'ca-quizatz-prod'

@description('Container Apps managed environment name.')
param environmentName string = 'cae-quizatz-prod'

@description('Backend container image. The setup deployment can use the default placeholder before CI publishes Quizatz.')
param image string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

@description('Single-tenant Entra directory ID.')
param entraTenantId string

@description('Quizatz API application client ID.')
param entraApiClientId string

@description('Required delegated scope claim, for example access_as_user.')
param entraApiScope string = 'access_as_user'

@description('Comma-separated browser origins allowed to call the backend.')
param allowedOrigins string

@description('UTC start date for recurring monthly Cost Management budgets.')
param budgetStartDate string = utcNow('yyyy-MM-01T00:00:00Z')

var tableName = 'LiveSessions'

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource tableService 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource sessionsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tableService
  name: tableName
}

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: environmentName
  location: location
  properties: {}
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: containerAppName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
      }
    }
    template: {
      containers: [
        {
          name: 'backend'
          image: image
          env: [
            {
              name: 'ENTRA_TENANT_ID'
              value: entraTenantId
            }
            {
              name: 'ENTRA_API_CLIENT_ID'
              value: entraApiClientId
            }
            {
              name: 'ENTRA_API_SCOPE'
              value: entraApiScope
            }
            {
              name: 'ALLOWED_ORIGINS'
              value: allowedOrigins
            }
            {
              name: 'STORAGE_ACCOUNT_NAME'
              value: storage.name
            }
            {
              name: 'TABLE_NAME'
              value: sessionsTable.name
            }
          ]
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
      }
    }
  }
}

resource tableDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, app.id, 'Storage Table Data Contributor')
  scope: storage
  properties: {
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
    )
  }
}

resource costWarningBudget 'Microsoft.Consumption/budgets@2024-08-01' = {
  name: 'quizatz-monthly-cost-warning'
  properties: {
    amount: 100
    category: 'Cost'
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: budgetStartDate
    }
    notifications: {
      actualCostReached: {
        contactEmails: []
        contactRoles: [
          'Owner'
        ]
        enabled: true
        locale: 'en-us'
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Actual'
      }
    }
  }
}

resource costLimitBudget 'Microsoft.Consumption/budgets@2024-08-01' = {
  name: 'quizatz-monthly-cost-limit'
  properties: {
    amount: 150
    category: 'Cost'
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: budgetStartDate
    }
    notifications: {
      actualCostReached: {
        contactEmails: []
        contactRoles: [
          'Owner'
        ]
        enabled: true
        locale: 'en-us'
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Actual'
      }
    }
  }
}

output backendUrl string = 'https://${app.properties.configuration.ingress.fqdn}'
output containerAppName string = app.name
output storageAccountName string = storage.name
