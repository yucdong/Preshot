[CmdletBinding()]
param(
    [switch]$SkipBrowserInstall
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$locationPushed = $false

function Assert-Command {
    param(
        [Parameter(Mandatory)]
        [string]$Name,
        [Parameter(Mandatory)]
        [string]$InstallHint
    )

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Missing required command '$Name'. $InstallHint"
    }
}

function Test-WebView2 {
    $clientRoots = @(
        "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients",
        "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients"
    )

    foreach ($root in $clientRoots) {
        if (-not (Test-Path $root)) {
            continue
        }

        foreach ($client in Get-ChildItem $root) {
            $properties = Get-ItemProperty $client.PSPath -ErrorAction SilentlyContinue
            $nameProperty = $properties.PSObject.Properties["name"]
            if ($nameProperty -and $nameProperty.Value -like "*WebView2*") {
                return $true
            }
        }
    }

    return $false
}

function Assert-VisualCppBuildTools {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
    if (-not (Test-Path $vswhere)) {
        throw "Visual Studio Installer was not detected. Install Visual Studio 2022 Build Tools with the Desktop development with C++ workload."
    }

    $installationPath = & $vswhere `
        -latest `
        -products * `
        -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
        -property installationPath

    if (-not $installationPath) {
        throw "Visual C++ build tools were not detected. Install the Desktop development with C++ workload in Visual Studio Installer."
    }
}

try {
    if ($env:OS -ne "Windows_NT") {
        throw "This initializer supports Windows only."
    }

    $cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
    if ((Test-Path $cargoBin) -and ($env:PATH -notlike "*$cargoBin*")) {
        $env:PATH = "$cargoBin;$env:PATH"
    }

    Assert-Command "node" "Install the current Node.js LTS release from https://nodejs.org/."
    Assert-Command "pnpm" "Run 'corepack enable' and 'corepack prepare pnpm@10.15.0 --activate'."
    Assert-Command "rustc" "Install Rust with rustup from https://rustup.rs/."
    Assert-Command "cargo" "Install Rust with rustup from https://rustup.rs/."
    Assert-VisualCppBuildTools

    if (-not (Test-WebView2)) {
        throw "Microsoft Edge WebView2 Runtime was not detected. Install it from https://developer.microsoft.com/microsoft-edge/webview2/."
    }

    Push-Location $PSScriptRoot
    $locationPushed = $true
    pnpm install --frozen-lockfile

    if (-not $SkipBrowserInstall) {
        pnpm exec playwright install chromium
    }

    Write-Host "Preshot is ready. Run 'pnpm tauri:dev' to start the desktop app." -ForegroundColor Green
}
catch {
    Write-Error "Preshot initialization failed: $($_.Exception.Message)"
    exit 1
}
finally {
    if ($locationPushed) {
        Pop-Location -ErrorAction SilentlyContinue
    }
}
