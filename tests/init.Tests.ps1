$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repositoryRoot = Split-Path $PSScriptRoot -Parent
$fixtureDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "preshot-init-$([guid]::NewGuid())"
$stdoutPath = Join-Path $fixtureDirectory "stdout.log"
$stderrPath = Join-Path $fixtureDirectory "stderr.log"

function Wait-InitializerFixture {
    param([Parameter(Mandatory)][System.Diagnostics.Process]$Process)
    # Start-Process -Wait waits for a job's descendants, which can remain
    # attached to an automation host after the initializer itself has exited.
    $null = $Process.Handle
    if (-not $Process.WaitForExit(60000)) {
        $Process.Kill()
        throw "Initializer fixture exceeded 60 seconds. Inspect $fixtureDirectory."
    }
    $Process.WaitForExit()
}

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

    $process = Start-Process -WindowStyle Hidden `
        -FilePath $powerShellHost `
        -ArgumentList "-NoProfile", "-Command", $command `
        -PassThru `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath

    Wait-InitializerFixture $process

    $output = (Get-Content $stdoutPath, $stderrPath -ErrorAction SilentlyContinue) -join [Environment]::NewLine

    if ($process.ExitCode -eq 0) {
        throw "Expected init.ps1 to fail when pnpm install exits with code 7. Output: $output"
    }

    if ($output -notmatch "pnpm\s+install\s+failed\s+with\s+exit\s+code\s+7") {
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
    $nodeProcess = Start-Process -WindowStyle Hidden `
        -FilePath $powerShellHost `
        -ArgumentList "-NoProfile", "-Command", $command `
        -PassThru `
        -RedirectStandardOutput $nodeStdoutPath `
        -RedirectStandardError $nodeStderrPath

    Wait-InitializerFixture $nodeProcess

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
    $acceptedProcess = Start-Process -WindowStyle Hidden `
        -FilePath $powerShellHost `
        -ArgumentList "-NoProfile", "-Command", $command `
        -PassThru `
        -RedirectStandardOutput $acceptedStdoutPath `
        -RedirectStandardError $acceptedStderrPath

    Wait-InitializerFixture $acceptedProcess

    $acceptedOutput = (Get-Content $acceptedStdoutPath, $acceptedStderrPath -ErrorAction SilentlyContinue) -join [Environment]::NewLine

    if ($acceptedProcess.ExitCode -eq 0) {
        throw "Expected the pnpm fixture to fail after Node.js v20.19.0 was accepted. Output: $acceptedOutput"
    }

    if ($acceptedOutput -notmatch "pnpm\s+install\s+failed\s+with\s+exit\s+code\s+7") {
        throw "Expected Node.js v20.19.0 to pass version validation. Output: $acceptedOutput"
    }

    Write-Host "init.ps1 accepted Node.js boundary test passed."

    @"
@echo off
echo v23.0.0
exit /b 0
"@ | Set-Content (Join-Path $fixtureDirectory "node.cmd") -Encoding Ascii

    $newerStdoutPath = Join-Path $fixtureDirectory "newer-stdout.log"
    $newerStderrPath = Join-Path $fixtureDirectory "newer-stderr.log"
    $newerProcess = Start-Process -WindowStyle Hidden `
        -FilePath $powerShellHost `
        -ArgumentList "-NoProfile", "-Command", $command `
        -PassThru `
        -RedirectStandardOutput $newerStdoutPath `
        -RedirectStandardError $newerStderrPath

    Wait-InitializerFixture $newerProcess

    $newerOutput = (Get-Content $newerStdoutPath, $newerStderrPath -ErrorAction SilentlyContinue) -join [Environment]::NewLine

    if ($newerProcess.ExitCode -eq 0) {
        throw "Expected the pnpm fixture to fail after Node.js v23.0.0 was accepted. Output: $newerOutput"
    }

    if ($newerOutput -notmatch "pnpm\s+install\s+failed\s+with\s+exit\s+code\s+7") {
        throw "Expected Node.js v23.0.0 to pass version validation. Output: $newerOutput"
    }

    Write-Host "init.ps1 newer Node.js version test passed."
}
finally {
    if (Test-Path $fixtureDirectory) {
        [System.IO.Directory]::Delete($fixtureDirectory, $true)
    }
}
