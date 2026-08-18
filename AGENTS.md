# AGENTS.md

## Purpose

Preshot is a Windows-first desktop application for photography planning. The current repository ships the real workspace flow, BlockNote plan editor, project persistence, native media handling, and PDF export used by the desktop app.

## Runtime snapshot

- Active editor path: `src/features/plan/blocknote/BlockNoteProjectCanvasProvider.tsx`
- Active plan schema: v14 with BlockNote document v2 (`format: "preshot-blocks"`)
- Active UI language: Simplified Chinese (`src/shared/i18n/locales/zh.ts`)
- Project manifest: `.preshotproj` with manifest `schemaVersion: 1`
- Legacy `.preshot` and schema v13 plans are compatibility input only

## Repository map

- `src/app`: dependency composition, theme, workspace provider, and application shell
- `src/features`: workspace launcher, BlockNote editor UI, settings panel, and assistant preview UI
- `src/domain`: pure workspace/settings/plan models, services, ports, schema validation, and shared geometry
- `src/infrastructure`: Tauri/browser adapters, dialogs, PDF exporter, and persistence wiring
- `src-tauri`: native project, media, PDF, reveal, settings, and screen-capture commands
- `e2e`: Playwright browser-shell smoke suites
- `tests`: PowerShell initializer regression harness
- `scripts`: the Windows Tauri wrapper, Midscene helpers, and maintenance scripts
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
- PDF export paginates during export through the official
  `@blocknote/xl-pdf-exporter@0.53.0` and `@react-pdf/renderer@4.3.0`
  production path; the editor itself is a continuous document, not an A4 page
  canvas.
- `pdf-lib` remains available only through the explicitly constructed legacy
  rollback adapter. Production failures must surface and must not silently
  fall back.
- New editor work should go through the BlockNote v14 path unless the task explicitly targets compatibility code.

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
```

### Validation

```powershell
pnpm docs:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:watch
pnpm test:init
pnpm test:e2e
pnpm test:e2e:blocknote
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

## UI and platform notes

- BlockNote 0.53 plus Mantine is the active rich-text/block editor stack.
- The multi-column and PDF export dependencies use
  `@blocknote/xl-multi-column` and `@blocknote/xl-pdf-exporter` under their
  GPL-3.0 options; distributed builds that include either are GPL-3.0.
- React-PDF requires the least-privilege Tauri CSP to keep
  `script-src 'self' 'wasm-unsafe-eval'`; bundled PDF fonts are covered by
  `default-src 'self'`, and no broad network origin is allowed.
- The app shell supports focus mode, persisted theme choice, and persisted project/assistant panel widths.
- The assistant panel is currently a preview surface; do not document it as a working chat backend.
- Legacy canvas modules still exist for compatibility and shared logic, but the mounted editor in the app is BlockNote v14.

## Testing expectations

- Domain tests cover pure behavior without browser or native mocks.
- Component tests assert accessible, user-visible behavior.
- Mock only platform boundaries such as Tauri `invoke`, file pickers, or browser storage.
- Playwright stays a smoke/integration layer and should not duplicate unit coverage.
- Avoid snapshots for dynamic editor, image-layout, or PDF output.
- Use the real Chinese UI strings in assertions unless the change explicitly updates localization.

See [docs/README.md](docs/README.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/TESTING.md](docs/TESTING.md), and [docs/RELIABILITY.md](docs/RELIABILITY.md).
For active design references, use [docs/design_docs/blocknote_v14_design.md](docs/design_docs/blocknote_v14_design.md), [docs/design_docs/UI_UX_CONTRACT.md](docs/design_docs/UI_UX_CONTRACT.md), and [docs/design_docs/featurelist.json](docs/design_docs/featurelist.json).
