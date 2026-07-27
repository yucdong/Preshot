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

function Invoke-NativeCommandOutput {
    param(
        [Parameter(Mandatory)]
        [string]$Name,
        [string[]]$Arguments = @()
    )

    $output = & $Name @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Name $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
    }

    return ($output | Out-String).Trim()
}

function Invoke-NativeCommand {
    param(
        [Parameter(Mandatory)]
        [scriptblock]$Command,
        [Parameter(Mandatory)]
        [string]$Description
    )

    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Description failed with exit code $LASTEXITCODE."
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

    $nodeVersionText = Invoke-NativeCommandOutput "node" @("--version")
    $nodeVersion = [version]($nodeVersionText.TrimStart("v").Split("-")[0])
    $isSupportedNodeVersion = `
        ($nodeVersion.Major -eq 20 -and $nodeVersion -ge [version]"20.19.0") -or `
        ($nodeVersion.Major -eq 22 -and $nodeVersion -ge [version]"22.12.0") -or `
        ($nodeVersion.Major -ge 24 -and $nodeVersion.Major % 2 -eq 0)

    if (-not $isSupportedNodeVersion) {
        throw "Node.js $nodeVersionText is unsupported. Install Node.js 20.19.0 or newer in 20.x, Node.js 22.12.0 or newer, or a newer even-numbered LTS release."
    }

    $pnpmVersionText = Invoke-NativeCommandOutput "pnpm" @("--version")
    $pnpmVersion = [version]($pnpmVersionText.Split("-")[0])
    if ($pnpmVersion -ne [version]"10.15.0") {
        throw "pnpm $pnpmVersionText is unsupported. Install the project-pinned pnpm 10.15.0 release."
    }

    $rustVersionDetails = Invoke-NativeCommandOutput "rustc" @("-vV")
    if ($rustVersionDetails -notmatch "(?m)^host:\s+\S+-windows-msvc\s*$") {
        throw "The active Rust toolchain is not a Windows MSVC target. Run 'rustup default stable-x86_64-pc-windows-msvc'."
    }

    Assert-VisualCppBuildTools

    if (-not (Test-WebView2)) {
        throw "Microsoft Edge WebView2 Runtime was not detected. Install it from https://developer.microsoft.com/microsoft-edge/webview2/."
    }

    Push-Location $PSScriptRoot
    $locationPushed = $true
    Invoke-NativeCommand `
        -Description "pnpm install" `
        -Command { pnpm install --frozen-lockfile }

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
