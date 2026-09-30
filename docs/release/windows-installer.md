# Windows Installer Operator Guide

## Scope and architecture

Preshot ships one English x64 WiX MSI. Tauri CLI 2.11.4 renders the reviewed
downstream template at `src-tauri\wix\main.wxs`; the production scripts build
only the `x86_64-pc-windows-msvc` release target and only the MSI bundle.

The package is elevated, machine-wide, and x64-only:

- default install directory: `%ProgramFiles%\Preshot`, normally
  `C:\Program Files\Preshot`, configurable through the MSI directory page;
- installer registration: HKLM; Start Menu shortcut installed for all users;
- Desktop shortcut: opt in with `DESKTOPSHORTCUT=1`;
- `ALLUSERS=1`; per-user overrides are rejected.

The MSI owns only application files, shortcuts, and installation registration.
It never creates, repairs, migrates, or deletes personal configuration, live
materials, or projects. Uninstall preserves unknown user files even within the
application directory, which can therefore remain nonempty.

The finish page offers **Launch Preshot**. Its launcher returns to the desktop
user's token/environment before initializing the application. First launch asks
for the working directory, defaulting to `%USERPROFILE%\.preshot`. It stores
preferences, project paths, default projects and the material library. A fixed
per-user `profile.json` locator remembers this choice across reinstall.
See [storage settings](../features/settings.md) and the
[storage implementation design](../development/installation-storage-design.md).

`MainProgram` always owns `preshot.exe` and every required application binary.
The optional `Environment` feature owns only the system PATH environment
component. Omitting that feature cannot omit the executable, and both Start
Menu and Desktop shortcuts target the mandatory executable component.

## Version and GUID policy

- Release versions are exactly `x.y.z`.
- MSI limits are major/minor `0-255` and patch `0-65535`.
- The fixed machine-wide UpgradeCode is
  `c91f6bc2-1f30-4d43-b878-3d09737227f2`.
- `493c5fb5-639d-4fba-94d3-aebe4eb0dce6` is the previous per-user family.
- `97ee9b44-6313-52eb-a67e-a1334832eb86` is historical machine-wide `0.0.1`.
- Both old families are detect-only and require uninstall first. Their user
  data is retained. HKCU installation-path detection supplements the per-user
  Upgrade row because MSI upgrade detection does not span every install context.
- Other accounts' per-user packages cannot be automatically migrated. Uninstall
  those in the owning account, and do not run old and new apps on the same profile.
- WiX generates ProductCode/PackageCode; future major upgrades keep the new
  UpgradeCode stable and reject downgrades. Never republish the same version.
- The first publishable version of the new family is `0.0.14`.

Synchronize all version files:

```powershell
pnpm release:set-version -- 0.0.15
```

The command updates the workspace package entry in `Cargo.lock` with an
offline targeted Cargo operation; changing a release version must not require
network access or re-resolve unrelated dependencies.

Publishing automation can reject a same-version/no-op update:

```powershell
pnpm release:set-version -- 0.0.15 --Publish
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

Setup requires administrator elevation. Normal application use does not.
Before switching from either previous installer family, close Preshot and remove
that package from Windows **Installed apps**. Existing user configuration,
projects, and materials survive uninstall. Then install the new family.

The interactive directory page and the public `INSTALLDIR` property configure
the program directory. For example, add `INSTALLDIR="D:\Apps\Preshot"` to the
installation command. The working directory is selected on first application launch,
not through elevated MSI actions. Reinstalling elsewhere retains the saved data path.

Interactive install with a verbose log:

```powershell
msiexec.exe /i ".\Preshot_0.0.15_x64_en-US.msi" /L*v ".\preshot-install.log"
```

Interactive install with the Desktop shortcut:

```powershell
msiexec.exe /i ".\Preshot_0.0.15_x64_en-US.msi" DESKTOPSHORTCUT=1 /L*v ".\preshot-install.log"
```

Silent install:

```powershell
msiexec.exe /i ".\Preshot_0.0.15_x64_en-US.msi" /qn /norestart /L*v ".\preshot-install-silent.log"
```

Major upgrade to a higher version:

```powershell
msiexec.exe /i ".\Preshot_0.0.15_x64_en-US.msi" /L*v ".\preshot-upgrade.log"
```

Command-line repair, using the installed version's ProductCode:

```powershell
msiexec.exe /famus "{PRODUCT-CODE-GUID}" /qn /norestart /L*v ".\preshot-repair.log"
```

Interactive uninstall:

```powershell
msiexec.exe /x ".\Preshot_0.0.15_x64_en-US.msi" /L*v ".\preshot-uninstall.log"
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

Do not pass `MSIINSTALLPERUSER` or override `ALLUSERS=1`. The package rejects
per-user installation overrides.

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

The new machine-wide family requires a disposable clean-user VM matrix before
publication. Earlier per-user evidence does not validate this family. Confirm:

1. Program Files defaults, custom directory selection, and standard-user UAC.
2. Start Menu default and Desktop opt-in; the editor never starts elevated.
3. First launch adopts legacy workspace metadata and existing materials, or
   initializes the selected working directory and its library through first-run setup.
4. Reinstalling to another directory restores the same project list and library.
5. Higher-version upgrade, repair, cancelled install, and forced rollback touch
   only installer-owned application files and registration.
6. Interactive and silent uninstall preserve personal configuration, materials,
   projects, and unexpected user files in the program directory.
7. Different administrator credentials and two Windows accounts do not cross
   profile ownership; old per-user packages receive uninstall-first guidance.

Do not run this destructive lifecycle matrix on the development workstation.
Static/compiled MSI inspection and native temporary-root storage tests are
non-destructive checks, not substitutes for the VM matrix.

## Troubleshooting and logs

- Add `/L*v "<path>"` to every `msiexec.exe` command.
- Exit code `0` is success; `1641` and `3010` are successful reboot outcomes.
- A downgrade should fail with the localized downgrade message.
- A historical machine-wide install should fail with the localized instruction
  to uninstall the old machine-wide Preshot first; old per-user installations have separate guidance.
- Per-user overrides should fail with the machine-wide-package message.
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
4. Reapply the reviewed x64 machine-wide scope, configurable Program Files
   directory, HKLM registration, fixed new UpgradeCode, detect-only historical
   families, no elevated application launch, mandatory executable, Desktop
   opt-in, and no user-data ownership.
5. Reconcile every upstream Handlebars token and WiX sequence change.
6. Update `src\app\packaging\msiConfig.test.ts` and this guide.
7. Run the static, production-script, build, and clean-VM matrices.

Never copy a new upstream template without reviewing the diff. The template
pin and contract tests are the audit trail. Never repurpose a historical
UpgradeCode or rely on a scope flag change to migrate another installation.
