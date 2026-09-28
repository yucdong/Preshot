# AGENTS.md

## Purpose

Preshot is a Windows-first desktop application for photography planning. The current repository ships the real workspace flow, BlockNote plan editor, project persistence, native media handling, and PDF export used by the desktop app.

## Runtime snapshot

- Active editor path: `src/features/plan/blocknote/BlockNoteProjectCanvasProvider.tsx`
- Active plan schema: v15 with BlockNote document v3 (`format: "preshot-blocks"`)
- Active UI languages: Simplified Chinese (default) and English (`src/shared/i18n/locales`)
- Project manifest: `.preshotproj` with manifest `schemaVersion: 1`
- Global material library: `%USERPROFILE%\.preshot\library\library.db`,
  database v6 and portable payload v1
- Legacy `.preshot` and schema v13 plans are compatibility input only

## Repository map

- `src/app`: dependency composition, theme, workspace provider, and application shell
- `src/features`: workspace launcher, BlockNote editor UI, and settings panel
- `src/domain`: pure workspace/settings/plan models, services, ports, schema validation, and shared geometry
- `src/infrastructure`: Tauri/browser adapters, dialogs, PDF exporter, and persistence wiring
- `src-tauri`: native project, media, PDF, reveal, settings, and screen-capture commands
- `src/domain/library`, `src/features/library`, `src/infrastructure/library`,
  and `src-tauri/src/library`: reusable component snapshots, dialogs, offline
  previews, SQLite search, copied assets, and insertion recovery
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

- The active editable plan is `schemaVersion: 15` with `document.version: 3`.
- Artifact blocks store only `artifactId`; normalized location, model,
  clothing, and prop records live in `plan.artifacts`.
- Image frames use eight transparent continuous resize zones. Corners preserve
  the pointerdown frame ratio; left/right edges change width only and top/bottom
  edges change height only. `fitMode` defaults to crop/cover; stretch is
  explicit and exporters must preserve it.
- Artifact cards and image-group containers are full-width, content-height
  blocks without outer resize handles. Every document block remains in the
  single vertical flow; no left/right drops or grouped rows exist. Keep card
  contents 40/60 above 430px and stacked below it.
- The active BlockNote document is single-column and stores exactly one block
  per visible row. `columnList` and `column` documents are unsupported.
- `imageGroup` blocks store only `groupId`; the actual group metadata lives in `plan.imageGroups`.
- Every image-group ID must appear exactly once in the BlockNote document and exactly once in `plan.imageGroups`.
- Native BlockNote media persists as relative `media/<file>` paths; runtime data URLs must not be written back to the manifest.
- Reference image imports copy project-local JPG/PNG files into `references/####.<ext>` and leave the original user-selected files untouched.
- Library saves own independent original-image copies; insertion allocates
  fresh identities and new project-local reference files. Preserve individual
  image crop/fit/frame fields, not outer component layout or source identities.
- Image clipboard commands receive bounded image bytes/metadata, never source
  paths. Preserve native text, IME and multi-block clipboard behavior. Previews
  and lightboxes are copy-only; material paste targets only the current gallery.
  Each paste owns a new physical file and identity. Keep the isolated decoder
  worker entry before app initialization, and never use the live system
  clipboard in unattended tests.
- Project image paste uses `.preshot-image-paste` prepare/commit/status/abort
  receipts and publishes only after the native manifest commit. Gallery history
  must interleave with real editor history. Undo/redo retains the copied file;
  retained reference crops are copy-on-write. Serialize native media URLs with
  their owning block IDs so equal pixels cannot collapse independent files.
- Library v5 `storageId` selects an immutable UUID image instance, while `blobId`
  remains an integrity hash. All new image writes use independent instances;
  unchanged legacy images use the explicit hash resolver. Never fall back from
  a missing instance to an equal-hash file. Preserve old exact receipts and
  instance ownership through session renewal, purge and recovery.
- Material insertion must commit the complete manifest before editor publication.
  Image-group materials support all or selected images, as one group or consecutive
  native image blocks. Preserve source order and pin image IDs plus mode in the
  insertion receipt. Copy only selected originals; publish/undo the batch together.
  The image-group toolbar opens an image-only library picker. `targetGroupId`
  pins append-to-group insertion in the same receipt; preserve the target metadata,
  existing images and document blocks, copy originals into new reference files,
  and record one external editor history entry. Isolated material groups use owned
  draft staging and one local undo step; cancellation never saves the material.
  Keep project-local recovery receipts and copied files needed by undo/redo.
  Keep a single shell/launcher Material library button, with insertion inside
  the browser. Capture the active document's last user-focused block before
  modal focus changes; insert after its top-level row, or prepend if no cursor
  exists. Do not treat the editor's default selection as a user cursor.
  Native image removal reports retained history files explicitly; retention
  must not prevent the provider from publishing a successful document removal.
- Material content editing uses an isolated, structurally locked one-component
  draft, never the project provider or autosave. Preserve the material ID/kind,
  save library metadata and canvas content atomically with both pinned CAS
  versions plus exact edit receipts, and keep original blobs immutable.
  Cancel deletes only owned staging; uncertain saves retain their retry sources.
  Cleanup/thumbnail failures after commit must not trigger another content save.
  Saving an existing material keeps its editor open with a fresh, version-pinned
  draft. The first confirmed save of a new material closes after owned-draft
  cleanup; cleanup failures keep the saved result available for close retry.
  Closing refreshes previews from committed content only;
  discard never removes earlier saves, and preview retries never resubmit them.
  Screen captures use the same bounded draft staging. Cancel/retire must drain
  capture and clean its temporary PNG before session discard; never publish late
  cancelled results. Text fields retain native selection/clipboard/IME behavior.
- The library exposes five categories: image, image group, location, model, and
  combined props/clothing. `propClothing` search includes both legacy `prop`
  and `clothing` payloads before sorting/pagination; creation uses `prop`.
  Preserve both immutable payload shapes, IDs, receipts and versions. Library
  editing/preview labels use the combined category without changing project blocks.
- Direct library creation chooses one of the five categories and uses that same editor.
  Image materials contain exactly one image (unsaved drafts may be empty), retain
  individual crop/frame/fit fields. Project insertion creates a native image block
  with its own media file; render crop/fit into that copy when needed. The isolated
  library canvas keeps its one-image group representation for editing and previews.
  `beginCreate` allocates only a draft; first Save atomically publishes its UUID
  at content/metadata version 1. No project or dummy canonical record is required.
  Later saves update that UUID. Before each new save, check active exact names
  across kinds (excluding the current UUID for edits) and confirm duplicates
  without overwriting another material. Unknown-save retry keeps its frozen intent.
- Permanent material deletion is recycle-bin-only and metadata-version checked.
  Preserve shared assets, live/recoverable drafts and all project copies.
  Keep the durable purge receipt/outbox and content-free operation tombstones;
  reopen resumes only approved cleanup. Never sweep unknown files or report
  cleanup failure as success.
- Browser library persistence is explicitly unavailable outside injected tests.
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
- The absolute long-image height cap is 20000px. Domain memory checks and
  DOM capture must both allow 900 x 20000 (18 million pixels / 72,000,000
  decoded RGBA bytes), while preset height targets remain unchanged.
- Automatic long-image splitting is explicit opt-in. Every new dialog starts
  unchecked, preset/format/width changes do not enable it, and omitted exporter
  options must preserve one-image behavior or fail actionably at safety limits.
- Long-image changes must not replace or alter the independent PDF and DOCX
  production pipelines.
- New editor work should go through the BlockNote v15 path unless the task explicitly targets compatibility code.
- The MSI owns only application files, shortcuts, and HKCU registration under
  `%LOCALAPPDATA%\Programs\Preshot`; application startup exclusively owns
  `%USERPROFILE%\.preshot`, project bootstrap, and the starter project.
- Keep the MSI per-user and x64-only. Do not add `ALLUSERS`, HKLM writes,
  Program Files installation, or installer-authored project/profile data.
- Keep the fixed MSI UpgradeCode stable, increment `x.y.z` before publishing,
  and let WiX generate ProductCode and PackageCode.
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
pnpm i18n:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:watch
pnpm test:init
pnpm test:production-scripts
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
- Keep contributor documentation in English; README.md is Chinese and README.en.md is English. Runtime application copy must support Chinese and English through the bundled i18n resources; never translate user-owned content. See `docs/development/i18n.md` and run `pnpm i18n:check` for UI changes.
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
- The PDF export and DOCX export dependencies use
  `@blocknote/xl-pdf-exporter` and `@blocknote/xl-docx-exporter` under their
  GPL-3.0 options; distributed builds
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
- The app shell supports focus mode, persisted theme/language choice, and persisted project-rail width.
- New project creation uses one dialog with an editable parent directory and
  project name. Resolve the default Preshot projects directory without opening
  a system picker. Explain and preview the named child folder; directory picking
  is optional and starts at the current input path.
- The project rail shows open sessions above all registered projects. Keep ready
  sessions mounted in memory across switches; preserve their editors, image
  sources, history and scroll position. Inactive sessions autosave but must not
  handle active shortcuts, clipboard, drag, or library insertion. Scope DOM
  lookups to the owning editor because project copies can share block/image IDs.
- Closing a session always prompts to save, discard unsaved edits, or cancel.
  Pause its autosave while the prompt is open. Save failures keep the session
  open; discard skips retirement saves and draft-based asset purges without
  rolling back previously persisted content. First-load image decoding uses at most four concurrent jobs,
  and actual canvas readiness dismisses loading without a hold or fade.
- Legacy canvas modules still exist for compatibility and shared logic, but the mounted editor in the app is BlockNote v15.

## Testing expectations

- Domain tests cover pure behavior without browser or native mocks.
- Component tests assert accessible, user-visible behavior.
- Image-drag changes must retain pure projection coverage, dnd-kit
  pointer/keyboard composition, preview non-persistence, single commit plus
  undo/save boundaries, and committed PDF/DOCX/long-image ordering.
- Mock only platform boundaries such as Tauri `invoke`, file pickers, or browser storage.
- Playwright stays a smoke/integration layer and should not duplicate unit coverage.
- Library changes cover all six payload kinds, copied-image ownership,
  Chinese/literal search, metadata CAS, insertion/recovery, source readiness,
  and real editor undo/redo. Native fixtures must use temporary user/project
  roots, never the developer's real library.
- Avoid snapshots for dynamic editor, image-layout, or PDF output.
- Use the real Chinese UI strings in assertions unless the change explicitly updates localization.
- Installer changes require the static MSI contract, production-script
  harness, docs check, and a later clean-VM install/upgrade/repair/uninstall
  matrix; never run that destructive matrix on a developer workstation.

See the [documentation index](docs/README.md), [architecture](docs/development/architecture.md), [build and test](docs/development/build-and-test.md), [reliability](docs/development/reliability.md), [Windows installer](docs/release/windows-installer.md), and [licensing](docs/release/licensing.md).
Feature contracts are organized under [projects](docs/features/projects.md), [editor](docs/features/editor.md), [images](docs/features/images.md), [materials](docs/features/material-library.md), [export](docs/features/exports.md), and [settings](docs/features/settings.md).
