$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repositoryRoot = Split-Path $PSScriptRoot -Parent
Import-Module (Join-Path $repositoryRoot "scripts\production-tools.psm1") -Force
$fixtureRoot = Join-Path $repositoryRoot "tests\.production-tools-$([guid]::NewGuid())"
$originalPublish = $env:PRESHOT_PUBLISH
$originalSignCertificateSha1 = $env:PRESHOT_SIGN_CERT_SHA1
$originalInstallerVerifyScript = $env:PRESHOT_INSTALLER_VERIFY_SCRIPT
$originalHookResultPath = $env:PRESHOT_HOOK_RESULT_PATH

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) {
        throw $Message
    }
}

function Assert-Throws {
    param([scriptblock]$Action, [string]$Pattern)
    try {
        & $Action
    }
    catch {
        if ($_.Exception.Message -notmatch $Pattern) {
            throw "Expected error matching '$Pattern', got '$($_.Exception.Message)'."
        }
        return
    }
    throw "Expected action to fail with '$Pattern'."
}

function New-ReleaseFixture {
    param([string]$Version = "1.2.3")

    $root = Join-Path $fixtureRoot ([guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path (Join-Path $root "src-tauri\src") -Force | Out-Null
    @"
{
  "name": "preshot",
  "version": "$Version"
}
"@ | Set-Content (Join-Path $root "package.json") -Encoding UTF8
    @"
[package]
name = "preshot"
version = "$Version"
edition = "2021"
"@ | Set-Content (Join-Path $root "src-tauri\Cargo.toml") -Encoding UTF8
    "pub fn fixture() {}" | Set-Content (Join-Path $root "src-tauri\src\lib.rs") -Encoding UTF8
    @"
version = 4

[[package]]
name = "preshot"
version = "$Version"
"@ | Set-Content (Join-Path $root "src-tauri\Cargo.lock") -Encoding UTF8
    @"
{
  "productName": "Preshot",
  "version": "$Version",
  "bundle": {
    "targets": ["msi"],
    "windows": {
      "wix": {
        "language": ["en-US"],
        "upgradeCode": "493c5fb5-639d-4fba-94d3-aebe4eb0dce6"
      }
    }
  }
}
"@ | Set-Content (Join-Path $root "src-tauri\tauri.conf.json") -Encoding UTF8
    return $root
}

try {
    Remove-Item Env:PRESHOT_PUBLISH -ErrorAction SilentlyContinue
    Remove-Item Env:PRESHOT_SIGN_CERT_SHA1 -ErrorAction SilentlyContinue
    Remove-Item Env:PRESHOT_INSTALLER_VERIFY_SCRIPT -ErrorAction SilentlyContinue
    Remove-Item Env:PRESHOT_HOOK_RESULT_PATH -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $fixtureRoot -Force | Out-Null

    Assert-ReleaseVersion "1.2.3"
    Assert-ReleaseVersion "255.255.65535"
    Assert-Throws { Assert-ReleaseVersion "1.2.3.4" } "fourth field"
    Assert-Throws { Assert-ReleaseVersion "256.0.0" } "MSI limits"
    Assert-Throws { Assert-ReleaseVersion "999999999999999999999.0.0" } "numeric limits"
    Assert-Throws { Assert-ReleaseVersion "1.2.3-beta.1" } "invalid"

    $failureCommand = Join-Path $fixtureRoot "failure.cmd"
    "@echo off`r`nexit /b 7`r`n" | Set-Content $failureCommand -Encoding Ascii
    Assert-Throws {
        Invoke-CheckedNative -FilePath $failureCommand -Description "Mocked command"
    } "Mocked command failed with exit code 7"

    $versionRoot = New-ReleaseFixture
    $cargoUpdater = {
        param($Root, $Version)
        $lockPath = Join-Path $Root "src-tauri\Cargo.lock"
        $content = [System.IO.File]::ReadAllText($lockPath)
        [System.IO.File]::WriteAllText($lockPath, ($content -replace 'version = "1\.2\.3"', "version = `"$Version`""))
    }
    $changed = Set-ReleaseVersionFiles -RepositoryRoot $versionRoot -Version "2.3.4" -CargoMetadataInvoker $cargoUpdater
    Assert-True $changed "Expected version update to report a change."
    $updatedConfiguration = Get-ReleaseConfiguration $versionRoot
    Assert-True ($updatedConfiguration.Version -eq "2.3.4") "Version files were not synchronized."
    Assert-True (-not (Set-ReleaseVersionFiles -RepositoryRoot $versionRoot -Version "2.3.4" -CargoMetadataInvoker $cargoUpdater)) "Local same-version update should be a no-op."
    Assert-Throws {
        Set-ReleaseVersionFiles -RepositoryRoot $versionRoot -Version "2.3.4" -Publish -CargoMetadataInvoker $cargoUpdater
    } "same-version/no-op"

    $historicalVersionRoot = New-ReleaseFixture -Version "0.0.1"
    $historicalVersionConfiguration = Get-ReleaseConfiguration $historicalVersionRoot
    Assert-Throws {
        Assert-ReleasePublicationPolicy $historicalVersionConfiguration -Publish
    } "requires version '0.0.2' or newer"
    Assert-Throws {
        Set-ReleaseVersionFiles `
            -RepositoryRoot $historicalVersionRoot `
            -Version "0.0.1" `
            -Publish `
            -CargoMetadataInvoker $cargoUpdater
    } "requires version '0.0.2' or newer"

    $defaultCargoRoot = New-ReleaseFixture
    Assert-True (
        Set-ReleaseVersionFiles -RepositoryRoot $defaultCargoRoot -Version "2.3.4"
    ) "Expected the default Cargo lockfile updater to report a change."
    $defaultCargoConfiguration = Get-ReleaseConfiguration $defaultCargoRoot
    Assert-True (
        $defaultCargoConfiguration.Version -eq "2.3.4"
    ) "The default Cargo lockfile updater did not synchronize Cargo.lock."

    $artifactRoot = New-ReleaseFixture
    $configuration = Get-ReleaseConfiguration $artifactRoot
    New-Item -ItemType Directory -Path $configuration.BundleDirectory -Force | Out-Null
    "release-exe" | Set-Content $configuration.ExecutablePath -Encoding Ascii
    "msi-bytes" | Set-Content $configuration.MsiPath -Encoding Ascii
    $metadataReader = {
        param($Path)
        [pscustomobject]@{
            ProductName = "Preshot"
            ProductVersion = "1.2.3"
            Architecture = "x64"
            UpgradeCode = "493C5FB5-639D-4FBA-94D3-AEBE4EB0DCE6"
            LegacyUpgradeCode = "97EE9B44-6313-52EB-A67E-A1334832EB86"
            LegacyVersionMin = "0.0.0"
            LegacyVersionMax = "255.255.65535"
            LegacyUpgradeAttributes = 2
            LegacyActionProperty = "LEGACY_MACHINE_PRESHOT_FOUND"
            LegacyLaunchCondition = "Installed OR NOT LEGACY_MACHINE_PRESHOT_FOUND"
            LegacyLaunchConditionMessage = "Uninstall the machine-wide Preshot package first."
        }
    }
    $runtimeContract = [pscustomobject]@{
        Features = @(
            [pscustomobject]@{ Feature = "MainProgram"; Parent = ""; Attributes = "24" },
            [pscustomobject]@{ Feature = "Environment"; Parent = "MainProgram"; Attributes = "0" }
        )
        FeatureComponents = @(
            [pscustomobject]@{ Feature = "MainProgram"; Component = "RegistryEntries" },
            [pscustomobject]@{ Feature = "MainProgram"; Component = "Path" },
            [pscustomobject]@{ Feature = "MainProgram"; Component = "RequiredSidecar" },
            [pscustomobject]@{ Feature = "Environment"; Component = "PathEnvironment" }
        )
        Files = @(
            [pscustomobject]@{ File = "Path"; Component = "Path" },
            [pscustomobject]@{ File = "Bin_RequiredSidecar"; Component = "RequiredSidecar" }
        )
        CustomActions = @(
            [pscustomobject]@{
                Action = "DownloadAndInvokeBootstrapper"
                Type = "1058"
                Source = "PreshotInstallDir"
                Target = "`$ErrorActionPreference = 'Stop'; Start-Process bootstrapper -PassThru -Wait; if (`$process.ExitCode -notin @(0, 1641, 3010)) { exit `$process.ExitCode }"
            },
            [pscustomobject]@{
                Action = "InvokeBootstrapper"
                Type = "1058"
                Source = "PreshotInstallDir"
                Target = "`$ErrorActionPreference = 'Stop'; Start-Process embedded -PassThru -Wait; if (`$process.ExitCode -notin @(0, 1641, 3010)) { exit `$process.ExitCode }"
            }
        )
        Shortcuts = @(
            [pscustomobject]@{ Shortcut = "ApplicationStartMenuShortcut"; Target = "[!Path]" },
            [pscustomobject]@{ Shortcut = "ApplicationDesktopShortcut"; Target = "[!Path]" }
        )
    }
    Assert-MsiRuntimeContracts $runtimeContract
    $runtimeContractReader = { param($Path) $runtimeContract }
    $artifacts = Assert-ReleaseArtifacts `
        $configuration `
        -MetadataReader $metadataReader `
        -RuntimeContractReader $runtimeContractReader
    Assert-True ($artifacts.Msi.FullName -ceq $configuration.MsiPath) "MSI path verification failed."

    $environmentOwnsExecutable = $runtimeContract | Select-Object *
    $environmentOwnsExecutable.FeatureComponents = @(
        $runtimeContract.FeatureComponents +
        [pscustomobject]@{ Feature = "Environment"; Component = "Path" }
    )
    Assert-Throws {
        Assert-MsiRuntimeContracts $environmentOwnsExecutable
    } "must not own the Path executable"

    $uncheckedBootstrapper = $runtimeContract | Select-Object *
    $uncheckedBootstrapper.CustomActions = @(
        [pscustomobject]@{
            Action = "DownloadAndInvokeBootstrapper"
            Type = "1058"
            Source = "PreshotInstallDir"
            Target = "Start-Process bootstrapper -Wait"
        }
    )
    Assert-Throws {
        Assert-MsiRuntimeContracts $uncheckedBootstrapper
    } "does not propagate WebView2 failures"

    $nonBreakingSpace = [char]0x00A0
    $ideographicSpace = [char]0x3000
    $whitespaceMetadataReader = {
        param($Path)
        [pscustomobject]@{
            ProductName = "$nonBreakingSpace" + "Preshot" + "$ideographicSpace"
            ProductVersion = " `r`n1.2.3 `r`n"
            Architecture = "`t x64 `r`n"
            UpgradeCode = " {493c5fb5-639d-4fba-94d3-aebe4eb0dce6} "
            LegacyUpgradeCode = " {97ee9b44-6313-52eb-a67e-a1334832eb86} "
            LegacyVersionMin = " 0.0.0 "
            LegacyVersionMax = " 255.255.65535 "
            LegacyUpgradeAttributes = 2
            LegacyActionProperty = " LEGACY_MACHINE_PRESHOT_FOUND "
            LegacyLaunchCondition = " Installed OR NOT LEGACY_MACHINE_PRESHOT_FOUND "
            LegacyLaunchConditionMessage = " Uninstall the machine-wide Preshot package first. "
        }
    }
    $normalizedArtifacts = Assert-ReleaseArtifacts $configuration -MetadataReader $whitespaceMetadataReader
    Assert-True ($normalizedArtifacts.MsiMetadata.ProductVersion -ceq "1.2.3") "MSI ProductVersion whitespace/CRLF was not normalized."
    Assert-True ($normalizedArtifacts.MsiMetadata.ProductName -ceq "Preshot") "Localized Unicode whitespace around ProductName was not normalized."

    $localizedVersionOutput = `
        ([char]0x4EA7).ToString() + `
        ([char]0x54C1).ToString() + `
        ([char]0x7248).ToString() + `
        ([char]0x672C).ToString() + `
        ([char]0xFF1A).ToString() + `
        "1.2.3"
    $localizedLabelReader = {
        param($Path)
        [pscustomobject]@{
            ProductName = "Preshot"
            ProductVersion = $localizedVersionOutput
            Architecture = "x64"
        }
    }
    Assert-Throws {
        Assert-ReleaseArtifacts $configuration -MetadataReader $localizedLabelReader
    } "invalid"

    $mismatchedVersionReader = {
        param($Path)
        [pscustomobject]@{
            ProductName = "Preshot"
            ProductVersion = " `r`n1.2.4`r`n "
            Architecture = "x64"
        }
    }
    Assert-Throws {
        Assert-ReleaseArtifacts $configuration -MetadataReader $mismatchedVersionReader
    } "MSI version '1.2.4' does not match release version '1.2.3'"

    $unsignedReader = {
        param($Path)
        [pscustomobject]@{ Status = "NotSigned"; SignerCertificate = $null }
    }
    $unsigned = Get-ReleaseSigningState -Paths @($configuration.ExecutablePath, $configuration.MsiPath) -SignatureReader $unsignedReader
    Assert-True (($unsigned.State -eq "unsigned") -and (-not $unsigned.Signed) -and (-not $unsigned.Publishable)) "Unsigned local artifacts must be non-publishable."
    Assert-Throws {
        Get-ReleaseSigningState -Paths @($configuration.ExecutablePath, $configuration.MsiPath) -Publish -SignatureReader $unsignedReader
    } "requires valid Authenticode signatures"

    $signedReader = {
        param($Path)
        [pscustomobject]@{
            Status = "Valid"
            SignerCertificate = [pscustomobject]@{ Subject = "CN=Preshot Test"; Thumbprint = "1234" }
        }
    }
    $signed = Get-ReleaseSigningState -Paths @($configuration.ExecutablePath, $configuration.MsiPath) -Publish -SignatureReader $signedReader
    Assert-True (($signed.State -eq "signed") -and $signed.Publishable) "Valid signatures must be publishable."

    $expectedThumbprint = "A1B2C3D4E5F60718293A4B5C6D7E8F9012345678"
    $otherThumbprint = "00112233445566778899AABBCCDDEEFF00112233"
    $env:PRESHOT_SIGN_CERT_SHA1 = " a1 b2 c3 d4 e5 f6 07 18 29 3a 4b 5c 6d 7e 8f 90 12 34 56 78 "
    $normalizedExpectedSignerReader = {
        param($Path)
        $thumbprint = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"
        if ($Path -like "*.msi") {
            $thumbprint = " A1B2C3D4 E5F60718 293A4B5C 6D7E8F90 12345678 `r`n"
        }
        [pscustomobject]@{
            Status = " valid `r`n"
            SignerCertificate = [pscustomobject]@{
                Subject = " CN=Preshot Release `r`n"
                Thumbprint = $thumbprint
            }
        }
    }
    $expectedSigner = Get-ReleaseSigningState `
        -Paths @($configuration.ExecutablePath, $configuration.MsiPath) `
        -Publish `
        -SignatureReader $normalizedExpectedSignerReader
    Assert-True (
        $expectedSigner.Publishable -and
        (@($expectedSigner.Files | Where-Object Thumbprint -ne $expectedThumbprint).Count -eq 0)
    ) "Expected signer matching must normalize status, whitespace, and thumbprint case."

    Remove-Item Env:PRESHOT_SIGN_CERT_SHA1
    $mismatchedSignerReader = {
        param($Path)
        $thumbprint = $expectedThumbprint
        if ($Path -like "*.msi") {
            $thumbprint = $otherThumbprint
        }
        [pscustomobject]@{
            Status = "Valid"
            SignerCertificate = [pscustomobject]@{ Subject = "CN=Valid"; Thumbprint = $thumbprint }
        }
    }
    Assert-Throws {
        Get-ReleaseSigningState `
            -Paths @($configuration.ExecutablePath, $configuration.MsiPath) `
            -Publish `
            -SignatureReader $mismatchedSignerReader
    } "signer thumbprints must match each other"

    $env:PRESHOT_SIGN_CERT_SHA1 = $expectedThumbprint.ToLowerInvariant()
    $otherValidSignerReader = {
        param($Path)
        [pscustomobject]@{
            Status = "Valid"
            SignerCertificate = [pscustomobject]@{
                Subject = "CN=Other Valid Signer"
                Thumbprint = $otherThumbprint
            }
        }
    }
    Assert-Throws {
        Get-ReleaseSigningState `
            -Paths @($configuration.ExecutablePath, $configuration.MsiPath) `
            -Publish `
            -SignatureReader $otherValidSignerReader
    } "does not match configured signer"

    $missingExpectedSignerVerifier = {
        param($Path)
        [pscustomobject]@{ ExitCode = 0; Output = "Successfully verified: $Path" }
    }
    Assert-Throws {
        Get-ReleaseSigningState `
            -Paths @($configuration.ExecutablePath, $configuration.MsiPath) `
            -Publish `
            -SigntoolVerifier $missingExpectedSignerVerifier
    } "did not report a signer thumbprint"

    $expectedSigntoolVerifier = {
        param($Path)
        [pscustomobject]@{
            ExitCode = 0
            Output = @"
Successfully verified: $Path
    SHA1 hash: a1 b2 c3 d4 e5 f6 07 18 29 3a 4b 5c 6d 7e 8f 90 12 34 56 78
"@
        }
    }
    $signtoolExpectedSigner = Get-ReleaseSigningState `
        -Paths @($configuration.ExecutablePath, $configuration.MsiPath) `
        -Publish `
        -SigntoolVerifier $expectedSigntoolVerifier
    Assert-True (
        $signtoolExpectedSigner.Publishable -and
        ($signtoolExpectedSigner.VerificationSource -eq "signtool") -and
        (@($signtoolExpectedSigner.Files | Where-Object Thumbprint -ne $expectedThumbprint).Count -eq 0)
    ) "signtool signer output must support normalized expected-thumbprint validation."

    Remove-Item Env:PRESHOT_SIGN_CERT_SHA1
    $mixedReader = {
        param($Path)
        if ($Path -like "*.exe") {
            return [pscustomobject]@{
                Status = "Valid"
                SignerCertificate = [pscustomobject]@{ Subject = "CN=Preshot Test"; Thumbprint = "1234" }
            }
        }
        return [pscustomobject]@{ Status = "NotSigned"; SignerCertificate = $null }
    }
    $partial = Get-ReleaseSigningState -Paths @($configuration.ExecutablePath, $configuration.MsiPath) -SignatureReader $mixedReader
    Assert-True (($partial.State -eq "partial") -and (-not $partial.Publishable)) "Partially signed local artifacts must be non-publishable."
    Assert-Throws {
        Get-ReleaseSigningState -Paths @($configuration.ExecutablePath, $configuration.MsiPath) -Publish -SignatureReader $mixedReader
    } "requires valid Authenticode signatures"
    $invalidSignatureReader = {
        param($Path)
        [pscustomobject]@{
            Status = "HashMismatch"
            SignerCertificate = [pscustomobject]@{ Subject = "CN=Invalid"; Thumbprint = "bad" }
        }
    }
    Assert-Throws {
        Get-ReleaseSigningState -Paths @($configuration.ExecutablePath, $configuration.MsiPath) -SignatureReader $invalidSignatureReader
    } "signature verification failed"
    $unknownSignatureReader = {
        param($Path)
        [pscustomobject]@{ Status = "UnknownError"; SignerCertificate = $null }
    }
    Assert-Throws {
        Get-ReleaseSigningState -Paths @($configuration.ExecutablePath, $configuration.MsiPath) -SignatureReader $unknownSignatureReader
    } "signature verification failed"

    $unavailablePowerShellReader = {
        param($Path)
        throw [System.Management.Automation.CommandNotFoundException]::new(
            "The Get-AuthenticodeSignature module could not be loaded."
        )
    }
    $unverifiedLocal = Get-ReleaseSigningState `
        -Paths @($configuration.ExecutablePath, $configuration.MsiPath) `
        -SignatureReader $unavailablePowerShellReader
    Assert-True (
        ($unverifiedLocal.State -eq "unsigned") -and
        (-not $unverifiedLocal.Signed) -and
        (-not $unverifiedLocal.Publishable) -and
        (-not $unverifiedLocal.VerificationAvailable)
    ) "Unavailable PowerShell signature tooling must allow a non-publishable local result."
    Assert-Throws {
        Get-ReleaseSigningState `
            -Paths @($configuration.ExecutablePath, $configuration.MsiPath) `
            -Publish `
            -SignatureReader $unavailablePowerShellReader
    } "requires signature verification"

    $validSigntoolVerifier = {
        param($Path)
        [pscustomobject]@{ ExitCode = 0; Output = "Firma comprobada" }
    }
    $signtoolSigned = Get-ReleaseSigningState `
        -Paths @($configuration.ExecutablePath, $configuration.MsiPath) `
        -Publish `
        -SignatureReader $unavailablePowerShellReader `
        -SigntoolVerifier $validSigntoolVerifier
    Assert-True (
        $signtoolSigned.Signed -and
        $signtoolSigned.Publishable -and
        ($signtoolSigned.VerificationSource -eq "signtool")
    ) "A configured valid signtool result must take precedence over unavailable PowerShell tooling."

    $invalidSigntoolVerifier = {
        param($Path)
        [pscustomobject]@{ ExitCode = 1; Output = "La firma no es válida" }
    }
    Assert-Throws {
        Get-ReleaseSigningState `
            -Paths @($configuration.ExecutablePath, $configuration.MsiPath) `
            -SigntoolVerifier $invalidSigntoolVerifier
    } "signtool signature verification failed"

    $env:SOURCE_DATE_EPOCH = "1700000000"
    $contentA = Get-ReleaseMetadataContent $configuration $artifacts $unsigned
    $contentB = Get-ReleaseMetadataContent $configuration $artifacts $unsigned
    Assert-True ($contentA.Manifest -ceq $contentB.Manifest) "Release manifest must be deterministic."
    Assert-True ($contentA.Manifest -match '"timestampStrategy"\s*:\s*"source-date-epoch"') "Manifest timestamp strategy was not recorded."
    $manifest = $contentA.Manifest | ConvertFrom-Json
    Assert-True ($manifest.schemaVersion -eq 2) "Release manifest schema must include installer lineage publication policy."
    Assert-True ($manifest.installer.scope -eq "perUser") "Release manifest must identify the per-user installer scope."
    Assert-True (
        $manifest.installer.upgradeCode -eq "493C5FB5-639D-4FBA-94D3-AEBE4EB0DCE6"
    ) "Release manifest must record the per-user UpgradeCode."
    Assert-True (
        $manifest.installer.historicalPerMachine.upgradeCode -eq "97EE9B44-6313-52EB-A67E-A1334832EB86"
    ) "Release manifest must record the historical per-machine UpgradeCode."
    Assert-True (
        (-not $manifest.publication.publishable) -and
        ($manifest.publication.blockers -contains "authenticode-signatures-required")
    ) "Unsigned release metadata must expose its publication blocker."

    $historicalSignedPublication = Get-ReleasePublicationState `
        -Configuration $historicalVersionConfiguration `
        -Signing $signed
    Assert-True (
        (-not $historicalSignedPublication.Publishable) -and
        ($historicalSignedPublication.Blockers -contains "version-must-exceed-historical-per-machine-0.0.1")
    ) "A signed same-version 0.0.1 per-user artifact must remain non-publishable."

    Write-ReleaseMetadata $configuration $artifacts $unsigned
    Assert-ReleaseMetadata $configuration $artifacts $unsigned
    Assert-True ((Get-Content $configuration.ChecksumPath -Raw) -match '^[0-9a-f]{64}  Preshot_1\.2\.3_x64_en-US\.msi') "Checksum file format is invalid."
    Add-Content $configuration.ChecksumPath "tampered"
    Assert-Throws {
        Assert-ReleaseMetadata $configuration $artifacts $unsigned
    } "checksum does not match"
    Write-ReleaseMetadata $configuration $artifacts $unsigned

    $stalePath = Join-Path $configuration.BundleDirectory "Preshot_1.2.2_x64_en-US.msi"
    "stale" | Set-Content $stalePath -Encoding Ascii
    $staleReader = {
        param($Path)
        $version = "1.2.3"
        if ((Split-Path $Path -Leaf) -match "1\.2\.2") {
            $version = "1.2.2"
        }
        [pscustomobject]@{ ProductName = "Preshot"; ProductVersion = $version; Architecture = "x64" }
    }
    Remove-StaleProductMsis $configuration -MetadataReader $staleReader
    Assert-True (-not (Test-Path $stalePath)) "Exactly named stale same-product MSI was not removed."
    Assert-True (-not (Test-Path $configuration.MsiPath)) "Current same-product MSI was not cleaned before rebuild."

    $unsafePath = Join-Path $configuration.BundleDirectory "renamed-installer.msi"
    "unsafe" | Set-Content $unsafePath -Encoding Ascii
    Assert-Throws {
        Remove-StaleProductMsis $configuration -MetadataReader $metadataReader
    } "Refusing to remove same-product MSI"
    Assert-True (Test-Path $unsafePath) "Unexpectedly named MSI must never be deleted."

    $env:PRESHOT_PUBLISH = "1"
    Assert-True (Test-PublishingMode) "PRESHOT_PUBLISH=1 must enable publishing mode."
    Remove-Item Env:PRESHOT_PUBLISH
    Assert-True (-not (Test-PublishingMode)) "Publishing mode must be disabled without a switch or environment opt-in."

    $hookRoot = Join-Path $fixtureRoot "installer hook paths with spaces"
    New-Item -ItemType Directory -Path $hookRoot -Force | Out-Null
    $hookMsiPath = Join-Path $hookRoot "Preshot installer with spaces.msi"
    $hookManifestPath = Join-Path $hookRoot "Preshot release manifest with spaces.json"
    $hookResultPath = Join-Path $hookRoot "hook invocation result.json"
    "msi" | Set-Content -LiteralPath $hookMsiPath -Encoding Ascii
    "{}" | Set-Content -LiteralPath $hookManifestPath -Encoding Ascii
    $hookConfiguration = [pscustomobject]@{
        MsiPath = $hookMsiPath
        ManifestPath = $hookManifestPath
    }
    $hookPath = Join-Path $hookRoot "installer validation hook.ps1"
    @'
param(
    [Parameter(Mandatory)][string]$MsiPath,
    [Parameter(Mandatory)][string]$ManifestPath,
    [switch]$Publish
)

[ordered]@{
    MsiPath = $MsiPath
    ManifestPath = $ManifestPath
    PublishBound = $PSBoundParameters.ContainsKey("Publish")
    Publish = [bool]$Publish
} | ConvertTo-Json -Compress | Set-Content -LiteralPath $env:PRESHOT_HOOK_RESULT_PATH -Encoding UTF8
'@ | Set-Content -LiteralPath $hookPath -Encoding UTF8
    $env:PRESHOT_INSTALLER_VERIFY_SCRIPT = $hookPath
    $env:PRESHOT_HOOK_RESULT_PATH = $hookResultPath

    Invoke-InstallerValidationHook $hookConfiguration -Publish:$false
    $localHookResult = Get-Content -LiteralPath $hookResultPath -Raw | ConvertFrom-Json
    Assert-True (-not $localHookResult.PublishBound) "Local hook invocation must omit the Publish switch."
    Assert-True (-not $localHookResult.Publish) "Local hook invocation must leave Publish false."
    Assert-True ($localHookResult.MsiPath -ceq $hookMsiPath) "Hook MSI paths containing spaces must be preserved."
    Assert-True ($localHookResult.ManifestPath -ceq $hookManifestPath) "Hook manifest paths containing spaces must be preserved."

    Invoke-InstallerValidationHook $hookConfiguration -Publish
    $publishHookResult = Get-Content -LiteralPath $hookResultPath -Raw | ConvertFrom-Json
    Assert-True $publishHookResult.PublishBound "Publish hook invocation must bind the Publish switch."
    Assert-True $publishHookResult.Publish "Publish hook invocation must receive Publish=true."

    $failingHookPath = Join-Path $hookRoot "failing validation hook.ps1"
    "param([string]`$MsiPath, [string]`$ManifestPath, [switch]`$Publish)`r`nexit 9`r`n" |
        Set-Content -LiteralPath $failingHookPath -Encoding UTF8
    $env:PRESHOT_INSTALLER_VERIFY_SCRIPT = $failingHookPath
    Assert-Throws {
        Invoke-InstallerValidationHook $hookConfiguration -Publish
    } "Installer validation hook failed with exit code 9"

    $invalidStdout = Join-Path $fixtureRoot "invalid-version.stdout.log"
    $invalidStderr = Join-Path $fixtureRoot "invalid-version.stderr.log"
    $process = Start-Process `
        -FilePath (Get-Process -Id $PID).Path `
        -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $repositoryRoot "scripts\release-set-version.ps1"), "1.2.3.4" `
        -Wait `
        -PassThru `
        -RedirectStandardOutput $invalidStdout `
        -RedirectStandardError $invalidStderr
    Assert-True ($process.ExitCode -ne 0) "Invalid release version script invocation must return a non-zero exit code."

    Write-Host "Production tooling tests passed." -ForegroundColor Green
}
finally {
    Remove-Item Env:SOURCE_DATE_EPOCH -ErrorAction SilentlyContinue
    if ($null -eq $originalPublish) {
        Remove-Item Env:PRESHOT_PUBLISH -ErrorAction SilentlyContinue
    }
    else {
        $env:PRESHOT_PUBLISH = $originalPublish
    }
    if ($null -eq $originalSignCertificateSha1) {
        Remove-Item Env:PRESHOT_SIGN_CERT_SHA1 -ErrorAction SilentlyContinue
    }
    else {
        $env:PRESHOT_SIGN_CERT_SHA1 = $originalSignCertificateSha1
    }
    if ($null -eq $originalInstallerVerifyScript) {
        Remove-Item Env:PRESHOT_INSTALLER_VERIFY_SCRIPT -ErrorAction SilentlyContinue
    }
    else {
        $env:PRESHOT_INSTALLER_VERIFY_SCRIPT = $originalInstallerVerifyScript
    }
    if ($null -eq $originalHookResultPath) {
        Remove-Item Env:PRESHOT_HOOK_RESULT_PATH -ErrorAction SilentlyContinue
    }
    else {
        $env:PRESHOT_HOOK_RESULT_PATH = $originalHookResultPath
    }
    if (Test-Path $fixtureRoot) {
        [System.IO.Directory]::Delete($fixtureRoot, $true)
    }
}
