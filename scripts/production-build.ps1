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
    Invoke-ProductionValidation $configuration
    Remove-StaleProductMsis $configuration

    $tauriScript = Join-Path $PSScriptRoot "tauri.ps1"
    Invoke-CheckedNative `
        -FilePath (Get-Process -Id $PID).Path `
        -Arguments @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $tauriScript, "build", "--target", $configuration.Target, "--no-bundle") `
        -Description "Tauri x64 release executable build"

    $executable = Assert-ReleaseExecutable $configuration
    Invoke-PostBuildSigning -Paths @($executable.FullName)

    $bundleConfigurationPath = Join-Path $configuration.ReleaseDirectory "preshot-production-bundle.json"
    $bundleConfiguration = @{ version = $configuration.Version } | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText(
        $bundleConfigurationPath,
        $bundleConfiguration,
        [System.Text.UTF8Encoding]::new($false)
    )
    try {
        Invoke-CheckedNative `
            -FilePath (Get-Process -Id $PID).Path `
            -Arguments @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $tauriScript, "bundle", "--target", $configuration.Target, "--bundles", "msi", "--config", $bundleConfigurationPath) `
            -Description "Tauri x64 release MSI bundle"
    }
    finally {
        if (Test-Path -LiteralPath $bundleConfigurationPath) {
            Remove-Item -LiteralPath $bundleConfigurationPath -Force
        }
    }

    $artifacts = Assert-ReleaseArtifacts $configuration
    Invoke-PostBuildSigning -Paths @($artifacts.Msi.FullName)
    $signing = Get-ReleaseSigningState -Paths @($artifacts.Executable.FullName, $artifacts.Msi.FullName) -Publish:$publishing
    $artifacts = Assert-ReleaseArtifacts $configuration
    Write-ReleaseMetadata $configuration $artifacts $signing
    $publication = Get-ReleasePublicationState -Configuration $configuration -Signing $signing

    Write-Host "Production MSI: $($artifacts.Msi.FullName)" -ForegroundColor Green
    Write-Host "Release manifest: $($configuration.ManifestPath)" -ForegroundColor Green
    if (-not $publication.Publishable) {
        Write-Warning "Artifacts are labeled non-publishable: $($publication.Blockers -join ', '). Increment the lineage version when required, configure signing, and use PRESHOT_PUBLISH=1 for publishing."
    }
}
catch {
    Write-Error "Production build failed: $($_.Exception.Message)"
    exit 1
}
