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

    @"
@echo off
echo v20.18.0
exit /b 0
"@ | Set-Content (Join-Path $fixtureDirectory "node.cmd") -Encoding Ascii

    $nodeStdoutPath = Join-Path $fixtureDirectory "node-stdout.log"
    $nodeStderrPath = Join-Path $fixtureDirectory "node-stderr.log"
    $nodeProcess = Start-Process `
        -FilePath $powerShellHost `
        -ArgumentList "-NoProfile", "-Command", $command `
        -Wait `
        -PassThru `
        -RedirectStandardOutput $nodeStdoutPath `
        -RedirectStandardError $nodeStderrPath

    $nodeOutput = (Get-Content $nodeStdoutPath, $nodeStderrPath -ErrorAction SilentlyContinue) -join [Environment]::NewLine

    if ($nodeProcess.ExitCode -eq 0) {
        throw "Expected init.ps1 to reject Node.js v20.18.0. Output: $nodeOutput"
    }

    if ($nodeOutput -notmatch "Node.js v20.18.0 is\s+unsupported") {
        throw "Expected an actionable Node.js version message. Output: $nodeOutput"
    }

    Write-Host "init.ps1 Node.js version boundary test passed."

    @"
@echo off
echo v20.19.0
exit /b 0
"@ | Set-Content (Join-Path $fixtureDirectory "node.cmd") -Encoding Ascii

    $acceptedStdoutPath = Join-Path $fixtureDirectory "accepted-stdout.log"
    $acceptedStderrPath = Join-Path $fixtureDirectory "accepted-stderr.log"
    $acceptedProcess = Start-Process `
        -FilePath $powerShellHost `
        -ArgumentList "-NoProfile", "-Command", $command `
        -Wait `
        -PassThru `
        -RedirectStandardOutput $acceptedStdoutPath `
        -RedirectStandardError $acceptedStderrPath

    $acceptedOutput = (Get-Content $acceptedStdoutPath, $acceptedStderrPath -ErrorAction SilentlyContinue) -join [Environment]::NewLine

    if ($acceptedProcess.ExitCode -eq 0) {
        throw "Expected the pnpm fixture to fail after Node.js v20.19.0 was accepted. Output: $acceptedOutput"
    }

    if ($acceptedOutput -notmatch "pnpm install failed with\s+exit code 7") {
        throw "Expected Node.js v20.19.0 to pass version validation. Output: $acceptedOutput"
    }

    Write-Host "init.ps1 accepted Node.js boundary test passed."
}
finally {
    if (Test-Path $fixtureDirectory) {
        [System.IO.Directory]::Delete($fixtureDirectory, $true)
    }
}
