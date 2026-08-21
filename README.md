# Preshot

Preshot is a Windows-first desktop application for photography planning. The current application is not just a shell: it opens local projects, edits plans in a BlockNote 0.53 document, manages image groups and native media, and exports PDF, DOCX, and long-image files.

> The application UI is currently localized in Simplified Chinese. This documentation is written in English on purpose; do not treat Chinese UI copy as missing translation work unless the task is explicitly about localization.

## Current product surface

- Recent-project launcher and in-app project rail
- BlockNote v14 editor (`schemaVersion: 14`, `document.format: "preshot-blocks"`, `document.version: 2`)
- Slash menu, block drag, undo/redo, headings, lists, checklists, toggles, quotes, code blocks, tables, and dividers
- Multi-column blocks via `@blocknote/xl-multi-column@0.53.0`
- Custom image-group blocks with resize, reorder, lightbox, native import, and Windows screen capture
- Transactional live image-drag preview with pointer and keyboard sensors,
  same-/cross-/empty-group reflow, source and insertion placeholders, and
  zoom-safe edge auto-scroll
- Native BlockNote image, video, and audio blocks backed by project-local `media/`
- Auto-save, explicit save shortcut, theme settings, resizable shell panels, and focus mode
- A4 PDF export through `@blocknote/xl-pdf-exporter@0.53.0` and
  `@react-pdf/renderer@4.3.0`, with offline project-local asset preflight and a
  native save dialog
- Editable DOCX export through `@blocknote/xl-docx-exporter@0.53.0` and
  `docx@9.6.1`, including offline native images, weighted columns, and
  composited image groups
- Offline long-image export through an export-only 900px BlockNote DOM surface
  and `modern-screenshot@4.7.0`, with JPEG/PNG presets, 890px compatibility,
  opt-in block/row-aware automatic splitting, adaptive JPEG quality, native batch
  save, and no effect on PDF or DOCX output

## Long-image export contract

BlockNote 0.53 does not provide a long-image exporter. Preshot therefore
mounts the shared schema-14 document on a control-free export-only DOM surface,
scales the 1080px editor geometry to 900px by default (or the explicit 890px
compatibility width), and captures bounded segments with
`modern-screenshot@4.7.0`.

The default **WeChat compatible** preset emits JPEG, targets at most 6000px and
1 MiB per part, starts at quality 0.84, and searches no lower than 0.68 before
splitting earlier. **High quality** JPEG targets 8000px / 3 MiB, while
**Lossless PNG** targets 4000px / 8 MiB. These are conservative empirical
compatibility targets, not official WeChat acceptance limits; client-side
recompression and platform behavior can change independently.

Every preset stops at 32 parts. The exporter may retain at most 24 MiB for
WeChat JPEG, 48 MiB for high-quality JPEG, or 64 MiB for lossless PNG. Desktop
saving preflights a separate 64 MiB raw-image ceiling before creating base64
or sending the single rollback-safe Tauri IPC batch; Rust repeats the count and
byte checks before allocation and after decode.

By default, the entire document remains one image. If that output would exceed
the safe single-image limits, export fails actionably instead of silently
splitting; the user can enable automatic splitting, shorten the plan, or export
PDF/DOCX. When enabled, automatic splitting prefers complete top-level block
boundaries and splits an oversized image group only between complete wrapped
rows. Parts are contiguous, captured sequentially, and named `<project>.jpg` or
`<project>-01.jpg`, `<project>-02.jpg`, and so on (with matching PNG names).
Generated project-title bases are normalized to Unicode NFC and capped at 120
code points and 120 UTF-16 code units. Final generated or dialog-selected file
components are capped at 128 UTF-16 code units, leaving room for `-01` through
`-32`, the extension, and the atomic writer's temporary suffix. A valid
dialog rename becomes the authoritative output base.
The exporter rejects external assets and hosted proxies, bounds canvas and
decoded memory, releases canvases/workers/offscreen roots after every outcome,
and surfaces failures rather than silently reducing width or quality.

The top-right **Export** menu opens a settings dialog for preset, JPEG/PNG,
900/890px width, and automatic splitting. Splitting starts unchecked on every
dialog open and changing preset, format, or width does not enable it. Desktop
saving uses one native dialog to choose the destination/base, commits all
numbered siblings as a rollback-safe batch, and opens the project directory
only after success. Browser and Midscene download one-part output; their
multi-part path is an explicit typed no-op test adapter because the application
does not ship an archive dependency.

## Repository layout

- `src/app` application composition, shell, theme, and workspace provider
- `src/features` React feature surfaces, especially the BlockNote plan editor and workspace UI
- `src/domain` pure models, use cases, ports, schema validation, and shared layout logic
- `src/infrastructure` Tauri/browser adapters and PDF/DOCX export wiring
- `src-tauri` Rust commands and Tauri configuration
- `docs` architecture, testing, reliability, and design documentation
- `e2e` Playwright smoke coverage
- `init.ps1` Windows prerequisite check and dependency installation

## Project and storage model

- Each project directory contains `.preshotproj` (legacy `.preshot` is still read and migrated).
- The project manifest has `schemaVersion: 1` and stores the plan JSON in `manifest.plan`.
- The active plan format is schema v14 / document v2.
- Reference image files live under `references/`.
- Native BlockNote media files live under `media/`.
- Theme and shell settings are stored in `%USERPROFILE%\.preshot\settings.json`.
- New-project picking defaults to `%USERPROFILE%\.preshot\projects`.
- On startup, the application creates those user-owned roots when absent,
  adopts an existing valid default-root project when possible, or creates and
  opens one editable localized starter project.

## Tech stack

- React 19, TypeScript, Vite
- Tauri 2, Rust
- BlockNote 0.53, Mantine 8
- Tailwind CSS 4
- `@blocknote/xl-pdf-exporter@0.53.0` + `@react-pdf/renderer@4.3.0`
- `@blocknote/xl-docx-exporter@0.53.0` + `docx@9.6.1` for the production DOCX
  exporter, offline resolver, custom image-group compositor, and ZIP packing
- `modern-screenshot@4.7.0` for the production offline long-image DOM capture
  adapter and same-origin worker
- `pdf-lib` + `@pdf-lib/fontkit` retained only by the explicit rollback adapter
- Vitest, React Testing Library, Playwright
- dnd-kit 6/10 for the production image-tile drag context and sensors
- pnpm 10.15.0

## Live image drag contract

Reference-image reordering is a preview transaction, not a sequence of plan
writes. dnd-kit owns one pointer/keyboard context around the active BlockNote
surface. A drag snapshots the ordered groups and decoded active image, then
projects same-group, cross-group, end-position, or empty-group layouts from
that immutable snapshot. The source keeps a dashed placeholder, the body-level
overlay preserves the image crop and frame ratio, and the target reflows with
authoritative frame sizes, wrap-before-overflow geometry, and no implicit
shrinking.

The preview never mutates `plan.imageGroups`, marks the project dirty, reaches
autosave, or feeds PDF, DOCX, or long-image export. Escape, invalid/outside
release, pointer cancellation, focus/visibility loss, project or plan revision
change, group/image deletion, and decoded-asset change restore the snapshot.
A valid release applies exactly one normalized move, creates one undo boundary,
marks the plan unsaved, and lets the normal 5-second autosave, Ctrl/Cmd+S, and
project-retirement flush persist the committed order. All three exporters read
that committed order only.

Mouse activation requires 6px movement; touch/pen uses a 180ms delay with 6px
tolerance. Keyboard users press Space to pick up, use arrows or Home/End within
a group, Ctrl/Cmd+Arrow to change groups, Space/Enter to drop, and Escape to
cancel. Group movement follows visible recursive document order, not metadata
array order; a hidden focus anchor keeps keyboard input stable while the active
tile becomes a placeholder, then focus returns to the image after cancel/drop.
A Simplified-Chinese polite live region announces selection, pickup, projected
position, boundaries, commit, and rollback. Pointer dragging uses the latest
physical pointer in a single 48px edge band around the central scroller and
remeasures drop geometry after scrolling; keyboard dragging never auto-scrolls.
CSS zoom from 55%-180%, `prefers-reduced-motion`, decoded-image gating, and
stale transaction cancellation are covered explicitly.

Non-goals are multi-image dragging, image swapping, freeform placement,
persisting preview geometry, exporting a preview, or reviving the removed
component-local pointer implementation and its `data-image-drop-target`
marker.

## Windows prerequisites

1. Windows 10 version 1803 or later
2. Node.js 20.19.0+ on the 20.x line, or Node.js 22.12.0+
3. pnpm 10.15.0
4. Rust stable with the MSVC target
5. Visual Studio 2022 Build Tools with **Desktop development with C++**
6. Microsoft Edge WebView2 Runtime

Install pnpm:

```powershell
corepack enable
corepack prepare pnpm@10.15.0 --activate
```

If Corepack is unavailable in your environment:

```powershell
corepack disable
npm install --global pnpm@10.15.0
```

Install Rust:

```powershell
winget install --id Rustlang.Rustup --exact
```

## Setup

Run the repository initializer from the repository root:

```powershell
.\init.ps1
```

The script validates Node.js, pnpm, Rust, Cargo, Visual C++ Build Tools, and WebView2, then runs `pnpm install --frozen-lockfile`.

`pnpm tauri`, `pnpm tauri:dev`, and `pnpm tauri:build` run through `scripts\tauri.ps1`, which auto-discovers Cargo in `%USERPROFILE%\.cargo\bin` when the current VS Code `PATH` has not refreshed yet. If Rust is installed elsewhere, add that Cargo directory to `PATH` and restart your terminal or editor.

If another `link.exe` shadows the Visual Studio toolchain, run Tauri or Cargo commands from **Developer PowerShell for VS 2022**.

## MSI installation contract

The x64 MSI is built with the source-controlled
`src-tauri\wix\main.wxs` template, pinned to the Tauri CLI 2.11.4 upstream
template. It is a limited per-user package installed under
`%LOCALAPPDATA%\Programs\Preshot`; attempts to set `ALLUSERS` are rejected.
The package owns only application files, Start Menu/Desktop shortcuts, and
HKCU application registration. `%USERPROFILE%\.preshot`, `.preshotproj`
projects, legacy `.preshot` data, settings, and workspace metadata are never
installer-owned or removed. The application, not the MSI, performs the
first-start user-data bootstrap and creates the default starter only when no
valid registered or default-root project is available.

The per-user lineage uses UpgradeCode
`493c5fb5-639d-4fba-94d3-aebe4eb0dce6`. If the historical machine-wide
lineage `97ee9b44-6313-52eb-a67e-a1334832eb86` is installed, the MSI blocks
with localized guidance to uninstall it through Windows **Installed apps**;
the limited installer never attempts elevated removal. If machine-wide
`0.0.1` was public, the first publishable per-user version is `0.0.2`.

The Start Menu shortcut is installed by default. The Desktop shortcut is an
opt-in public MSI feature:

```powershell
msiexec.exe /i ".\Preshot_0.0.2_x64_en-US.msi" DESKTOPSHORTCUT=1
```

Install a higher version with the same `/i` form for a major upgrade. Repair
and uninstall are also available to operators:

```powershell
msiexec.exe /i ".\Preshot_0.0.3_x64_en-US.msi"
msiexec.exe /famus "{PRODUCT-CODE-GUID}" /qn /norestart
msiexec.exe /x ".\Preshot_0.0.3_x64_en-US.msi"
```

Uninstall through Windows **Installed apps** / Add or Remove Programs for the
normal interactive flow. The MSI does not create an uninstall shortcut.
Install, upgrade, repair, and uninstall preserve `%USERPROFILE%\.preshot`.

## Commands

### Development and packaging

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the browser-only Vite development server. |
| `pnpm preview` | Preview the built web bundle. |
| `pnpm tauri` | Run the local Tauri CLI through the Windows wrapper. |
| `pnpm tauri:dev` | Start the desktop application in Tauri development mode. |
| `pnpm build` | Run the TypeScript build and Vite production build. |
| `pnpm tauri:build` | Build Windows desktop bundles. |
| `pnpm production:build` | Validate the release matrix and build the explicit MSVC x64 release MSI. |
| `pnpm production:verify` | Re-run the full matrix, including E2E and installer validation, against existing release artifacts without rebuilding. |

### Validation

| Command | Purpose |
| --- | --- |
| `pnpm docs:check` | Check English-only docs, feature-list JSON, local links, and stale canonical references. |
| `pnpm lint` | Run ESLint. |
| `pnpm typecheck` | Run the TypeScript project build in type-check mode. |
| `pnpm test` | Run the Vitest suite. |
| `pnpm test:watch` | Run Vitest in watch mode. |
| `pnpm test:init` | Run the PowerShell initializer regression harness. |
| `pnpm test:production-scripts` | Run isolated production/release script fixtures. |
| `pnpm test:e2e` | Run the main Playwright browser-shell smoke suite. |
| `pnpm test:e2e:blocknote` | Run the focused BlockNote v14 Playwright suite. |
| `pnpm test:e2e:capture` | Run the isolated long-image DOM-capture acceptance suite. |
| `cargo test --manifest-path src-tauri\Cargo.toml` | Run the Rust unit tests. |

### Midscene and AI-assisted workflows

| Command | Purpose |
| --- | --- |
| `pnpm dev:midscene` | Start the dedicated Vite server for Midscene-driven browser tests. |
| `pnpm midscene:proxy` | Start the local Midscene Responses-API bridge. |
| `pnpm midscene:model:verify` | Verify the configured Midscene model connection. |
| `pnpm midscene:smoke` | Run the read-only Midscene smoke against a running app. |
| `pnpm test:midscene:web` | Run the serialized Midscene web suite. |
| `pnpm midscene:report:merge` | Merge Midscene HTML/text reports. |

### Maintenance

| Command | Purpose |
| --- | --- |
| `pnpm migrate:project` | Run the project-manifest migration utility. |
| `pnpm release:set-version -- <x.y.z>` | Synchronize package, Tauri, Cargo, and lockfile release versions within MSI limits. |

### Release signing and metadata

`production:build` writes an MSI SHA-256 sidecar and deterministic release
manifest beside the installer. It uses `SOURCE_DATE_EPOCH` when set, otherwise
the Git commit timestamp, and omits the timestamp when neither is available.
For version `<version>`, the paths are:

```text
src-tauri\target\x86_64-pc-windows-msvc\release\preshot.exe
src-tauri\target\x86_64-pc-windows-msvc\release\bundle\msi\Preshot_<version>_x64_en-US.msi
src-tauri\target\x86_64-pc-windows-msvc\release\bundle\msi\Preshot_<version>_x64_en-US.msi.sha256
src-tauri\target\x86_64-pc-windows-msvc\release\bundle\msi\Preshot-<version>-release.json
```

Local unsigned or partially signed builds are labeled non-publishable. Set
`PRESHOT_PUBLISH=1` or run `pnpm production:build -- --Publish` and
`pnpm production:verify -- --Publish` to require valid Authenticode signatures
on both the executable and MSI.

Tauri's documented `bundle.windows.signCommand` can sign during bundling.
Alternatively, post-build `signtool.exe` signing supports
`PRESHOT_SIGNTOOL_PATH` plus either `PRESHOT_SIGN_CERT_SHA1` or
`PRESHOT_SIGN_CERT_FILE`; optional settings are `PRESHOT_SIGN_CERT_PASSWORD`,
`PRESHOT_SIGN_TIMESTAMP_URL`, `PRESHOT_SIGN_DESCRIPTION`, and
`PRESHOT_SIGN_DESCRIPTION_URL`. The executable is signed before MSI bundling,
then the MSI is signed, so the installed payload and outer package are both
covered. Keep certificate passwords in the process environment only.
`PRESHOT_INSTALLER_VERIFY_SCRIPT` may point to a
non-destructive PowerShell validation hook accepting `-MsiPath`,
`-ManifestPath`, and `-Publish`.

See the [Windows installer operator guide](docs/WINDOWS_INSTALLER.md) for
silent commands, upgrade/rollback checks, WebView2 behavior, troubleshooting,
and the pinned Tauri template update procedure. Local installs may be
unsigned; published artifacts must be signed and pass publish-mode
verification.

## Documentation

- [Contributor guide](AGENTS.md)
- [Documentation index](docs/README.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Testing](docs/TESTING.md)
- [Reliability](docs/RELIABILITY.md)
- [Windows installer operator guide](docs/WINDOWS_INSTALLER.md)
- [Licensing and distribution](docs/LICENSING.md)
- [BlockNote v14 design](docs/design_docs/blocknote_v14_design.md)
- [UI/UX contract](docs/design_docs/UI_UX_CONTRACT.md)
- [Feature status tracker](docs/design_docs/featurelist.json)

## License

Preshot's own source code is under the [MIT License](LICENSE).

Distributed application builds that include `@blocknote/xl-multi-column`,
`@blocknote/xl-pdf-exporter`, or `@blocknote/xl-docx-exporter` use those
dependencies through their GPL-3.0 option, so shipped Preshot application
distributions must be provided under GPL-3.0 with the corresponding source and
license notices. The `docx@9.6.1` dependency is MIT-licensed.
The production long-image renderer, `modern-screenshot@4.7.0`, is also
MIT-licensed and does not add another BlockNote XL/GPL dependency.

See [Licensing and distribution](docs/LICENSING.md),
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), and
[LICENSES/GPL-3.0.txt](LICENSES/GPL-3.0.txt).
