# AGENTS.md

## Purpose

Preshot is a Windows-first desktop application for photography planning. The current repository ships the real workspace flow, BlockNote plan editor, project persistence, native media handling, and PDF export used by the desktop app.

## Runtime snapshot

- Active editor path: `src/features/plan/blocknote/BlockNoteProjectCanvasProvider.tsx`
- Active plan schema: v14 with BlockNote document v2 (`format: "preshot-blocks"`)
- Active UI language: Simplified Chinese (`src/shared/i18n/locales/zh.ts`)
- Project manifest: `.preshotproj` with manifest `schemaVersion: 1`
- Legacy `.preshot` and schema v13 plans are compatibility input only
- Agent runtime: `github-copilot-sdk@1.0.11`, Empty mode, bundled CLI release
  `1.0.79` (self-reporting `1.0.81-7`), and one global SQLite metadata store

## Repository map

- `src/app`: dependency composition, theme, workspace provider, and application shell
- `src/features`: workspace launcher, BlockNote editor UI, settings panel, and production assistant UI
- `src/domain`: pure workspace/settings/plan models, services, ports, schema validation, and shared geometry
- `src/infrastructure`: Tauri/browser adapters, dialogs, PDF exporter, and persistence wiring
- `src-tauri`: native project, media, PDF, reveal, settings, and screen-capture commands
- `src/domain/agent`, `src/infrastructure/agent`, and `src-tauri/src/agent`:
  pure agent contracts, adapters, managed runtime, closed tools, and sessions
- `e2e`: Playwright browser-shell smoke suites
- `tests`: PowerShell initializer regression harness
- `scripts`: the Windows Tauri wrapper, Midscene helpers, and maintenance scripts
- `src-tauri/wix`: the reviewed Tauri-pinned WiX template for the per-user MSI
- `docs`: architecture, testing, reliability, and design documentation

## Dependency rules

1. `app` and `features` may depend on `domain` and `shared`.
2. `infrastructure` may implement interfaces declared by `domain`.
3. `domain` must not import React, browser APIs, Tauri, or infrastructure.
4. Direct `@tauri-apps/api` imports belong only in `src/infrastructure`.
5. Rust commands must stay serializable, narrowly scoped, and free of UI or business rules.
6. `shared` must remain generic; do not move feature-specific behavior there.

The intended runtime flow is:

```text
React UI -> domain service/use case -> domain port -> infrastructure adapter -> Tauri/Rust
```

## Data and persistence rules

- The active editable plan is `schemaVersion: 14` with `document.version: 2`.
- `imageGroup` blocks store only `groupId`; the actual group metadata lives in `plan.imageGroups`.
- Every image-group ID must appear exactly once in the BlockNote document and exactly once in `plan.imageGroups`.
- Native BlockNote media persists as relative `media/<file>` paths; runtime data URLs must not be written back to the manifest.
- Reference image imports copy project-local JPG/PNG files into `references/####.<ext>` and leave the original user-selected files untouched.
- Live image drag is an immutable dnd-kit preview transaction. Never write
  preview order into `plan.imageGroups`, autosave, undo history, PDF, DOCX, or
  long-image input; only one validated drop may call the provider move command.
- Preserve same-/cross-/empty-group row-major projection, source/target
  placeholders, wrap-before-overflow and no-shrink geometry, decoded-asset and
  stale-revision cancellation, the 48px zoom-safe scroller edge, reduced-motion
  behavior, visible recursive document order, stable keyboard focus, and
  Simplified-Chinese announcements. Pointer release must synchronously resolve
  the latest physical target: a same-frame valid target commits once and a
  same-frame outside target cancels instead of reusing the last preview.
- Do not restore the removed component-local `startImageDrag` Pointer Events
  implementation or its `data-image-drop-target` marker. Image-tile dragging
  belongs in `ImageDragPreviewContext`; block dragging and resize gestures keep
  their separate Pointer Events paths.
- PDF export paginates during export through the official
  `@blocknote/xl-pdf-exporter@0.53.0` and `@react-pdf/renderer@4.3.0`
  production path; the editor itself is a continuous document, not an A4 page
  canvas.
- `pdf-lib` remains available only through the explicitly constructed legacy
  rollback adapter. Production failures must surface and must not silently
  fall back.
- DOCX export uses `@blocknote/xl-docx-exporter@0.53.0`, `docx@9.6.1`, the
  shared BlockNote schema, offline project assets, and the composited
  `imageGroup` mapping. Desktop saves default to `output.docx`; browser and
  Midscene modes download the same name.
- Long-image export has no BlockNote image exporter. It renders the shared
  schema on an export-only DOM surface at exactly 900px by default (890px
  compatibility only) and captures it with the pinned MIT-licensed
  `modern-screenshot@4.7.0` same-origin worker.
- The default WeChat/JPEG targets (6000px, 1 MiB, quality 0.84 down to 0.68)
  are conservative empirical compatibility values, not official platform
  limits. PNG is lossless and targets 4000px / 8 MiB.
- All long-image presets stop at 32 parts. Cumulative retained-byte limits are
  24 MiB for WeChat JPEG, 48 MiB for high-quality JPEG, and 64 MiB for PNG;
  the desktop/native IPC boundary independently caps the raw image batch at
  64 MiB before base64 allocation and native decode.
- Generated long-image bases normalize project titles to NFC and allow at most
  120 Unicode code points and 120 UTF-16 units. Every final filename component,
  including numbering and extension, is capped at 128 UTF-16 units; dialog
  renames remain authoritative only when they pass the same Windows-safe caps.
- Long-image splitting must remain block-aware and image-group-row-aware,
  adaptive to encoded bytes, bounded by canvas/decoded-memory limits, offline,
  and cleanup-safe. Desktop multipart saves are rollback-safe native batches;
  browser multipart remains an explicit typed no-op test adapter.
- Automatic long-image splitting is explicit opt-in. Every new dialog starts
  unchecked, preset/format/width changes do not enable it, and omitted exporter
  options must preserve one-image behavior or fail actionably at safety limits.
- Long-image changes must not replace or alter the independent PDF and DOCX
  production pipelines.
- New editor work should go through the BlockNote v14 path unless the task explicitly targets compatibility code.
- The MSI owns only application files, shortcuts, and HKCU registration under
  `%LOCALAPPDATA%\Programs\Preshot`; application startup exclusively owns
  `%USERPROFILE%\.preshot`, project bootstrap, and the starter project.
- Keep the MSI per-user and x64-only. Do not add `ALLUSERS`, HKLM writes,
  Program Files installation, or installer-authored project/profile data.
- Keep the fixed MSI UpgradeCode stable, increment `x.y.z` before publishing,
  and let WiX generate ProductCode and PackageCode.
- Keep agent sessions in SDK Empty mode. Creation and resume must expose only
  the four source-qualified Preshot tools; never add shell, arbitrary
  filesystem, network, Git/GitHub, MCP, skills, sub-agent, or ambient tools.
- Agent tools may read only immutable disclosed context. Text edits remain
  closed-schema proposals and must not mutate the plan before explicit Apply.
- Selected-image chips and turn receipts remain token/path-free. Issue a fresh
  single-use attachment token only at Send after revalidating project,
  revision, image identity, and the current project-relative file.
- Proposal Apply/Undo must keep the schema-v4 durable recovery journal and
  atomic provider/save boundary. Retained recovery conflicts block later
  proposal actions; never guess or silently overwrite the plan.
- Keep API keys absent. The renderer never contacts the proxy; model discovery,
  text/vision probes, and inference stay behind narrow Tauri/Rust commands.
- Keep `%USERPROFILE%\.preshot\agent.db` metadata-only. Never store or log
  prompts, transcript bodies, document text, image bytes, attachment payloads,
  secrets, or absolute paths.

## Commands

Run `.\init.ps1` on a new Windows checkout.

### App and packaging

```powershell
pnpm dev
pnpm preview
pnpm tauri
pnpm tauri:dev
pnpm build
pnpm tauri:build
pnpm production:build
pnpm production:verify
pnpm release:set-version -- <x.y.z>
```

### Validation

```powershell
pnpm docs:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:watch
pnpm test:init
pnpm test:production-scripts
pnpm test:agent-evals
pnpm test:e2e
pnpm test:e2e:blocknote
pnpm test:e2e:capture
cargo test --manifest-path src-tauri\Cargo.toml
```

### Midscene and automation

```powershell
pnpm dev:midscene
pnpm midscene:proxy
pnpm midscene:model:verify
pnpm midscene:smoke
pnpm test:midscene:web
pnpm midscene:report:merge
pnpm migrate:project
```

`pnpm tauri*` commands run through `scripts\tauri.ps1`, which helps when Cargo is installed in the default rustup location but the terminal `PATH` is stale.

## Development workflow

- Use pnpm only; do not add npm or Yarn lock files.
- Add a failing regression test before fixing a defect.
- Co-locate Vitest files as `*.test.ts` or `*.test.tsx`.
- Keep documentation in English, but keep runtime UI copy in Simplified Chinese unless the task is explicitly about localization.
- Prefer the smallest focused validation command first, then widen to the affected matrix.
- Keep files focused on one responsibility and preserve the layer boundaries.
- Do not broaden Rust commands or Tauri adapters into UI/business-rule layers.

## Error handling

- Preserve operation context when adapting native failures.
- Surface actionable failures; do not return success-shaped fallback data from plan/workspace/media operations.
- The one intentional soft-recovery path is settings loading: absent or corrupt settings are normalized back to defaults.
- Let the React error boundary handle only unexpected rendering failures.
- PowerShell scripts must use non-zero exit codes and actionable messages.
- Production scripts must keep the explicit `x86_64-pc-windows-msvc` target,
  exact artifact checks, non-destructive verification, and signed-only
  publishing contract.

## UI and platform notes

- BlockNote 0.53 plus Mantine is the active rich-text/block editor stack.
- The multi-column, PDF export, and DOCX export dependencies use
  `@blocknote/xl-multi-column`, `@blocknote/xl-pdf-exporter`, and
  `@blocknote/xl-docx-exporter` under their GPL-3.0 options; distributed builds
  that include any of them follow the existing GPL-3.0 obligations.
- `docx` bundles the browser shims used by `Packer`. Do not add an app-wide
  Buffer/process/global polyfill unless a verified runtime need appears.
- React-PDF requires the least-privilege Tauri CSP to keep
  `script-src 'self' 'wasm-unsafe-eval'`; bundled PDF fonts are covered by
  `default-src 'self'`, and no broad network origin is allowed.
- The same CSP must keep the bundled long-image worker same-origin without
  adding `worker-src`, hosted capture proxies, or broad HTTP(S) origins.
- The export menu order is PDF, DOCX, then long image. Long-image settings use
  a modal focus trap with Escape/backdrop cancellation and focus restoration;
  desktop success reveals the project directory, while cancellation, failure,
  and browser/Midscene output do not.
- The app shell supports focus mode, persisted theme choice, and persisted project/assistant panel widths.
- The assistant panel is a production project-scoped surface, but its MVP
  remains proposal-first and text-only. Do not describe it as autonomous,
  ambient, or able to edit files/media directly.
- Legacy canvas modules still exist for compatibility and shared logic, but the mounted editor in the app is BlockNote v14.

## Testing expectations

- Domain tests cover pure behavior without browser or native mocks.
- Component tests assert accessible, user-visible behavior.
- Image-drag changes must retain pure projection coverage, dnd-kit
  pointer/keyboard composition, preview non-persistence, single commit plus
  undo/save boundaries, and committed PDF/DOCX/long-image ordering.
- Mock only platform boundaries such as Tauri `invoke`, file pickers, or browser storage.
- Playwright stays a smoke/integration layer and should not duplicate unit coverage.
- Avoid snapshots for dynamic editor, image-layout, or PDF output.
- Use the real Chinese UI strings in assertions unless the change explicitly updates localization.
- Installer changes require the static MSI contract, production-script
  harness, docs check, and a later clean-VM install/upgrade/repair/uninstall
  matrix; never run that destructive matrix on a developer workstation.

See [docs/README.md](docs/README.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/TESTING.md](docs/TESTING.md), [docs/RELIABILITY.md](docs/RELIABILITY.md), [docs/WINDOWS_INSTALLER.md](docs/WINDOWS_INSTALLER.md), and [docs/LICENSING.md](docs/LICENSING.md).
For active design references, use [docs/design_docs/blocknote_v14_design.md](docs/design_docs/blocknote_v14_design.md), [docs/design_docs/UI_UX_CONTRACT.md](docs/design_docs/UI_UX_CONTRACT.md), and [docs/design_docs/featurelist.json](docs/design_docs/featurelist.json).
