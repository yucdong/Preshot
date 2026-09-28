$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$script:ReleaseTarget = "x86_64-pc-windows-msvc"
$script:PerUserUpgradeCode = "493C5FB5-639D-4FBA-94D3-AEBE4EB0DCE6"
$script:HistoricalPerMachineUpgradeCode = "97EE9B44-6313-52EB-A67E-A1334832EB86"
$script:HistoricalPerMachineVersion = "0.0.1"
$script:FirstPerUserPublishVersion = "0.0.2"
$script:LegacyMachineDetectionProperty = "LEGACY_MACHINE_PRESHOT_FOUND"

function Write-Utf8File {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Content
    )

    $temporaryPath = "$Path.$([guid]::NewGuid().ToString('N')).tmp"
    [System.IO.File]::WriteAllText(
        $temporaryPath,
        $Content,
        [System.Text.UTF8Encoding]::new($false)
    )
    Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
}

function Get-Sha256 {
    param([Parameter(Mandatory)][string]$Path)

    $stream = $null
    $algorithm = $null
    try {
        $stream = [System.IO.File]::OpenRead($Path)
        $algorithm = [System.Security.Cryptography.SHA256]::Create()
        return ([System.BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
    }
    finally {
        if ($null -ne $algorithm) {
            $algorithm.Dispose()
        }
        if ($null -ne $stream) {
            $stream.Dispose()
        }
    }
}

function Add-CargoToPath {
    $cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
    if ((Test-Path $cargoBin) -and ($env:PATH -notlike "*$cargoBin*")) {
        $env:PATH = "$cargoBin;$env:PATH"
    }
}

function Invoke-CheckedNative {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$Arguments = @(),
        [Parameter(Mandatory)][string]$Description
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Description failed with exit code $LASTEXITCODE."
    }
}

function Get-FirstMatch {
    param(
        [Parameter(Mandatory)][string]$Content,
        [Parameter(Mandatory)][string]$Pattern,
        [Parameter(Mandatory)][string]$Description
    )

    $match = [regex]::Match(
        $Content,
        $Pattern,
        [System.Text.RegularExpressions.RegexOptions]::Multiline
    )
    if (-not $match.Success) {
        throw "Unable to read $Description."
    }

    return $match.Groups[1].Value
}

function Assert-ReleaseVersion {
    param([Parameter(Mandatory)][string]$Version)

    $match = [regex]::Match($Version, "^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
    if (-not $match.Success) {
        throw "Release version '$Version' is invalid. Use exactly x.y.z; MSI versions do not support a fourth field, prerelease, or build metadata."
    }

    [uint64]$major = 0
    [uint64]$minor = 0
    [uint64]$patch = 0
    if (
        (-not [uint64]::TryParse($match.Groups[1].Value, [ref]$major)) -or
        (-not [uint64]::TryParse($match.Groups[2].Value, [ref]$minor)) -or
        (-not [uint64]::TryParse($match.Groups[3].Value, [ref]$patch))
    ) {
        throw "Release version '$Version' exceeds MSI numeric limits."
    }
    if (($major -gt 255) -or ($minor -gt 255) -or ($patch -gt 65535)) {
        throw "Release version '$Version' exceeds MSI limits: major/minor must be 0-255 and patch must be 0-65535."
    }
}

function Test-ReleaseVersionAtLeast {
    param(
        [Parameter(Mandatory)][string]$Version,
        [Parameter(Mandatory)][string]$Minimum
    )

    Assert-ReleaseVersion $Version
    Assert-ReleaseVersion $Minimum
    return ([version]$Version).CompareTo([version]$Minimum) -ge 0
}

function Get-ReleaseConfiguration {
    param([Parameter(Mandatory)][string]$RepositoryRoot)

    $root = (Resolve-Path $RepositoryRoot).Path
    $packagePath = Join-Path $root "package.json"
    $cargoPath = Join-Path $root "src-tauri\Cargo.toml"
    $cargoLockPath = Join-Path $root "src-tauri\Cargo.lock"
    $tauriPath = Join-Path $root "src-tauri\tauri.conf.json"

    $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
    $tauri = Get-Content -LiteralPath $tauriPath -Raw | ConvertFrom-Json
    $cargoContent = Get-Content -LiteralPath $cargoPath -Raw
    $cargoLockContent = Get-Content -LiteralPath $cargoLockPath -Raw
    $cargoVersion = Get-FirstMatch $cargoContent '^\[package\][\s\S]*?^version = "([^"]+)"' "Cargo.toml package version"
    $cargoLockVersion = Get-FirstMatch $cargoLockContent '\[\[package\]\]\s+name = "preshot"\s+version = "([^"]+)"' "Cargo.lock Preshot version"

    $versions = @(@(
            [string]$package.version,
            [string]$tauri.version,
            $cargoVersion,
            $cargoLockVersion
        ) | Select-Object -Unique)
    if ($versions.Count -ne 1) {
        throw "Release versions are not synchronized. package.json=$($package.version), tauri.conf.json=$($tauri.version), Cargo.toml=$cargoVersion, Cargo.lock=$cargoLockVersion."
    }

    $version = [string]$package.version
    Assert-ReleaseVersion $version
    $productName = [string]$tauri.productName
    if ([string]::IsNullOrWhiteSpace($productName)) {
        throw "src-tauri\tauri.conf.json must define productName."
    }

    $bundleTargets = @($tauri.bundle.targets)
    if (($bundleTargets.Count -ne 1) -or ($bundleTargets[0] -ne "msi")) {
        throw "src-tauri\tauri.conf.json must target exactly the MSI bundle for production releases."
    }

    $languageConfiguration = $tauri.bundle.windows.wix.language
    $languages = @()
    if ($languageConfiguration -is [string]) {
        $languages = @([string]$languageConfiguration)
    }
    elseif ($languageConfiguration -is [System.Array]) {
        $languages = @($languageConfiguration | ForEach-Object { [string]$_ })
    }
    elseif ($null -ne $languageConfiguration) {
        $languages = @($languageConfiguration.PSObject.Properties.Name)
    }
    if (($languages.Count -ne 1) -or ($languages[0] -ne "en-US")) {
        throw "Production packaging requires exactly one WiX language."
    }

    $upgradeCode = ([string]$tauri.bundle.windows.wix.upgradeCode).Trim().ToUpperInvariant()
    if ($upgradeCode -ne $script:PerUserUpgradeCode) {
        throw "src-tauri\tauri.conf.json must use the fixed per-user UpgradeCode '$script:PerUserUpgradeCode'."
    }
    if ($upgradeCode -eq $script:HistoricalPerMachineUpgradeCode) {
        throw "The per-user MSI must not reuse the historical per-machine UpgradeCode."
    }

    $releaseDirectory = Join-Path $root "src-tauri\target\$script:ReleaseTarget\release"
    $bundleDirectory = Join-Path $releaseDirectory "bundle\msi"
    $safeProductName = [regex]::Replace($productName, '[^\p{L}\p{Nd}._-]', "_")
    $msiFileName = "${safeProductName}_${version}_x64_$($languages[0]).msi"

    [pscustomobject]@{
        RepositoryRoot = $root
        Version = $version
        ProductName = $productName
        SafeProductName = $safeProductName
        Language = [string]$languages[0]
        Target = $script:ReleaseTarget
        ReleaseDirectory = $releaseDirectory
        BundleDirectory = $bundleDirectory
        ExecutablePath = Join-Path $releaseDirectory "preshot.exe"
        MsiFileName = $msiFileName
        MsiPath = Join-Path $bundleDirectory $msiFileName
        ChecksumPath = Join-Path $bundleDirectory "$msiFileName.sha256"
        ManifestPath = Join-Path $bundleDirectory "$safeProductName-$version-release.json"
        UpgradeCode = $upgradeCode
        HistoricalPerMachineUpgradeCode = $script:HistoricalPerMachineUpgradeCode
        HistoricalPerMachineVersion = $script:HistoricalPerMachineVersion
        FirstPerUserPublishVersion = $script:FirstPerUserPublishVersion
        LegacyMachineDetectionProperty = $script:LegacyMachineDetectionProperty
        TauriConfig = $tauri
    }
}

function Get-ReleasePublicationState {
    param(
        [Parameter(Mandatory)]$Configuration,
        [Parameter(Mandatory)]$Signing
    )

    $blockers = @()
    if (-not (Test-ReleaseVersionAtLeast -Version $Configuration.Version -Minimum $Configuration.FirstPerUserPublishVersion)) {
        $blockers += "version-must-exceed-historical-per-machine-$($Configuration.HistoricalPerMachineVersion)"
    }
    if (-not $Signing.Publishable) {
        $blockers += "authenticode-signatures-required"
    }

    [pscustomobject]@{
        Publishable = ($blockers.Count -eq 0)
        Blockers = @($blockers)
    }
}

function Assert-ReleasePublicationPolicy {
    param(
        [Parameter(Mandatory)]$Configuration,
        [switch]$Publish
    )

    if (
        $Publish -and
        (-not (Test-ReleaseVersionAtLeast -Version $Configuration.Version -Minimum $Configuration.FirstPerUserPublishVersion))
    ) {
        throw "Publishing the per-user MSI requires version '$($Configuration.FirstPerUserPublishVersion)' or newer because historical per-machine version '$($Configuration.HistoricalPerMachineVersion)' may already be public. Increment the release version first."
    }
}

function Assert-ProductionPrerequisites {
    param([Parameter(Mandatory)]$Configuration)

    if ($env:OS -ne "Windows_NT") {
        throw "Production MSI tooling supports Windows only."
    }

    Add-CargoToPath
    foreach ($command in @("pnpm", "cargo", "rustc", "rustup")) {
        if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
            throw "Missing required command '$command'. Install it and restart the terminal."
        }
    }

    $rustDetails = & rustc -vV
    if (($LASTEXITCODE -ne 0) -or (($rustDetails | Out-String) -notmatch "(?m)^host:\s+x86_64-pc-windows-msvc\s*$")) {
        throw "The active Rust host must be x86_64-pc-windows-msvc. Run 'rustup default stable-x86_64-pc-windows-msvc'."
    }

    $installedTargets = & rustup target list --installed
    if (($LASTEXITCODE -ne 0) -or ($installedTargets -notcontains $Configuration.Target)) {
        throw "Rust target '$($Configuration.Target)' is missing. Run 'rustup target add $($Configuration.Target)'."
    }

    $vswhere = $env:PRESHOT_VSWHERE
    if ([string]::IsNullOrWhiteSpace($vswhere)) {
        $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
    }
    if (-not (Test-Path -LiteralPath $vswhere)) {
        throw "Visual Studio Installer was not found. Install Visual Studio 2022 Build Tools with Desktop development with C++."
    }

    $installationPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if (($LASTEXITCODE -ne 0) -or [string]::IsNullOrWhiteSpace(($installationPath | Select-Object -First 1))) {
        throw "MSVC x64 build tools were not found. Install the Visual Studio 2022 Desktop development with C++ workload."
    }

    $tauri = Join-Path $Configuration.RepositoryRoot "node_modules\.bin\tauri.cmd"
    if (-not (Test-Path -LiteralPath $tauri)) {
        throw "The local Tauri CLI was not found. Run 'pnpm install --frozen-lockfile'."
    }

    $wixRoots = @()
    if (-not [string]::IsNullOrWhiteSpace($env:PRESHOT_WIX_ROOT)) {
        $wixRoots += $env:PRESHOT_WIX_ROOT
    }
    if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        $wixRoots += (Join-Path $env:LOCALAPPDATA "tauri\WixTools")
        $wixRoots += (Join-Path $env:LOCALAPPDATA "tauri\WixTools314")
    }

    $hasWixV3 = (Get-Command candle.exe -ErrorAction SilentlyContinue) -and (Get-Command light.exe -ErrorAction SilentlyContinue)
    $hasWixV4 = [bool](Get-Command wix.exe -ErrorAction SilentlyContinue)
    foreach ($root in $wixRoots) {
        if ((Test-Path (Join-Path $root "candle.exe")) -and (Test-Path (Join-Path $root "light.exe"))) {
            $hasWixV3 = $true
        }
        if (Test-Path (Join-Path $root "wix.exe")) {
            $hasWixV4 = $true
        }
    }
    if (-not ($hasWixV3 -or $hasWixV4)) {
        throw "WiX tools were not found. Install WiX or set PRESHOT_WIX_ROOT to the Tauri-compatible WiX tool directory."
    }
}

function Invoke-ProductionValidation {
    param(
        [Parameter(Mandatory)]$Configuration,
        [switch]$IncludeE2E
    )

    Push-Location $Configuration.RepositoryRoot
    try {
        $commands = @(
            @{ File = "pnpm"; Args = @("docs:check"); Description = "Documentation checks" },
            @{ File = "pnpm"; Args = @("lint"); Description = "ESLint" },
            @{ File = "pnpm"; Args = @("typecheck"); Description = "TypeScript typecheck" },
            @{ File = "pnpm"; Args = @("test"); Description = "Vitest unit tests" },
            @{ File = "pnpm"; Args = @("test:init"); Description = "Initializer tests" },
            @{ File = "pnpm"; Args = @("test:production-scripts"); Description = "Production tooling tests" },
            @{ File = "cargo"; Args = @("test", "--manifest-path", "src-tauri\Cargo.toml", "--target", $Configuration.Target, "--all-features", "--all-targets", "--locked"); Description = "Full Rust tests" }
        )
        if ($IncludeE2E) {
            $commands += @{ File = "pnpm"; Args = @("test:e2e"); Description = "Playwright release tests" }
            $commands += @{ File = "pnpm"; Args = @("test:e2e:blocknote"); Description = "BlockNote Playwright release tests" }
        }

        foreach ($command in $commands) {
            Invoke-CheckedNative -FilePath $command.File -Arguments $command.Args -Description $command.Description
        }
    }
    finally {
        Pop-Location
    }
}

function Get-MsiMetadata {
    param([Parameter(Mandatory)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "MSI does not exist: $Path"
    }

    $installer = $null
    $database = $null
    $summary = $null
    try {
        $installer = New-Object -ComObject WindowsInstaller.Installer
        $database = $installer.OpenDatabase($Path, 0)

        function Read-MsiProperty {
            param([string]$Name)
            $view = $null
            $record = $null
            try {
                $view = $database.OpenView("SELECT ``Value`` FROM ``Property`` WHERE ``Property``='$Name'")
                [void]$view.Execute()
                $record = $view.Fetch()
                if ($null -eq $record) {
                    return $null
                }
                return [string]$record.StringData(1)
            }
            finally {
                if ($null -ne $view) {
                    [void]$view.Close()
                    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($view)
                }
                if ($null -ne $record) {
                    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($record)
                }
            }
        }

        function Read-MsiUpgradeRow {
            param([Parameter(Mandatory)][string]$ExpectedUpgradeCode)

            $view = $null
            $record = $null
            try {
                $view = $database.OpenView(
                    "SELECT ``UpgradeCode``, ``VersionMin``, ``VersionMax``, ``Attributes``, ``ActionProperty`` FROM ``Upgrade``"
                )
                [void]$view.Execute()
                while ($null -ne ($record = $view.Fetch())) {
                    $upgradeCode = ([string]$record.StringData(1)).Trim().Trim("{", "}").ToUpperInvariant()
                    if ($upgradeCode -eq $ExpectedUpgradeCode) {
                        return [pscustomobject]@{
                            UpgradeCode = $upgradeCode
                            VersionMin = [string]$record.StringData(2)
                            VersionMax = [string]$record.StringData(3)
                            Attributes = [int]$record.IntegerData(4)
                            ActionProperty = [string]$record.StringData(5)
                        }
                    }
                    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($record)
                    $record = $null
                }
                return $null
            }
            finally {
                if ($null -ne $view) {
                    [void]$view.Close()
                    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($view)
                }
                if ($null -ne $record) {
                    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($record)
                }
            }
        }

        function Read-MsiLaunchCondition {
            param([Parameter(Mandatory)][string]$DetectionProperty)

            $view = $null
            $record = $null
            try {
                $view = $database.OpenView(
                    "SELECT ``Condition``, ``Description`` FROM ``LaunchCondition``"
                )
                [void]$view.Execute()
                while ($null -ne ($record = $view.Fetch())) {
                    $condition = [string]$record.StringData(1)
                    if ($condition -match [regex]::Escape($DetectionProperty)) {
                        return [pscustomobject]@{
                            Condition = $condition
                            Description = [string]$record.StringData(2)
                        }
                    }
                    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($record)
                    $record = $null
                }
                return $null
            }
            finally {
                if ($null -ne $view) {
                    [void]$view.Close()
                    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($view)
                }
                if ($null -ne $record) {
                    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($record)
                }
            }
        }

        $legacyUpgrade = Read-MsiUpgradeRow $script:HistoricalPerMachineUpgradeCode
        if ($null -eq $legacyUpgrade) {
            throw "Historical per-machine Upgrade row was not found."
        }
        $legacyCondition = Read-MsiLaunchCondition $script:LegacyMachineDetectionProperty
        if ($null -eq $legacyCondition) {
            throw "Historical per-machine LaunchCondition was not found."
        }
        $summary = $database.SummaryInformation(0)
        $metadata = [pscustomobject]@{
            ProductName = Read-MsiProperty "ProductName"
            ProductVersion = Read-MsiProperty "ProductVersion"
            Manufacturer = Read-MsiProperty "Manufacturer"
            ProductCode = Read-MsiProperty "ProductCode"
            UpgradeCode = Read-MsiProperty "UpgradeCode"
            Architecture = (([string]$summary.Property(7)) -split ";")[0]
            Template = [string]$summary.Property(7)
            LegacyUpgradeCode = $legacyUpgrade.UpgradeCode
            LegacyVersionMin = $legacyUpgrade.VersionMin
            LegacyVersionMax = $legacyUpgrade.VersionMax
            LegacyUpgradeAttributes = $legacyUpgrade.Attributes
            LegacyActionProperty = $legacyUpgrade.ActionProperty
            LegacyLaunchCondition = $legacyCondition.Condition
            LegacyLaunchConditionMessage = $legacyCondition.Description
        }
        return ConvertTo-NormalizedMsiMetadata $metadata
    }
    catch {
        throw "Unable to inspect MSI '$Path': $($_.Exception.Message)"
    }
    finally {
        foreach ($item in @($summary, $database, $installer)) {
            if ($null -ne $item) {
                [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($item)
            }
        }
    }
}

function Get-MsiRuntimeContractData {
    param([Parameter(Mandatory)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "MSI does not exist: $Path"
    }

    $installer = $null
    $database = $null
    try {
        $installer = New-Object -ComObject WindowsInstaller.Installer
        $database = $installer.OpenDatabase($Path, 0)

        function Read-MsiRows {
            param(
                [Parameter(Mandatory)][string]$Query,
                [Parameter(Mandatory)][string[]]$Columns
            )

            $view = $null
            $record = $null
            $rows = @()
            try {
                $view = $database.OpenView($Query)
                [void]$view.Execute()
                while ($null -ne ($record = $view.Fetch())) {
                    $row = [ordered]@{}
                    for ($index = 0; $index -lt $Columns.Count; $index++) {
                        $row[$Columns[$index]] = [string]$record.StringData($index + 1)
                    }
                    $rows += [pscustomobject]$row
                    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($record)
                    $record = $null
                }
                return @($rows)
            }
            finally {
                if ($null -ne $record) {
                    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($record)
                }
                if ($null -ne $view) {
                    [void]$view.Close()
                    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($view)
                }
            }
        }

        [pscustomobject]@{
            Features = @(Read-MsiRows `
                    "SELECT ``Feature``, ``Feature_Parent``, ``Attributes`` FROM ``Feature``" `
                    @("Feature", "Parent", "Attributes"))
            FeatureComponents = @(Read-MsiRows `
                    "SELECT ``Feature_``, ``Component_`` FROM ``FeatureComponents``" `
                    @("Feature", "Component"))
            Files = @(Read-MsiRows `
                    "SELECT ``File``, ``Component_`` FROM ``File``" `
                    @("File", "Component"))
            CustomActions = @(Read-MsiRows `
                    "SELECT ``Action``, ``Type``, ``Source``, ``Target`` FROM ``CustomAction``" `
                    @("Action", "Type", "Source", "Target"))
            Shortcuts = @(Read-MsiRows `
                    "SELECT ``Shortcut``, ``Target`` FROM ``Shortcut``" `
                    @("Shortcut", "Target"))
        }
    }
    catch {
        throw "Unable to inspect MSI runtime tables in '$Path': $($_.Exception.Message)"
    }
    finally {
        foreach ($item in @($database, $installer)) {
            if ($null -ne $item) {
                [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($item)
            }
        }
    }
}

function Assert-MsiRuntimeContracts {
    param([Parameter(Mandatory)]$Contract)

    $mainProgram = @($Contract.Features | Where-Object Feature -eq "MainProgram")
    if ($mainProgram.Count -ne 1 -or (([int]$mainProgram[0].Attributes -band 16) -eq 0)) {
        throw "Compiled MSI MainProgram must be present and disallow absence."
    }

    $mainComponents = @(
        $Contract.FeatureComponents |
            Where-Object Feature -eq "MainProgram" |
            ForEach-Object Component
    )
    if ($mainComponents -notcontains "Path") {
        throw "Compiled MSI ADDLOCAL=MainProgram does not install the Path executable component."
    }

    $requiredBinaryComponents = @(
        $Contract.Files |
            Where-Object { ($_.File -eq "Path") -or ($_.File -like "Bin_*") } |
            ForEach-Object Component |
            Select-Object -Unique
    )
    foreach ($component in $requiredBinaryComponents) {
        if ($mainComponents -notcontains $component) {
            throw "Compiled MSI ADDLOCAL=MainProgram omits required binary component '$component'."
        }
    }

    $environmentComponents = @(
        $Contract.FeatureComponents |
            Where-Object Feature -eq "Environment" |
            ForEach-Object Component
    )
    if ($environmentComponents -contains "Path") {
        throw "Compiled MSI Environment feature must not own the Path executable component."
    }
    if ($environmentComponents -notcontains "PathEnvironment") {
        throw "Compiled MSI Environment feature must own only its PATH environment component."
    }

    foreach ($shortcutId in @("ApplicationStartMenuShortcut", "ApplicationDesktopShortcut")) {
        $shortcut = @($Contract.Shortcuts | Where-Object Shortcut -eq $shortcutId)
        if ($shortcut.Count -ne 1 -or $shortcut[0].Target -ne "[!Path]") {
            throw "Compiled MSI shortcut '$shortcutId' must target the mandatory Path executable."
        }
    }

    $bootstrapperActions = @(
        $Contract.CustomActions |
            Where-Object Action -in @("DownloadAndInvokeBootstrapper", "InvokeBootstrapper")
    )
    if ($bootstrapperActions.Count -eq 0) {
        throw "Compiled MSI does not contain a supported WebView2 bootstrapper action."
    }
    foreach ($action in $bootstrapperActions) {
        $target = [string]$action.Target
        foreach ($required in @(
                "Start-Process",
                "-PassThru",
                "-Wait",
                "`$ErrorActionPreference = 'Stop'",
                '$process.ExitCode -notin @(0, 1641, 3010)',
                "exit `$process.ExitCode"
            )) {
            if (-not $target.Contains($required)) {
                throw "Compiled MSI custom action '$($action.Action)' does not propagate WebView2 failures; missing '$required'."
            }
        }
        if (([int]$action.Type -band 192) -ne 0) {
            throw "Compiled MSI custom action '$($action.Action)' must use synchronous checked return processing."
        }
    }
}

function ConvertTo-NormalizedMsiText {
    param($Value)

    if ($null -eq $Value) {
        return $null
    }

    $text = [string]$Value
    return $text.Trim().Trim([char]0xFEFF).Trim()
}

function ConvertTo-NormalizedMsiGuid {
    param($Value)

    $text = ConvertTo-NormalizedMsiText $Value
    if ($null -eq $text) {
        return $null
    }
    return $text.Trim("{", "}").ToUpperInvariant()
}

function ConvertTo-NormalizedMsiMetadata {
    param([Parameter(Mandatory)]$Metadata)

    function Get-MsiMetadataValue {
        param([string]$Name)

        $property = $Metadata.PSObject.Properties[$Name]
        if ($null -eq $property) {
            return $null
        }
        return $property.Value
    }

    [pscustomobject]@{
        ProductName = ConvertTo-NormalizedMsiText (Get-MsiMetadataValue "ProductName")
        ProductVersion = ConvertTo-NormalizedMsiText (Get-MsiMetadataValue "ProductVersion")
        Manufacturer = ConvertTo-NormalizedMsiText (Get-MsiMetadataValue "Manufacturer")
        ProductCode = ConvertTo-NormalizedMsiText (Get-MsiMetadataValue "ProductCode")
        UpgradeCode = ConvertTo-NormalizedMsiGuid (Get-MsiMetadataValue "UpgradeCode")
        Architecture = ConvertTo-NormalizedMsiText (Get-MsiMetadataValue "Architecture")
        Template = ConvertTo-NormalizedMsiText (Get-MsiMetadataValue "Template")
        LegacyUpgradeCode = ConvertTo-NormalizedMsiGuid (Get-MsiMetadataValue "LegacyUpgradeCode")
        LegacyVersionMin = ConvertTo-NormalizedMsiText (Get-MsiMetadataValue "LegacyVersionMin")
        LegacyVersionMax = ConvertTo-NormalizedMsiText (Get-MsiMetadataValue "LegacyVersionMax")
        LegacyUpgradeAttributes = Get-MsiMetadataValue "LegacyUpgradeAttributes"
        LegacyActionProperty = ConvertTo-NormalizedMsiText (Get-MsiMetadataValue "LegacyActionProperty")
        LegacyLaunchCondition = ConvertTo-NormalizedMsiText (Get-MsiMetadataValue "LegacyLaunchCondition")
        LegacyLaunchConditionMessage = ConvertTo-NormalizedMsiText (Get-MsiMetadataValue "LegacyLaunchConditionMessage")
    }
}

function Get-ExpectedMsiFileName {
    param(
        [Parameter(Mandatory)]$Configuration,
        [Parameter(Mandatory)]$Metadata
    )

    Assert-ReleaseVersion ([string]$Metadata.ProductVersion)
    if ([string]$Metadata.Architecture -notin @("x64", "Intel64")) {
        throw "MSI architecture '$($Metadata.Architecture)' is not x64."
    }
    return "$($Configuration.SafeProductName)_$($Metadata.ProductVersion)_x64_$($Configuration.Language).msi"
}

function Remove-StaleProductMsis {
    param(
        [Parameter(Mandatory)]$Configuration,
        [scriptblock]$MetadataReader = { param($Path) Get-MsiMetadata $Path }
    )

    if (-not (Test-Path -LiteralPath $Configuration.BundleDirectory)) {
        return
    }

    foreach ($file in Get-ChildItem -LiteralPath $Configuration.BundleDirectory -Filter "*.msi" -File) {
        $metadata = ConvertTo-NormalizedMsiMetadata (& $MetadataReader $file.FullName)
        if ($metadata.ProductName -ne $Configuration.ProductName) {
            continue
        }

        $expectedName = Get-ExpectedMsiFileName $Configuration $metadata
        if ($file.Name -cne $expectedName) {
            throw "Refusing to remove same-product MSI with an unexpected name. Inspected '$($file.Name)' as '$($metadata.ProductName)' $($metadata.ProductVersion) $($metadata.Architecture); expected exact name '$expectedName'."
        }

        Remove-Item -LiteralPath $file.FullName -Force
        foreach ($suffix in @(".sha256")) {
            $sidecar = "$($file.FullName)$suffix"
            if (Test-Path -LiteralPath $sidecar) {
                Remove-Item -LiteralPath $sidecar -Force
            }
        }
    }

    if (Test-Path -LiteralPath $Configuration.ManifestPath) {
        Remove-Item -LiteralPath $Configuration.ManifestPath -Force
    }
}

function Assert-ReleaseArtifacts {
    param(
        [Parameter(Mandatory)]$Configuration,
        [scriptblock]$MetadataReader = { param($Path) Get-MsiMetadata $Path },
        [scriptblock]$RuntimeContractReader = { param($Path) Get-MsiRuntimeContractData $Path }
    )

    $executable = Assert-ReleaseExecutable $Configuration

    if (-not (Test-Path -LiteralPath $Configuration.BundleDirectory)) {
        throw "MSI bundle directory was not found: $($Configuration.BundleDirectory)"
    }

    $sameProduct = @()
    foreach ($file in Get-ChildItem -LiteralPath $Configuration.BundleDirectory -Filter "*.msi" -File) {
        $metadata = ConvertTo-NormalizedMsiMetadata (& $MetadataReader $file.FullName)
        if ($metadata.ProductName -eq $Configuration.ProductName) {
            $sameProduct += [pscustomobject]@{ File = $file; Metadata = $metadata }
        }
    }
    if ($sameProduct.Count -ne 1) {
        throw "Expected exactly one '$($Configuration.ProductName)' MSI in '$($Configuration.BundleDirectory)', found $($sameProduct.Count)."
    }

    $artifact = $sameProduct[0]
    Assert-ReleaseVersion ([string]$artifact.Metadata.ProductVersion)
    if ($artifact.Metadata.ProductVersion -ne $Configuration.Version) {
        throw "MSI version '$($artifact.Metadata.ProductVersion)' does not match release version '$($Configuration.Version)'."
    }
    if ($artifact.Metadata.UpgradeCode -ne $Configuration.UpgradeCode) {
        throw "MSI UpgradeCode '$($artifact.Metadata.UpgradeCode)' does not match the per-user lineage '$($Configuration.UpgradeCode)'."
    }
    if ($artifact.Metadata.LegacyUpgradeCode -ne $Configuration.HistoricalPerMachineUpgradeCode) {
        throw "MSI does not detect the historical per-machine UpgradeCode '$($Configuration.HistoricalPerMachineUpgradeCode)'."
    }
    if (
        ($artifact.Metadata.LegacyVersionMin -ne "0.0.0") -or
        ($artifact.Metadata.LegacyVersionMax -ne "255.255.65535") -or
        (([int]$artifact.Metadata.LegacyUpgradeAttributes -band 2) -ne 2) -or
        ($artifact.Metadata.LegacyActionProperty -ne $Configuration.LegacyMachineDetectionProperty)
    ) {
        throw "MSI historical per-machine detection must be an all-version, detect-only Upgrade row using '$($Configuration.LegacyMachineDetectionProperty)'."
    }
    if (
        ($artifact.Metadata.LegacyLaunchCondition -notmatch "(?i)\bInstalled\b") -or
        ($artifact.Metadata.LegacyLaunchCondition -notmatch [regex]::Escape($Configuration.LegacyMachineDetectionProperty)) -or
        ($artifact.Metadata.LegacyLaunchConditionMessage -notmatch "(?i)machine-wide") -or
        ($artifact.Metadata.LegacyLaunchConditionMessage -notmatch "(?i)uninstall")
    ) {
        throw "MSI historical per-machine LaunchCondition or uninstall guidance is missing."
    }
    $expectedName = Get-ExpectedMsiFileName $Configuration $artifact.Metadata
    if ($artifact.File.Name -cne $expectedName -or $artifact.File.FullName -cne $Configuration.MsiPath) {
        throw "MSI path/name mismatch. Expected '$($Configuration.MsiPath)', found '$($artifact.File.FullName)'."
    }
    if ($artifact.File.Length -le 0) {
        throw "Release MSI is empty: $($artifact.File.FullName)"
    }
    if (
        $PSBoundParameters.ContainsKey("RuntimeContractReader") -or
        (-not $PSBoundParameters.ContainsKey("MetadataReader"))
    ) {
        Assert-MsiRuntimeContracts (& $RuntimeContractReader $artifact.File.FullName)
    }

    [pscustomobject]@{
        Executable = $executable
        Msi = $artifact.File
        MsiMetadata = $artifact.Metadata
    }
}

function Assert-ReleaseExecutable {
    param([Parameter(Mandatory)]$Configuration)

    $expectedReleaseRoot = [System.IO.Path]::GetFullPath($Configuration.ReleaseDirectory).TrimEnd("\")
    $executablePath = [System.IO.Path]::GetFullPath($Configuration.ExecutablePath)
    if (-not $executablePath.StartsWith("$expectedReleaseRoot\", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Release executable escaped the expected target release directory: $executablePath"
    }
    if ($executablePath -match '(?i)\\debug\\') {
        throw "Debug-profile executable cannot be used for production: $executablePath"
    }
    if ((-not (Test-Path -LiteralPath $executablePath)) -or ((Get-Item -LiteralPath $executablePath).Length -le 0)) {
        throw "Expected non-empty release executable was not found: $executablePath"
    }
    return Get-Item -LiteralPath $executablePath
}

function ConvertTo-NormalizedSignatureText {
    param($Value)

    if ($null -eq $Value) {
        return $null
    }

    return ([string]$Value).Trim().Trim([char]0xFEFF).Trim()
}

function ConvertTo-NormalizedSha1Thumbprint {
    param($Value)

    $text = ConvertTo-NormalizedSignatureText $Value
    if ([string]::IsNullOrWhiteSpace($text)) {
        return $null
    }

    return ([regex]::Replace($text, '[\s\u200E\u200F:-]', "")).ToUpperInvariant()
}

function Get-ConfiguredSignerThumbprint {
    if ([string]::IsNullOrWhiteSpace($env:PRESHOT_SIGN_CERT_SHA1)) {
        return $null
    }

    $thumbprint = ConvertTo-NormalizedSha1Thumbprint $env:PRESHOT_SIGN_CERT_SHA1
    if ($thumbprint -notmatch '^[0-9A-F]{40}$') {
        throw "PRESHOT_SIGN_CERT_SHA1 must contain exactly 40 hexadecimal SHA1 characters."
    }
    return $thumbprint
}

function Get-ObjectPropertyValue {
    param(
        $InputObject,
        [Parameter(Mandatory)][string]$Name
    )

    if ($null -eq $InputObject) {
        return $null
    }
    $property = $InputObject.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $null
    }
    return $property.Value
}

function Get-SignatureResult {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][scriptblock]$SignatureReader
    )

    $signature = & $SignatureReader $Path
    $status = ConvertTo-NormalizedSignatureText (Get-ObjectPropertyValue $signature "Status")
    $certificate = Get-ObjectPropertyValue $signature "SignerCertificate"
    $hasCertificate = $null -ne $certificate
    if (($status -ieq "Valid") -and $hasCertificate) {
        return [pscustomobject]@{
            Path = $Path
            State = "signed"
            Status = "Valid"
            Subject = ConvertTo-NormalizedSignatureText (Get-ObjectPropertyValue $certificate "Subject")
            Thumbprint = ConvertTo-NormalizedSha1Thumbprint (Get-ObjectPropertyValue $certificate "Thumbprint")
        }
    }
    if ($status -ieq "NotSigned") {
        return [pscustomobject]@{
            Path = $Path
            State = "unsigned"
            Status = "NotSigned"
            Subject = $null
            Thumbprint = $null
        }
    }

    throw "Authenticode signature verification failed for '$Path' with status '$status'."
}

function Get-SigntoolSignatureResult {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)]$Verification
    )

    $exitCodeValue = Get-ObjectPropertyValue $Verification "ExitCode"
    if ($null -eq $exitCodeValue) {
        throw "signtool signature verification returned no exit code for '$Path'."
    }
    if ([int]$exitCodeValue -ne 0) {
        $failureOutput = ConvertTo-NormalizedSignatureText (Get-ObjectPropertyValue $Verification "Output")
        throw "signtool signature verification failed for '$Path' with exit code $exitCodeValue. $failureOutput"
    }

    $certificate = Get-ObjectPropertyValue $Verification "SignerCertificate"
    $thumbprint = ConvertTo-NormalizedSha1Thumbprint (Get-ObjectPropertyValue $Verification "Thumbprint")
    if ($null -eq $thumbprint) {
        $thumbprint = ConvertTo-NormalizedSha1Thumbprint (Get-ObjectPropertyValue $Verification "SignerThumbprint")
    }
    if (($null -eq $thumbprint) -and ($null -ne $certificate)) {
        $thumbprint = ConvertTo-NormalizedSha1Thumbprint (Get-ObjectPropertyValue $certificate "Thumbprint")
    }

    $output = [string](Get-ObjectPropertyValue $Verification "Output")
    if (($null -eq $thumbprint) -and (-not [string]::IsNullOrWhiteSpace($output))) {
        $hashMatch = [regex]::Match(
            $output,
            '(?im)(?:SHA[\s-]*1(?:\s+hash)?|certificate\s+(?:SHA[\s-]*1\s+)?hash)\s*:\s*([0-9a-f](?:[\s:-]*[0-9a-f]){39})'
        )
        if ($hashMatch.Success) {
            $thumbprint = ConvertTo-NormalizedSha1Thumbprint $hashMatch.Groups[1].Value
        }
    }

    $subject = ConvertTo-NormalizedSignatureText (Get-ObjectPropertyValue $Verification "Subject")
    if (($null -eq $subject) -and ($null -ne $certificate)) {
        $subject = ConvertTo-NormalizedSignatureText (Get-ObjectPropertyValue $certificate "Subject")
    }

    [pscustomobject]@{
        Path = $Path
        State = "signed"
        Status = "Valid"
        Subject = $subject
        Thumbprint = $thumbprint
    }
}

function Test-SignatureReaderUnavailableError {
    param([Parameter(Mandatory)]$ErrorRecord)

    $exception = $ErrorRecord.Exception
    if (
        ($exception -is [System.Management.Automation.CommandNotFoundException]) -or
        ($exception -is [System.IO.FileNotFoundException]) -or
        ($exception -is [System.IO.FileLoadException])
    ) {
        return $true
    }

    $details = "$($ErrorRecord.FullyQualifiedErrorId) $($exception.Message)"
    return $details -match '(?i)(could not autoload|module.+could not be loaded|specified module.+not found|Get-AuthenticodeSignature.+not recognized)'
}

function Invoke-SigntoolVerification {
    param(
        [Parameter(Mandatory)][string]$SigntoolPath,
        [Parameter(Mandatory)][string]$ArtifactPath
    )

    $oldErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & $SigntoolPath verify /pa /all /v $ArtifactPath 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $oldErrorActionPreference
    }

    [pscustomobject]@{
        ExitCode = $exitCode
        Output = ($output | Out-String).Trim()
    }
}

function Get-ConfiguredSigntoolPath {
    $signtool = $env:PRESHOT_SIGNTOOL_PATH
    $signingConfigured = `
        (-not [string]::IsNullOrWhiteSpace($env:PRESHOT_SIGN_CERT_SHA1)) -or `
        (-not [string]::IsNullOrWhiteSpace($env:PRESHOT_SIGN_CERT_FILE))

    if ([string]::IsNullOrWhiteSpace($signtool) -and $signingConfigured) {
        $command = Get-Command signtool.exe -ErrorAction SilentlyContinue
        if ($null -ne $command) {
            $signtool = $command.Source
        }
    }
    if ([string]::IsNullOrWhiteSpace($signtool)) {
        return $null
    }
    if (-not (Test-Path -LiteralPath $signtool -PathType Leaf)) {
        throw "Configured signtool.exe was not found: $signtool"
    }
    return $signtool
}

function Get-ReleaseSigningState {
    param(
        [Parameter(Mandatory)][string[]]$Paths,
        [switch]$Publish,
        [scriptblock]$SignatureReader,
        [scriptblock]$SigntoolVerifier
    )

    $results = @()
    $verificationAvailable = $true
    $verificationSource = "powershell"
    $expectedThumbprint = Get-ConfiguredSignerThumbprint

    if ($null -ne $SigntoolVerifier) {
        $verificationSource = "signtool"
        foreach ($path in $Paths) {
            $verification = & $SigntoolVerifier $path
            $results += Get-SigntoolSignatureResult -Path $path -Verification $verification
        }
    }
    elseif ($null -eq $SignatureReader) {
        $signtoolPath = Get-ConfiguredSigntoolPath
        if ($null -ne $signtoolPath) {
            $verificationSource = "signtool"
            foreach ($path in $Paths) {
                $verification = Invoke-SigntoolVerification -SigntoolPath $signtoolPath -ArtifactPath $path
                $results += Get-SigntoolSignatureResult -Path $path -Verification $verification
            }
        }
        else {
            $SignatureReader = { param($Path) Get-AuthenticodeSignature -FilePath $Path }
        }
    }

    if (($results.Count -eq 0) -and ($null -ne $SignatureReader)) {
        try {
            $results = @($Paths | ForEach-Object { Get-SignatureResult -Path $_ -SignatureReader $SignatureReader })
        }
        catch {
            if (-not (Test-SignatureReaderUnavailableError $_)) {
                throw
            }
            $verificationAvailable = $false
            $verificationSource = "unavailable"
            $results = @($Paths | ForEach-Object {
                    [pscustomobject]@{
                        Path = $_
                        State = "unsigned"
                        Status = "VerificationUnavailable"
                        Subject = $null
                        Thumbprint = $null
                    }
                })
        }
    }

    $signedCount = @($results | Where-Object State -eq "signed").Count
    $state = "unsigned"
    if ($signedCount -eq $results.Count) {
        $state = "signed"
    }
    elseif ($signedCount -gt 0) {
        $state = "partial"
    }

    $signedResults = @($results | Where-Object State -eq "signed")
    $knownThumbprints = @($signedResults |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_.Thumbprint) } |
            ForEach-Object { $_.Thumbprint } |
            Select-Object -Unique)
    $allSignedThumbprintsKnown = `
        ($state -eq "signed") -and `
        (@($signedResults | Where-Object { [string]::IsNullOrWhiteSpace($_.Thumbprint) }).Count -eq 0)
    $signersMatch = $allSignedThumbprintsKnown -and ($knownThumbprints.Count -eq 1)
    $matchesExpectedSigner = $null -eq $expectedThumbprint
    if ($null -ne $expectedThumbprint) {
        $matchesExpectedSigner = `
            $allSignedThumbprintsKnown -and `
            (@($signedResults | Where-Object Thumbprint -ne $expectedThumbprint).Count -eq 0)
    }

    $publishable = $state -eq "signed"
    if (($allSignedThumbprintsKnown -and (-not $signersMatch)) -or (-not $matchesExpectedSigner)) {
        $publishable = $false
    }

    if ($Publish -and (-not $verificationAvailable)) {
        throw "Publishing mode requires signature verification, but no configured signtool verifier is available and the PowerShell security module could not be loaded."
    }
    if ($Publish -and ($state -ne "signed")) {
        throw "Publishing mode requires valid Authenticode signatures on the release executable and MSI; current state is '$state'."
    }
    if ($Publish -and ($null -ne $expectedThumbprint)) {
        $missingSignerPaths = @($signedResults |
                Where-Object { [string]::IsNullOrWhiteSpace($_.Thumbprint) } |
                ForEach-Object Path)
        if ($missingSignerPaths.Count -gt 0) {
            throw "Publishing mode expected signer '$expectedThumbprint', but signature verification did not report a signer thumbprint for: $($missingSignerPaths -join ', ')."
        }

        $wrongSignerResults = @($signedResults | Where-Object Thumbprint -ne $expectedThumbprint)
        if ($wrongSignerResults.Count -gt 0) {
            $wrongSigners = @($wrongSignerResults | ForEach-Object { "'$($_.Path)'=$($_.Thumbprint)" })
            throw "Publishing mode signature does not match configured signer '$expectedThumbprint': $($wrongSigners -join ', ')."
        }
    }
    elseif ($Publish -and $allSignedThumbprintsKnown -and (-not $signersMatch)) {
        $signers = @($signedResults | ForEach-Object { "'$($_.Path)'=$($_.Thumbprint)" })
        throw "Publishing mode executable and MSI signer thumbprints must match each other: $($signers -join ', ')."
    }

    [pscustomobject]@{
        State = $state
        Signed = ($state -eq "signed")
        Publishable = $publishable
        VerificationAvailable = $verificationAvailable
        VerificationSource = $verificationSource
        ExpectedSignerThumbprint = $expectedThumbprint
        Files = $results
    }
}

function Invoke-PostBuildSigning {
    param(
        [Parameter(Mandatory)][string[]]$Paths
    )

    $certificateSha1 = $env:PRESHOT_SIGN_CERT_SHA1
    $certificateFile = $env:PRESHOT_SIGN_CERT_FILE
    if ([string]::IsNullOrWhiteSpace($certificateSha1) -and [string]::IsNullOrWhiteSpace($certificateFile)) {
        return
    }
    if ((-not [string]::IsNullOrWhiteSpace($certificateSha1)) -and (-not [string]::IsNullOrWhiteSpace($certificateFile))) {
        throw "Configure only one of PRESHOT_SIGN_CERT_SHA1 or PRESHOT_SIGN_CERT_FILE."
    }
    if (-not [string]::IsNullOrWhiteSpace($certificateSha1)) {
        $certificateSha1 = Get-ConfiguredSignerThumbprint
    }

    $signtool = $env:PRESHOT_SIGNTOOL_PATH
    if ([string]::IsNullOrWhiteSpace($signtool)) {
        $command = Get-Command signtool.exe -ErrorAction SilentlyContinue
        if ($null -ne $command) {
            $signtool = $command.Source
        }
    }
    if ([string]::IsNullOrWhiteSpace($signtool) -or (-not (Test-Path -LiteralPath $signtool))) {
        throw "Post-build signing was requested but signtool.exe was not found. Set PRESHOT_SIGNTOOL_PATH."
    }

    foreach ($path in $Paths) {
        $arguments = @("sign", "/fd", "SHA256")
        if (-not [string]::IsNullOrWhiteSpace($certificateSha1)) {
            $arguments += @("/sha1", $certificateSha1)
        }
        else {
            if (-not (Test-Path -LiteralPath $certificateFile)) {
                throw "Signing certificate file was not found: $certificateFile"
            }
            $arguments += @("/f", $certificateFile)
            if (-not [string]::IsNullOrWhiteSpace($env:PRESHOT_SIGN_CERT_PASSWORD)) {
                $arguments += @("/p", $env:PRESHOT_SIGN_CERT_PASSWORD)
            }
        }
        if (-not [string]::IsNullOrWhiteSpace($env:PRESHOT_SIGN_TIMESTAMP_URL)) {
            $arguments += @("/tr", $env:PRESHOT_SIGN_TIMESTAMP_URL, "/td", "SHA256")
        }
        if (-not [string]::IsNullOrWhiteSpace($env:PRESHOT_SIGN_DESCRIPTION)) {
            $arguments += @("/d", $env:PRESHOT_SIGN_DESCRIPTION)
        }
        if (-not [string]::IsNullOrWhiteSpace($env:PRESHOT_SIGN_DESCRIPTION_URL)) {
            $arguments += @("/du", $env:PRESHOT_SIGN_DESCRIPTION_URL)
        }
        $arguments += $path
        Invoke-CheckedNative -FilePath $signtool -Arguments $arguments -Description "Authenticode signing of '$(Split-Path $path -Leaf)'"
    }
}

function Get-ReleaseTimestamp {
    param([Parameter(Mandatory)][string]$RepositoryRoot)

    if (-not [string]::IsNullOrWhiteSpace($env:SOURCE_DATE_EPOCH)) {
        $seconds = 0L
        if (-not [long]::TryParse($env:SOURCE_DATE_EPOCH, [ref]$seconds)) {
            throw "SOURCE_DATE_EPOCH must be an integer Unix timestamp."
        }
        return [pscustomobject]@{
            Value = [DateTimeOffset]::FromUnixTimeSeconds($seconds).UtcDateTime.ToString("yyyy-MM-ddTHH:mm:ssZ")
            Strategy = "source-date-epoch"
        }
    }

    if (
        (-not (Test-Path -LiteralPath (Join-Path $RepositoryRoot ".git"))) -or
        (-not (Get-Command git -ErrorAction SilentlyContinue))
    ) {
        return [pscustomobject]@{ Value = $null; Strategy = "omitted" }
    }

    $oldErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    try {
        $commitTimestamp = & git -C $RepositoryRoot show -s --format=%cI HEAD 2>$null
        $gitExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $oldErrorActionPreference
    }
    if (($gitExitCode -eq 0) -and (-not [string]::IsNullOrWhiteSpace(($commitTimestamp | Select-Object -First 1)))) {
        return [pscustomobject]@{
            Value = ([DateTimeOffset]::Parse(($commitTimestamp | Select-Object -First 1))).UtcDateTime.ToString("yyyy-MM-ddTHH:mm:ssZ")
            Strategy = "git-commit"
        }
    }

    return [pscustomobject]@{ Value = $null; Strategy = "omitted" }
}

function Get-GitCommit {
    param([Parameter(Mandatory)][string]$RepositoryRoot)

    if (
        (-not (Test-Path -LiteralPath (Join-Path $RepositoryRoot ".git"))) -or
        (-not (Get-Command git -ErrorAction SilentlyContinue))
    ) {
        return $null
    }

    $oldErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    try {
        $commit = & git -C $RepositoryRoot rev-parse HEAD 2>$null
        $gitExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $oldErrorActionPreference
    }
    if (($gitExitCode -eq 0) -and ($commit -match "^[0-9a-fA-F]{40}$")) {
        return ([string]$commit).ToLowerInvariant()
    }
    return $null
}

function Get-ReleaseMetadataContent {
    param(
        [Parameter(Mandatory)]$Configuration,
        [Parameter(Mandatory)]$Artifacts,
        [Parameter(Mandatory)]$Signing
    )

    $executableHash = Get-Sha256 $Artifacts.Executable.FullName
    $msiHash = Get-Sha256 $Artifacts.Msi.FullName
    $timestamp = Get-ReleaseTimestamp $Configuration.RepositoryRoot
    $commit = Get-GitCommit $Configuration.RepositoryRoot
    $publication = Get-ReleasePublicationState -Configuration $Configuration -Signing $Signing

    $manifest = [ordered]@{
        schemaVersion = 2
        product = $Configuration.ProductName
        version = $Configuration.Version
        target = $Configuration.Target
        profile = "release"
        architecture = "x64"
        commit = $commit
        generatedAt = $timestamp.Value
        timestampStrategy = $timestamp.Strategy
        signing = [ordered]@{
            state = $Signing.State
            signed = [bool]$Signing.Signed
            validForPublication = [bool]$Signing.Publishable
        }
        installer = [ordered]@{
            scope = "perUser"
            upgradeCode = $Configuration.UpgradeCode
            historicalPerMachine = [ordered]@{
                upgradeCode = $Configuration.HistoricalPerMachineUpgradeCode
                lastPublishedVersion = $Configuration.HistoricalPerMachineVersion
                detectionProperty = $Configuration.LegacyMachineDetectionProperty
                action = "block-and-uninstall-first"
            }
            firstPublishableVersion = $Configuration.FirstPerUserPublishVersion
        }
        publication = [ordered]@{
            publishable = [bool]$publication.Publishable
            blockers = @($publication.Blockers)
        }
        files = @(
            [ordered]@{
                kind = "executable"
                name = $Artifacts.Executable.Name
                size = [int64]$Artifacts.Executable.Length
                sha256 = $executableHash
            },
            [ordered]@{
                kind = "msi"
                name = $Artifacts.Msi.Name
                size = [int64]$Artifacts.Msi.Length
                sha256 = $msiHash
            }
        )
    }

    [pscustomobject]@{
        Checksum = "$msiHash  $($Artifacts.Msi.Name)`n"
        Manifest = (($manifest | ConvertTo-Json -Depth 8) + "`n")
    }
}

function Write-ReleaseMetadata {
    param(
        [Parameter(Mandatory)]$Configuration,
        [Parameter(Mandatory)]$Artifacts,
        [Parameter(Mandatory)]$Signing
    )

    $content = Get-ReleaseMetadataContent $Configuration $Artifacts $Signing
    Write-Utf8File -Path $Configuration.ChecksumPath -Content $content.Checksum
    Write-Utf8File -Path $Configuration.ManifestPath -Content $content.Manifest
}

function Assert-ReleaseMetadata {
    param(
        [Parameter(Mandatory)]$Configuration,
        [Parameter(Mandatory)]$Artifacts,
        [Parameter(Mandatory)]$Signing
    )

    $expected = Get-ReleaseMetadataContent $Configuration $Artifacts $Signing
    foreach ($item in @(
        @{ Path = $Configuration.ChecksumPath; Content = $expected.Checksum; Name = "checksum" },
        @{ Path = $Configuration.ManifestPath; Content = $expected.Manifest; Name = "release manifest" }
    )) {
        if (-not (Test-Path -LiteralPath $item.Path)) {
            throw "Expected $($item.Name) was not found: $($item.Path)"
        }
        $actual = [System.IO.File]::ReadAllText($item.Path)
        if ($actual -cne $item.Content) {
            throw "The $($item.Name) does not match the current release artifacts: $($item.Path)"
        }
    }
}

function Test-PublishingMode {
    param([switch]$Publish)
    return [bool]($Publish -or ($env:PRESHOT_PUBLISH -eq "1"))
}

function Invoke-InstallerValidationHook {
    param(
        [Parameter(Mandatory)]$Configuration,
        [switch]$Publish
    )

    $hook = $env:PRESHOT_INSTALLER_VERIFY_SCRIPT
    if ([string]::IsNullOrWhiteSpace($hook)) {
        Write-Host "No non-destructive installer validation hook configured; built-in MSI metadata validation passed."
        return
    }
    if (-not (Test-Path -LiteralPath $hook -PathType Leaf)) {
        throw "Installer validation hook was not found: $hook"
    }

    $hostPath = (Get-Process -Id $PID).Path
    $arguments = @(
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        $hook,
        "-MsiPath",
        $Configuration.MsiPath,
        "-ManifestPath",
        $Configuration.ManifestPath
    )
    if ($Publish.IsPresent) {
        $arguments += "-Publish"
    }
    Invoke-CheckedNative `
        -FilePath $hostPath `
        -Arguments $arguments `
        -Description "Installer validation hook"
}

function Set-ReleaseVersionFiles {
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)][string]$Version,
        [switch]$Publish,
        [scriptblock]$CargoMetadataInvoker
    )

    Assert-ReleaseVersion $Version
    if (
        (Test-PublishingMode -Publish:$Publish) -and
        (-not (Test-ReleaseVersionAtLeast -Version $Version -Minimum $script:FirstPerUserPublishVersion))
    ) {
        throw "Publishing the per-user MSI requires version '$script:FirstPerUserPublishVersion' or newer because historical per-machine version '$script:HistoricalPerMachineVersion' may already be public."
    }
    $configuration = Get-ReleaseConfiguration $RepositoryRoot
    if ($configuration.Version -eq $Version) {
        if (Test-PublishingMode -Publish:$Publish) {
            throw "Publishing mode rejects same-version/no-op release '$Version'. Increment the release version first."
        }
        return $false
    }

    $paths = @(
        (Join-Path $configuration.RepositoryRoot "package.json"),
        (Join-Path $configuration.RepositoryRoot "src-tauri\Cargo.toml"),
        (Join-Path $configuration.RepositoryRoot "src-tauri\tauri.conf.json"),
        (Join-Path $configuration.RepositoryRoot "src-tauri\Cargo.lock")
    )
    $original = @{}
    foreach ($path in $paths) {
        $original[$path] = [System.IO.File]::ReadAllText($path)
    }

    try {
        $packageContent = $original[$paths[0]]
        $updatedPackage = [regex]::Replace(
            $packageContent,
            '(?m)^(\s*"version"\s*:\s*)"[^"]+"',
            "`${1}`"$Version`"",
            1
        )
        if ($updatedPackage -ceq $packageContent) {
            throw "Unable to update package.json version."
        }
        Write-Utf8File $paths[0] $updatedPackage

        $cargoContent = $original[$paths[1]]
        $updatedCargo = [regex]::Replace(
            $cargoContent,
            '(?ms)^(\[package\][\s\S]*?^version\s*=\s*)"[^"]+"',
            "`${1}`"$Version`"",
            1
        )
        if ($updatedCargo -ceq $cargoContent) {
            throw "Unable to update Cargo.toml package version."
        }
        Write-Utf8File $paths[1] $updatedCargo

        $tauriContent = $original[$paths[2]]
        $updatedTauri = [regex]::Replace(
            $tauriContent,
            '(?m)^(\s*"version"\s*:\s*)"[^"]+"',
            "`${1}`"$Version`"",
            1
        )
        if ($updatedTauri -ceq $tauriContent) {
            throw "Unable to update tauri.conf.json version."
        }
        Write-Utf8File $paths[2] $updatedTauri

        if ($null -ne $CargoMetadataInvoker) {
            & $CargoMetadataInvoker $configuration.RepositoryRoot $Version
        }
        else {
            Add-CargoToPath
            if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
                throw "Cargo was not found; Cargo.lock cannot be updated."
            }
            Invoke-CheckedNative `
                -FilePath "cargo" `
                -Arguments @(
                    "update",
                    "--manifest-path",
                    (Join-Path $configuration.RepositoryRoot "src-tauri\Cargo.toml"),
                    "--package",
                    "preshot",
                    "--precise",
                    $Version,
                    "--offline"
                ) `
                -Description "Cargo.lock release version update"
        }

        $updated = Get-ReleaseConfiguration $configuration.RepositoryRoot
        if ($updated.Version -ne $Version) {
            throw "Version update verification failed; expected '$Version', found '$($updated.Version)'."
        }
        return $true
    }
    catch {
        foreach ($path in $paths) {
            Write-Utf8File $path $original[$path]
        }
        throw
    }
}

Export-ModuleMember -Function @(
    "Add-CargoToPath",
    "Assert-ProductionPrerequisites",
    "Assert-MsiRuntimeContracts",
    "Assert-ReleasePublicationPolicy",
    "Assert-ReleaseArtifacts",
    "Assert-ReleaseExecutable",
    "Assert-ReleaseMetadata",
    "Assert-ReleaseVersion",
    "Get-ExpectedMsiFileName",
    "Get-ReleaseConfiguration",
    "Get-ReleaseMetadataContent",
    "Get-ReleasePublicationState",
    "Get-ReleaseSigningState",
    "Invoke-CheckedNative",
    "Invoke-InstallerValidationHook",
    "Invoke-PostBuildSigning",
    "Invoke-ProductionValidation",
    "Remove-StaleProductMsis",
    "Set-ReleaseVersionFiles",
    "Test-PublishingMode",
    "Write-ReleaseMetadata"
)
