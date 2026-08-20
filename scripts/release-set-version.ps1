param(
    [Parameter(Position = 0, Mandatory)]
    [string]$Version,
    [switch]$Publish
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot "production-tools.psm1") -Force
$repositoryRoot = Split-Path $PSScriptRoot -Parent

try {
    $changed = Set-ReleaseVersionFiles -RepositoryRoot $repositoryRoot -Version $Version -Publish:$Publish
    if ($changed) {
        Write-Host "Release version updated to $Version in package.json, Cargo.toml, Cargo.lock, and tauri.conf.json." -ForegroundColor Green
    }
    else {
        Write-Host "Release version is already $Version; no files changed."
    }
}
catch {
    Write-Error "Release version update failed: $($_.Exception.Message)"
    exit 1
}
