# Windows MSI Installer — Design

PRD sub-project 5. Produce a Windows `.msi` that installs Preshot to Program
Files with Start Menu + Desktop shortcuts and a clean uninstall, built from the
existing Tauri (WiX) bundler.

## Goal

Running `pnpm tauri:build` on Windows produces a signed-optional `Preshot_<ver>_x64_en-US.msi`
that: installs the app to Program Files, creates a Start Menu shortcut and a
Desktop shortcut, registers an uninstaller (Add/Remove Programs), and launches a
GUI app that creates `~/.preshot` on first run (already handled by the settings
command). No system-PATH modification.

## Decisions (from brainstorming)

- **Bundler:** Tauri's **MSI (WiX v3)** target (the PRD says `.msi`), not NSIS.
- **Install:** Program Files (per-machine default), Start Menu shortcut (Tauri
  default) + **Desktop shortcut** (WiX fragment), standard uninstall.
- **`~/.preshot`:** created by the **app on first run** (the theming settings
  command owns it), not by the installer — keeps the installer per-machine while
  the config is per-user.
- **No PATH**, **no forced signing** (unsigned MSI for now; signing is a later,
  cert-dependent step).

## Architecture / Changes

Almost entirely configuration + a WiX fragment; minimal/zero Rust logic.

### `src-tauri/tauri.conf.json`

- `bundle.targets`: set to `["msi"]` (or keep `"all"` but ensure msi is built on
  Windows).
- `bundle.windows.wix`:
  - `language`: `["en-US"]` (add `zh-CN` later if desired).
  - `fragmentPaths`: `["./wix/shortcuts.wxs"]` — a WiX fragment adding the
    **Desktop shortcut** (Start Menu is default).
  - Optionally `bannerPath`/`dialogImagePath` for branded installer art (reuse
    an icon-derived bitmap; optional this phase).
- Confirm `productName` (Preshot), `version` (from `Cargo.toml`/conf), `identifier`
  (`com.yucdong.preshot`), publisher, and `icon` set (icons already present).

### `src-tauri/wix/shortcuts.wxs` (new)

- A minimal WiX `<Fragment>` that adds a `<Shortcut>` to the Desktop folder
  (`DesktopFolder`) targeting the installed exe, with an icon, plus the required
  `RegistryValue` keypath (WiX per-user shortcut convention). Referenced from
  `wix.fragmentPaths`.

### App first-run (already implemented via theming)

- The settings `read_settings`/`write_settings` commands create `~/.preshot`
  when missing; the app touches settings on launch, so `~/.preshot` exists after
  first run. No installer custom action needed. (If theming isn't merged yet when
  MSI ships, add a tiny ensure-`~/.preshot` call on startup.)

## Build & Verification

- **Prerequisites (Windows):** Rust MSVC toolchain + `vcvars64.bat` in the build
  shell, WebView2, and WiX v3 (Tauri downloads/uses it). `pnpm tauri:build`
  (`beforeBuildCommand: pnpm build`) compiles the release binary and emits the MSI
  under `src-tauri/target/release/bundle/msi/`.
- **Verify:** the build completes and produces exactly one `*.msi`; log its path
  and size. Automated CI-style assertion: the MSI file exists and is non-trivial
  in size after `tauri:build`.
- **Manual install checklist (documented, run once):** MSI installs without
  elevation prompts beyond standard; Start Menu + Desktop shortcuts launch the
  app; the app window opens and `~/.preshot` is created; uninstall via Add/Remove
  Programs removes the app and shortcuts.

## Error Handling / Risks

- **WiX/toolchain not present:** `tauri:build` fails clearly; the spec lists the
  prerequisites (VS Build Tools + vcvars, WebView2, WiX). If WiX v3 EOL causes
  issues, fall back to the NSIS target as a documented alternative (still `.exe`
  installer) — but MSI is the target.
- **Desktop shortcut fragment errors** surface at build (WiX validation); the
  fragment is kept minimal and validated by a successful build.
- Unsigned MSI shows a SmartScreen warning — acceptable for now; signing is a
  documented follow-up.

## Testing

- **Build test:** a scripted `pnpm tauri:build` (or `cargo tauri build`) run that
  asserts an `*.msi` is produced (the primary automated check). Given its cost,
  this may run as a dedicated verification step rather than in the unit suite.
- **Config validation:** `tauri.conf.json` parses and the WiX fragment is
  well-formed XML (a lightweight parse check).
- No app-logic unit tests (this is packaging); existing suites stay green.

## Documented Limitations

- Unsigned installer (SmartScreen warning) until code-signing is set up. Per-
  machine install; per-user `~/.preshot` created at runtime. English installer UI
  this phase.
