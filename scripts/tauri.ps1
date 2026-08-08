param(
    [Parameter(ValueFromRemainingArguments)]
    [string[]]$TauriArguments
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
$cargo = Join-Path $cargoBin "cargo.exe"

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    if (-not (Test-Path $cargo)) {
        Write-Error "Cargo was not found. Install Rust with rustup, then restart VS Code."
        exit 1
    }

    $env:PATH = "$cargoBin;$env:PATH"
}

$tauri = Join-Path $PSScriptRoot "..\node_modules\.bin\tauri.cmd"
if (-not (Test-Path $tauri)) {
    Write-Error "The local Tauri CLI was not found. Run '.\init.ps1' or 'pnpm install' first."
    exit 1
}

& $tauri @TauriArguments
exit $LASTEXITCODE