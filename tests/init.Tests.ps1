$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repositoryRoot = Split-Path $PSScriptRoot -Parent
$fixtureDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "preshot-init-$([guid]::NewGuid())"
$stdoutPath = Join-Path $fixtureDirectory "stdout.log"
$stderrPath = Join-Path $fixtureDirectory "stderr.log"

try {
    New-Item -ItemType Directory -Path $fixtureDirectory | Out-Null
    @"
@echo off
if "%1"=="--version" (
  echo 10.15.0
  exit /b 0
)
exit /b 7
"@ | Set-Content (Join-Path $fixtureDirectory "pnpm.cmd") -Encoding Ascii

    $cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
    $processEnvironmentPath = "$fixtureDirectory;$cargoBin;$env:PATH"
    $command = "& { `$env:PATH = '$processEnvironmentPath'; & '$repositoryRoot\init.ps1' }"
    $powerShellHost = (Get-Process -Id $PID).Path

    $process = Start-Process `
        -FilePath $powerShellHost `
        -ArgumentList "-NoProfile", "-Command", $command `
        -Wait `
        -PassThru `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath

    $output = (Get-Content $stdoutPath, $stderrPath -ErrorAction SilentlyContinue) -join [Environment]::NewLine

    if ($process.ExitCode -eq 0) {
        throw "Expected init.ps1 to fail when pnpm install exits with code 7. Output: $output"
    }

    if ($output -notmatch "pnpm install failed with\s+exit code 7") {
        throw "Expected an actionable pnpm failure message. Output: $output"
    }

    Write-Host "init.ps1 native-command failure test passed."
}
finally {
    if (Test-Path $fixtureDirectory) {
        [System.IO.Directory]::Delete($fixtureDirectory, $true)
    }
}
