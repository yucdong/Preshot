# Windows MSI Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `pnpm tauri:build` on Windows emit a `Preshot_<ver>_x64_en-US.msi` that installs to Program Files with Start Menu + Desktop shortcuts and a clean uninstall.

**Architecture:** Pure packaging — configure Tauri's WiX (MSI) bundler in `src-tauri/tauri.conf.json` and add one WiX fragment (`src-tauri/wix/shortcuts.wxs`) for the Desktop shortcut (Start Menu shortcut is Tauri's default). No Rust logic; `~/.preshot` is created by the app at runtime (theming settings command). A lightweight Vitest config-contract test guards that the config references a well-formed fragment whose `ComponentGroup` Id matches `componentGroupRefs`.

**Tech Stack:** Tauri v2 WiX (WiX Toolset v3) MSI target; JSON config; WiX XML fragment; Vitest (jsdom `DOMParser`) for the config-contract test.

## Global Constraints

- Package manager pnpm; do not add npm/Yarn lock files.
- Windows-first. The MSI target only builds on Windows; `pnpm tauri:build` needs the MSVC toolchain with `vcvars64.bat` sourced in the same shell, WebView2, and WiX v3 (Tauri downloads WiX automatically).
- No system-PATH modification; unsigned MSI (SmartScreen warning acceptable this phase); per-machine install, per-user `~/.preshot` created at runtime.
- Identifier `com.yucdong.preshot`; productName `Preshot` (installed exe is `Preshot.exe`); version from `tauri.conf.json` (`0.1.0`).
- Commit trailer on every commit:
  `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`
- Do not regress existing suites: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `cargo test --manifest-path src-tauri\Cargo.toml`, `pnpm build` must all stay green.

## File Structure

- **Modify** `src-tauri/tauri.conf.json` — set `bundle.targets` to `["msi"]`, add `bundle.publisher`, and add `bundle.windows.wix` (`language`, `fragmentPaths`, `componentGroupRefs`). One responsibility: bundle configuration.
- **Create** `src-tauri/wix/shortcuts.wxs` — a WiX `<Fragment>` adding the Desktop shortcut, exposing `<ComponentGroup Id="DesktopShortcuts">`.
- **Create** `src/app/packaging/msiConfig.test.ts` — a Vitest config-contract test that parses the JSON + XML and asserts they agree (fragment path exists, `componentGroupRefs` matches the fragment's `ComponentGroup` Id, Desktop shortcut targets `[INSTALLDIR]Preshot.exe`, language `en-US`).
- **Modify** `docs/design_docs/featurelist.json` — add the MSI Installer feature entry.

---

### Task 1: WiX MSI configuration + Desktop-shortcut fragment + config-contract test

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Create: `src-tauri/wix/shortcuts.wxs`
- Create: `src/app/packaging/msiConfig.test.ts`

**Interfaces:**
- Produces: a `bundle.windows.wix` config whose `componentGroupRefs` includes
  `"DesktopShortcuts"` matching `<ComponentGroup Id="DesktopShortcuts">` in the
  fragment; `fragmentPaths` includes `"./wix/shortcuts.wxs"`; `language`
  includes `"en-US"`. The Desktop shortcut targets `[INSTALLDIR]Preshot.exe`.

- [ ] **Step 1: Write the failing config-contract test**

Create `src/app/packaging/msiConfig.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const conf = JSON.parse(
  readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"),
) as {
  bundle?: {
    targets?: unknown;
    windows?: { wix?: { language?: unknown; fragmentPaths?: unknown; componentGroupRefs?: unknown } };
  };
};
const wxs = readFileSync(resolve(root, "src-tauri/wix/shortcuts.wxs"), "utf8");

describe("MSI bundle configuration", () => {
  it("targets the msi bundle", () => {
    expect(conf.bundle?.targets).toEqual(["msi"]);
  });

  it("configures the WiX installer for en-US with the shortcuts fragment", () => {
    const wix = conf.bundle?.windows?.wix;
    expect(wix?.language).toContain("en-US");
    expect(wix?.fragmentPaths).toContain("./wix/shortcuts.wxs");
    expect(wix?.componentGroupRefs).toContain("DesktopShortcuts");
  });

  it("ships a well-formed fragment whose ComponentGroup matches componentGroupRefs", () => {
    const doc = new DOMParser().parseFromString(wxs, "application/xml");
    expect(doc.querySelector("parsererror")).toBeNull();

    const group = doc.querySelector('ComponentGroup[Id="DesktopShortcuts"]');
    expect(group).not.toBeNull();

    const componentRef = group?.querySelector('ComponentRef[Id="ApplicationShortcutDesktop"]');
    expect(componentRef).not.toBeNull();

    const shortcut = doc.querySelector('Shortcut[Id="DesktopShortcut"]');
    expect(shortcut?.getAttribute("Target")).toBe("[INSTALLDIR]Preshot.exe");
    // The Desktop shortcut is created under the standard DesktopFolder.
    expect(doc.querySelector('DirectoryRef[Id="DesktopFolder"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/app/packaging/msiConfig.test.ts`
Expected: FAIL — `src-tauri/wix/shortcuts.wxs` does not exist / config lacks the wix block.

- [ ] **Step 3: Create the WiX fragment**

Create `src-tauri/wix/shortcuts.wxs`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
  <Fragment>
    <DirectoryRef Id="DesktopFolder">
      <Component Id="ApplicationShortcutDesktop" Guid="*">
        <Shortcut
          Id="DesktopShortcut"
          Name="Preshot"
          Description="Preshot photography planning"
          Target="[INSTALLDIR]Preshot.exe"
          WorkingDirectory="INSTALLDIR" />
        <RemoveFolder Id="DesktopRemoveFolder" On="uninstall" />
        <RegistryValue
          Root="HKCU"
          Key="Software\com.yucdong.preshot"
          Name="DesktopShortcut"
          Type="integer"
          Value="1"
          KeyPath="yes" />
      </Component>
    </DirectoryRef>

    <ComponentGroup Id="DesktopShortcuts">
      <ComponentRef Id="ApplicationShortcutDesktop" />
    </ComponentGroup>
  </Fragment>
</Wix>
```

Notes for the implementer:
- `DesktopFolder` and `INSTALLDIR` are provided by Tauri's main WiX template — do
  NOT redeclare them.
- `Target="[INSTALLDIR]Preshot.exe"` uses the installed exe path (productName is
  `Preshot`), avoiding any dependency on Tauri's internal File Id.
- `Guid="*"` auto-generates a stable per-component GUID; the `RegistryValue`
  keypath is the WiX per-user-shortcut convention; `RemoveFolder` cleans up on
  uninstall.

- [ ] **Step 4: Update `tauri.conf.json`**

In `src-tauri/tauri.conf.json`, replace the `bundle` block:

```json
  "bundle": {
    "active": true,
    "targets": ["msi"],
    "publisher": "yucdong",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "windows": {
      "wix": {
        "language": ["en-US"],
        "fragmentPaths": ["./wix/shortcuts.wxs"],
        "componentGroupRefs": ["DesktopShortcuts"]
      }
    }
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run src/app/packaging/msiConfig.test.ts`
Expected: PASS.

- [ ] **Step 6: Validate the config still parses & typechecks**

Run: `node -e "JSON.parse(require('fs').readFileSync('src-tauri/tauri.conf.json','utf8')); console.log('conf ok')"`
Run: `pnpm typecheck`
Expected: `conf ok`; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/tauri.conf.json src-tauri/wix/shortcuts.wxs src/app/packaging/msiConfig.test.ts
git commit -m "feat(bundle): configure WiX MSI target with a Desktop shortcut

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Build verification + featurelist + full matrix

**Files:**
- Modify: `docs/design_docs/featurelist.json`

- [ ] **Step 1: Build the MSI**

Source vcvars64 and Cargo into the same shell, then build. In PowerShell:

```
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
& $env:ComSpec /c 'call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul && cd /d C:\projects\Preshot && pnpm tauri:build'
```

(Adjust the vcvars64.bat path to the installed VS edition — Community/BuildTools/Professional.)
Expected: a release build followed by WiX packaging. This is slow (several
minutes) and downloads WiX v3 on first run.

- [ ] **Step 2: Assert the MSI exists and is non-trivial**

Run:
```
Get-ChildItem src-tauri\target\release\bundle\msi\*.msi | Select-Object Name, @{n='MB';e={[math]::Round($_.Length/1MB,2)}}
```
Expected: exactly one `Preshot_0.1.0_x64_en-US.msi` (name may vary by locale/arch),
size well above 1 MB. Record the path + size.

If the build FAILS due to a missing toolchain (WiX/WebView2/VS) in this
environment, capture the exact error, and treat the MSI build as
environment-blocked: the config-contract test (Task 1) plus the manual checklist
below stand as the deliverable. Document the blocker in the featurelist
`lastVerified.msiBuild` field (e.g., `"blocked: <reason>"`) rather than claiming a
false success.

- [ ] **Step 3: Update `featurelist.json`**

Add a new object to the `features` array (after the Undo / Redo entry), mirroring
the existing entry shape. Content:
- name: `"Windows MSI Installer"`.
- feature_descriptions: `pnpm tauri:build` emits a WiX MSI; installs to Program
  Files; Start Menu (default) + Desktop (fragment) shortcuts; Add/Remove Programs
  uninstall; unsigned; no PATH change; `~/.preshot` created by the app at runtime.
- decisions: MSI (WiX v3) target not NSIS; Desktop shortcut via
  `wix.fragmentPaths` + `componentGroupRefs: ["DesktopShortcuts"]`; `en-US`
  installer; publisher `yucdong`; unsigned (signing = follow-up).
- completed: T1 config + fragment + contract test; T2 build verification +
  featurelist + matrix.
- lastVerified: fill from the actual matrix; add an `msiBuild` field with the
  result (path+size, or the environment-blocked reason).
- remaining: code-signing the MSI (SmartScreen), optional `zh-CN` installer UI,
  optional branded banner/dialog art.

Validate JSON:
`node -e "JSON.parse(require('fs').readFileSync('docs/design_docs/featurelist.json','utf8')); console.log('valid')"`

- [ ] **Step 4: Run the full validation matrix**

```
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
cargo test --manifest-path src-tauri\Cargo.toml
pnpm build
```
All must pass (lint may show the single pre-existing `ThemeProvider.tsx`
react-refresh warning). Record counts into `featurelist.json` `lastVerified`.

- [ ] **Step 5: Commit**

```bash
git add docs/design_docs/featurelist.json
git commit -m "test(bundle): verify MSI build and record matrix for the installer

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

**Manual install checklist (documented, run once on a real Windows box):**
1. Double-click the MSI → installs without unexpected elevation.
2. Start Menu shows "Preshot"; Desktop shows a "Preshot" shortcut; both launch the app.
3. The app window opens and `~/.preshot` is created on first run.
4. Add/Remove Programs lists "Preshot"; uninstall removes the app and both shortcuts.

---

## Self-Review

**1. Spec coverage:**
- WiX MSI target → Task 1 (`targets: ["msi"]`, `bundle.windows.wix`). ✓
- Program Files install + Start Menu shortcut → Tauri defaults (no work). ✓
- Desktop shortcut → Task 1 (`wix/shortcuts.wxs` + `componentGroupRefs`). ✓
- Clean uninstall → `RemoveFolder On="uninstall"` + MSI default uninstaller. ✓
- `~/.preshot` at runtime → already handled by theming; no installer action. ✓
- No PATH, unsigned, en-US → Task 1 config + documented limitations. ✓
- Build produces exactly one `.msi`, verified → Task 2. ✓
- Config validation (JSON parses, fragment well-formed) → Task 1 contract test. ✓
- Existing suites stay green → Task 2 full matrix. ✓

**2. Placeholder scan:** No TBD/TODO; the fragment and config are complete
verbatim. The only conditional is the vcvars64 path (environment-specific, must
be resolved to the installed VS edition) and the environment-blocked fallback for
the heavy MSI build — both are explicit, not placeholders.

**3. Type/name consistency:** `DesktopShortcuts` (ComponentGroup Id) ==
`componentGroupRefs` entry; `ApplicationShortcutDesktop` (Component Id) ==
`ComponentRef` Id; `DesktopShortcut` (Shortcut Id) and
`Target="[INSTALLDIR]Preshot.exe"` are asserted identically in the contract test
and defined identically in the fragment; `./wix/shortcuts.wxs` path matches the
created file location (`src-tauri/wix/shortcuts.wxs`, relative to
`tauri.conf.json`). ✓
