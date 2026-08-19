param(
    [string]$EnvFile = ".env",
    [string]$Location = "swedencentral"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$SubscriptionId = "b75faa02-db01-487a-bf96-156a8fc08879"
$ResourceGroup = "rg-quizatz-prod"
$Repository = "carl-else/quizatz"
$PagesOrigin = "https://carl-else.github.io"
$DeploymentIdentityName = "quizatz-github-deployment"
$StorageAccountName = "stquizatzb75faa02"
$ContainerAppName = "ca-quizatz-prod"

function Assert-CommandSucceeded([string]$Description) {
    if ($LASTEXITCODE -ne 0) {
        throw "$Description failed with exit code $LASTEXITCODE."
    }
}

function Get-EnvValue([string]$Name) {
    if (-not (Test-Path $EnvFile)) {
        return ""
    }
    $line = Get-Content $EnvFile | Where-Object { $_ -match "^$([regex]::Escape($Name))=" } | Select-Object -Last 1
    if (-not $line) {
        return ""
    }
    return ($line -split "=", 2)[1]
}

function Require-Value([string]$Name, [string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw "$Name is required in $EnvFile."
    }
}

foreach ($command in "az", "gh") {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "Required command '$command' is not installed."
    }
}

$tenantId = Get-EnvValue "ENTRA_TENANT_ID"
$clientId = Get-EnvValue "ENTRA_API_CLIENT_ID"
$scopeName = Get-EnvValue "ENTRA_API_SCOPE"
$completeScope = Get-EnvValue "VITE_ENTRA_API_SCOPE"
Require-Value "ENTRA_TENANT_ID" $tenantId
Require-Value "ENTRA_API_CLIENT_ID" $clientId
Require-Value "ENTRA_API_SCOPE" $scopeName
Require-Value "VITE_ENTRA_API_SCOPE" $completeScope

az account set --subscription $SubscriptionId
Assert-CommandSucceeded "Selecting the approved Azure subscription"
$selectedSubscription = az account show --query id --output tsv
if ($selectedSubscription -ne $SubscriptionId) {
    throw "Azure CLI selected subscription $selectedSubscription instead of $SubscriptionId."
}

Write-Host "Creating dedicated resource group $ResourceGroup in $Location."
az group create --name $ResourceGroup --location $Location --output none
Assert-CommandSucceeded "Creating resource group"

foreach ($provider in "Microsoft.App", "Microsoft.Storage") {
    az provider register --namespace $provider --wait
    Assert-CommandSucceeded "Registering $provider"
}

$foundationImage = "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest"
$existingImage = az resource show `
    --resource-group $ResourceGroup `
    --resource-type "Microsoft.App/containerApps" `
    --name $ContainerAppName `
    --api-version "2024-03-01" `
    --query "properties.template.containers[0].image" `
    --output tsv 2>$null
if ($LASTEXITCODE -eq 0 -and $existingImage) {
    $foundationImage = $existingImage
}

Write-Host "Deploying Container Apps and Table Storage infrastructure."
az deployment group create `
    --resource-group $ResourceGroup `
    --name quizatz-foundation `
    --template-file infra/main.bicep `
    --parameters `
        storageAccountName=$StorageAccountName `
        image=$foundationImage `
        entraTenantId=$tenantId `
        entraApiClientId=$clientId `
        entraApiScope=$scopeName `
        allowedOrigins=$PagesOrigin `
    --output none
Assert-CommandSucceeded "Deploying Azure infrastructure"

$applicationId = az ad app list --display-name $DeploymentIdentityName --query "[0].appId" --output tsv
if (-not $applicationId) {
    $applicationId = az ad app create --display-name $DeploymentIdentityName --query appId --output tsv
    Assert-CommandSucceeded "Creating GitHub deployment application"
}

$servicePrincipalId = az ad sp show --id $applicationId --query id --output tsv 2>$null
if (-not $servicePrincipalId) {
    $servicePrincipalId = az ad sp create --id $applicationId --query id --output tsv
    Assert-CommandSucceeded "Creating GitHub deployment service principal"
}

$resourceGroupId = az group show --name $ResourceGroup --query id --output tsv
foreach ($role in "Contributor", "Role Based Access Control Administrator") {
    $existingRole = az role assignment list `
        --assignee-object-id $servicePrincipalId `
        --scope $resourceGroupId `
        --role $role `
        --query "[0].id" `
        --output tsv
    if (-not $existingRole) {
        az role assignment create `
            --assignee-object-id $servicePrincipalId `
            --assignee-principal-type ServicePrincipal `
            --role $role `
            --scope $resourceGroupId `
            --output none
        Assert-CommandSucceeded "Assigning $role"
    }
}

$credentialName = "github-pages-environment"
$repositoryMetadata = gh api "repos/$Repository" | ConvertFrom-Json
Assert-CommandSucceeded "Reading GitHub repository metadata"
$federatedSubject = "repo:$($repositoryMetadata.owner.login)@$($repositoryMetadata.owner.id)/$($repositoryMetadata.name)@$($repositoryMetadata.id):environment:github-pages"
$existingCredential = az ad app federated-credential list `
    --id $applicationId `
    --query "[?name=='$credentialName'] | [0]" `
    --output json | ConvertFrom-Json
Assert-CommandSucceeded "Reading GitHub federated credential"
$credential = @{
    name = $credentialName
    issuer = "https://token.actions.githubusercontent.com"
    subject = $federatedSubject
    description = "Deploy Quizatz from the protected GitHub Pages environment"
    audiences = @("api://AzureADTokenExchange")
} | ConvertTo-Json -Compress
$credentialFile = New-TemporaryFile
try {
    Set-Content -Path $credentialFile -Value $credential -Encoding utf8NoBOM
    if (-not $existingCredential) {
        az ad app federated-credential create --id $applicationId --parameters $credentialFile --output none
        Assert-CommandSucceeded "Creating GitHub federated credential"
    }
    elseif ($existingCredential.subject -ne $federatedSubject) {
        az ad app federated-credential update `
            --id $applicationId `
            --federated-credential-id $existingCredential.id `
            --parameters $credentialFile `
            --output none
        Assert-CommandSucceeded "Updating GitHub federated credential"
    }
}
finally {
    Remove-Item $credentialFile -Force
}

Write-Host "Configuring non-secret GitHub Actions variables."
gh variable set AZURE_CLIENT_ID --body $applicationId
gh variable set AZURE_TENANT_ID --body $tenantId
gh variable set AZURE_STORAGE_ACCOUNT_NAME --body $StorageAccountName
gh variable set ENTRA_CLIENT_ID --body $clientId
gh variable set ENTRA_TENANT_ID --body $tenantId
gh variable set ENTRA_API_SCOPE --body $completeScope
gh variable set ENTRA_API_SCOPE_NAME --body $scopeName
Assert-CommandSucceeded "Configuring GitHub variables"

Write-Host "Azure foundation complete in subscription $SubscriptionId, resource group $ResourceGroup."
