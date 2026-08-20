param([switch]$Publish)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot "production-tools.psm1") -Force
$repositoryRoot = Split-Path $PSScriptRoot -Parent

try {
    $publishing = Test-PublishingMode -Publish:$Publish
    $configuration = Get-ReleaseConfiguration $repositoryRoot
    Assert-ReleasePublicationPolicy $configuration -Publish:$publishing
    Assert-ProductionPrerequisites $configuration
    Invoke-ProductionValidation $configuration -IncludeE2E

    $artifacts = Assert-ReleaseArtifacts $configuration
    $signing = Get-ReleaseSigningState `
        -Paths @($artifacts.Executable.FullName, $artifacts.Msi.FullName) `
        -Publish:$publishing
    Assert-ReleaseMetadata $configuration $artifacts $signing
    Invoke-InstallerValidationHook $configuration -Publish:$publishing

    Write-Host "Production release verification passed without rebuilding the MSI." -ForegroundColor Green
}
catch {
    Write-Error "Production verification failed: $($_.Exception.Message)"
    exit 1
}
