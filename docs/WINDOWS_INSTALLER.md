# Windows Installer Operator Guide

## Scope and architecture

Preshot ships one English x64 WiX MSI. Tauri CLI 2.11.4 renders the reviewed
downstream template at `src-tauri\wix\main.wxs`; the production scripts build
only the `x86_64-pc-windows-msvc` release target and only the MSI bundle.

The package is limited and per user:

- install directory: `%LOCALAPPDATA%\Programs\Preshot`;
- registration: HKCU only;
- Start Menu shortcut: installed by default;
- Desktop shortcut: opt in with `DESKTOPSHORTCUT=1`;
- elevation and `ALLUSERS`/per-machine installation: rejected.

The MSI owns the application files, its shortcuts, and its HKCU registration.
It does not create, seed, migrate, repair, or remove
`%USERPROFILE%\.preshot`, project directories, `.preshotproj` manifests, or
legacy `.preshot` data. Application startup owns the user-data bootstrap.

The pinned GitHub Copilot SDK stores its managed CLI as an embedded payload in
`preshot.exe`, not as a separate WiX file or sidecar. When that internal
service is used, application runtime extraction creates
`%USERPROFILE%\.preshot\copilot\bin\<version>\copilot.exe`; the MSI does not
own or remove that user-data cache. Release signing still covers the final
Preshot executable and MSI in the existing two-phase order. The MSI also
installs the GitHub Copilot SDK license, GitHub Copilot CLI license, and
third-party notice as application resources. See
[Copilot Rust SDK dependency spike](COPILOT_SDK_SPIKE.md).

`MainProgram` always owns `preshot.exe` and every required application binary.
The optional `Environment` feature owns only the current-user PATH environment
component. Omitting that feature cannot omit the executable, and both Start
Menu and Desktop shortcuts target the mandatory executable component.

## Version and GUID policy

- Release versions are exactly `x.y.z`.
- MSI limits are major/minor `0-255` and patch `0-65535`.
- The fixed per-user UpgradeCode is
  `493c5fb5-639d-4fba-94d3-aebe4eb0dce6`.
- `97ee9b44-6313-52eb-a67e-a1334832eb86` identifies the historical
  machine-wide 0.0.1 lineage and is detect-only; users must uninstall that
  package before installing the per-user lineage.
- WiX generates a new ProductCode and PackageCode for each build.
- Major upgrades use the fixed UpgradeCode, reject downgrades, and remove the
  previous product.
- Same-version builds are not upgrades. Never republish a version; increment
  it before a publish build.
- If machine-wide `0.0.1` was public, the first published per-user release
  must be `0.0.2` or newer. Existing per-user `0.0.1` internal artifacts are
  non-publishable even if they are signed.

Synchronize all version files:

```powershell
pnpm release:set-version -- 0.0.2
```

The command updates the workspace package entry in `Cargo.lock` with an
offline targeted Cargo operation; changing a release version must not require
network access or re-resolve unrelated dependencies.

Publishing automation can reject a same-version/no-op update:

```powershell
pnpm release:set-version -- 0.0.2 --Publish
```

## Production build

Run from a Windows repository checkout:

```powershell
pnpm production:build
```

This checks prerequisites, runs documentation, lint, typecheck, full Vitest,
initializer, production-script, and locked Rust tests, removes safely
identified stale Preshot MSIs, then builds the explicit MSVC x64 MSI.
The executable and MSI are built in two phases so the executable can be signed
before bundling. The bundle phase receives a generated version-only Tauri
configuration overlay, preventing stale cached bundle configuration from
emitting an installer with the previous release version.

For version `<version>`, outputs are:

```text
src-tauri\target\x86_64-pc-windows-msvc\release\preshot.exe
src-tauri\target\x86_64-pc-windows-msvc\release\bundle\msi\Preshot_<version>_x64_en-US.msi
src-tauri\target\x86_64-pc-windows-msvc\release\bundle\msi\Preshot_<version>_x64_en-US.msi.sha256
src-tauri\target\x86_64-pc-windows-msvc\release\bundle\msi\Preshot-<version>-release.json
```

The manifest records target, profile, architecture, commit when available,
timestamp strategy, signing state, both installer lineages, publication
blockers, file sizes, and SHA-256 values. Set
`SOURCE_DATE_EPOCH` for an explicit reproducible timestamp; otherwise the Git
commit timestamp is used, or the timestamp is omitted.

Verify existing artifacts without rebuilding:

```powershell
pnpm production:verify
```

Verification reruns the build matrix plus both Playwright suites, checks MSI
metadata, signatures, checksum, and release manifest, then invokes the
optional non-destructive installer-validation hook. It does not install,
upgrade, repair, or uninstall the product.

## Signing and publish mode

An unsigned or partially signed local build is allowed but is marked
non-publishable in the release manifest. Publish mode requires valid
Authenticode signatures on both `preshot.exe` and the MSI:

Set `PRESHOT_PUBLISH=1` for the publish build and verification:

```powershell
$env:PRESHOT_PUBLISH = "1"
pnpm production:build
pnpm production:verify
```

The equivalent explicit commands are
`pnpm production:build -- --Publish` and
`pnpm production:verify -- --Publish`. Configure either:

- `PRESHOT_SIGN_CERT_SHA1` for a certificate in the Windows certificate
  store; or
- `PRESHOT_SIGN_CERT_FILE` for a certificate file, optionally with
  `PRESHOT_SIGN_CERT_PASSWORD`.

When `PRESHOT_SIGN_CERT_SHA1` is configured, publish verification requires
both the release EXE and MSI to have valid signatures from that exact
certificate and from the same signer. Thumbprint comparison ignores
whitespace and letter case. A different signer, a missing signer thumbprint,
or unavailable signature verification is a publish-blocking failure.
Unsigned local artifacts remain allowed and are marked non-publishable.

Optional signing settings:

- `PRESHOT_SIGNTOOL_PATH`
- `PRESHOT_SIGN_TIMESTAMP_URL`
- `PRESHOT_SIGN_DESCRIPTION`
- `PRESHOT_SIGN_DESCRIPTION_URL`

Do not store certificate passwords in the repository. Tauri's
`bundle.windows.signCommand` may sign during bundling; the post-build signer
skips files that already have valid signatures. The production script builds
the executable without bundling, signs that executable when post-build signing
is configured, bundles the MSI from the signed executable, and then signs the
MSI. This ordering prevents a publishable MSI from containing an unsigned
application binary.

`PRESHOT_INSTALLER_VERIFY_SCRIPT` may name a non-destructive PowerShell hook.
It always receives `-MsiPath` and `-ManifestPath`; `-Publish` is passed only
in publish mode and is omitted for local verification. Paths containing
spaces are preserved. A nonzero hook exit code fails verification. Publish
pipelines should use this hook for organization-specific signature, malware,
or policy checks before any VM installation stage.

## Install, upgrade, repair, and uninstall

Use an elevated shell only if local policy requires it; the package itself is
per user and does not request a machine-wide install.

Before installing, remove any historical machine-wide Preshot entry through
Windows **Installed apps**. The per-user MSI performs a detection-only search
for the historical UpgradeCode and shows localized uninstall-first guidance.
It never attempts elevated automatic removal.

Interactive install with a verbose log:

```powershell
msiexec.exe /i ".\Preshot_0.0.2_x64_en-US.msi" /L*v ".\preshot-install.log"
```

Interactive install with the Desktop shortcut:

```powershell
msiexec.exe /i ".\Preshot_0.0.2_x64_en-US.msi" DESKTOPSHORTCUT=1 /L*v ".\preshot-install.log"
```

Silent install:

```powershell
msiexec.exe /i ".\Preshot_0.0.2_x64_en-US.msi" /qn /norestart /L*v ".\preshot-install-silent.log"
```

Major upgrade to a higher version:

```powershell
msiexec.exe /i ".\Preshot_0.0.3_x64_en-US.msi" /L*v ".\preshot-upgrade.log"
```

Command-line repair, using the installed version's ProductCode:

```powershell
msiexec.exe /famus "{PRODUCT-CODE-GUID}" /qn /norestart /L*v ".\preshot-repair.log"
```

Interactive uninstall:

```powershell
msiexec.exe /x ".\Preshot_0.0.3_x64_en-US.msi" /L*v ".\preshot-uninstall.log"
```

Silent uninstall:

```powershell
msiexec.exe /x "{PRODUCT-CODE-GUID}" /qn /norestart /L*v ".\preshot-uninstall-silent.log"
```

The ProductCode is generated per MSI and can be read from the MSI Property
table or the installed-product registry entry. Windows **Installed apps** is
the normal interactive uninstall route. The MSI intentionally provides no
uninstall shortcut and hides Modify/Repair in Installed apps; command-line
repair remains available to operators.

Do not pass `ALLUSERS`, `MSIINSTALLPERUSER=""`, or other machine-scope
overrides. The package rejects `ALLUSERS`.

## WebView2

The MSI uses Tauri's silent Evergreen WebView2 download-bootstrapper mode. If
a suitable runtime is already registered, installation skips the download.
Otherwise the installer downloads Microsoft's bootstrapper and installs the
runtime silently. A disconnected clean VM therefore needs WebView2
preinstalled or network access during installation.

Both the download and supported embedded-bootstrapper template paths launch the
bootstrapper with PowerShell `Start-Process -PassThru -Wait`. Exit codes `0`,
`1641`, and `3010` are accepted; any other exit code is returned by the custom
action so Windows Installer fails and rolls back the transaction. Production
artifact verification inspects the compiled MSI `FeatureComponents`,
`CustomAction`, `Feature`, `File`, and `Shortcut` tables for these contracts.

## Upgrade, rollback, and data preservation

Current-user lifecycle regression evidence is retained under
`artifacts\msi-installer-regressions`. Before publication, repeat install,
higher-version upgrade, repair, rollback, and uninstall in a disposable
clean-user VM. Confirm:

1. install remains under `%LOCALAPPDATA%\Programs\Preshot`;
2. one Start Menu shortcut exists and Desktop remains absent unless opted in;
3. first app startup creates or adopts user data and opens the starter only
   when no valid project is available;
4. upgrade preserves `%USERPROFILE%\.preshot`, settings, registry metadata,
   projects, and `.preshotproj` files;
5. a forced failed upgrade rolls back application state without deleting user
   data;
6. uninstall removes installer-owned files and shortcuts but preserves all
   user data.

The current-user matrix may cover ordinary install, repair, major upgrade,
downgrade rejection, Desktop opt-in, and uninstall when no unrelated Preshot
installation exists. Forced transactional rollback, cancellation during the
execute sequence, non-admin policy behavior, and missing-WebView2 behavior
remain VM-only coverage.

## Troubleshooting and logs

- Add `/L*v "<path>"` to every `msiexec.exe` command.
- Exit code `0` is success; `1641` and `3010` are successful reboot outcomes.
- A downgrade should fail with the localized downgrade message.
- A historical machine-wide install should fail with the localized instruction
  to uninstall the old machine-wide Preshot first.
- `ALLUSERS` should fail with the per-user-package message.
- Missing WebView2 plus blocked network access fails the bootstrapper custom
  action; preinstall WebView2 and retry.
- SmartScreen warnings are expected for unsigned local artifacts. Published
  artifacts must pass publish-mode signature validation.
- If production tooling cannot find WiX, install compatible WiX tools or set
  `PRESHOT_WIX_ROOT`.
- If MSVC is missing, install Visual Studio 2022 Build Tools with **Desktop
  development with C++**.
- If metadata verification fails, do not edit the checksum or manifest by
  hand; rebuild or restore the exact matching artifacts.

## Updating the pinned Tauri WiX template

Treat the custom template as a reviewed downstream patch:

1. Upgrade `@tauri-apps/cli` to one exact version in `package.json` and the
   pnpm lockfile.
2. Fetch that tag's
   `crates/tauri-bundler/src/bundle/windows/msi/main.wxs`.
3. Record the upstream tag, commit, Git blob, and SHA-256 in the header of
   `src-tauri\wix\main.wxs`.
4. Reapply only the reviewed Preshot differences: x64-only guard, per-user
   limited scope, LocalAppData install directory, HKCU registration,
   `ALLUSERS` rejection, fixed per-user UpgradeCode wiring, detection-only
   historical per-machine Upgrade search and localized LaunchCondition,
   Start Menu default, Desktop opt-in, and no user-data ownership.
5. Reconcile every upstream Handlebars token and WiX sequence change.
6. Update `src\app\packaging\msiConfig.test.ts` and this guide.
7. Run the static, production-script, build, and clean-VM matrices.

Never copy a new upstream template without reviewing the diff. The template
pin and its contract tests are the audit trail. Never replace the per-user
UpgradeCode with Tauri's historical default.

## Future per-machine transition warning

Changing to a per-machine package is not a flag flip. It would change install
location, privileges, registry ownership, shortcut context, servicing, and
upgrade detection. A machine-wide MSI must use a deliberately planned product
family or migration strategy and must coexist with or explicitly migrate the
current per-user product. Do not reuse this package's assumptions or silently
change the fixed UpgradeCode.
