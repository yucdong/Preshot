# Testing

## Commands

Run these from the repository root on Windows:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:init
pnpm test:e2e
pnpm test:e2e:blocknote
pnpm midscene:proxy
pnpm midscene:model:verify
pnpm midscene:smoke
pnpm test:midscene:web
pnpm midscene:report:merge
& $env:ComSpec /c 'call "<VS>\VC\Auxiliary\Build\vcvars64.bat" >nul && cd /d C:\projects\Preshot && cargo test --manifest-path src-tauri\Cargo.toml'
pnpm build
```

Playwright starts Vite in `e2e` mode and uses Microsoft Edge. It selects the
browser workspace and canvas adapters, never a live Tauri backend.

### Midscene Proxy Mode

Midscene uses `gpt-5.6-sol` through the local Responses API proxy at
`http://localhost:4141/v1`. Because Midscene currently calls Chat Completions,
start the repository's protocol bridge in a dedicated terminal:

```powershell
pnpm midscene:proxy
```

The bridge listens on `http://127.0.0.1:4142/v1`, converts Midscene Chat
Completions requests to the upstream Responses API, and maps unsupported image
detail `original` to `high`. It does not log prompts or screenshots.

With the bridge running, verify the model and then run a read-only Preshot
browser smoke (the app must already be available at port 1420):

```powershell
pnpm midscene:model:verify
pnpm midscene:smoke
```

The smoke report is written under `midscene_run/report/`. Local `.env` and
Midscene report directories are ignored by Git.

The full plan-text suite creates a unique project per case, records evidence,
removes the project through the UI, and purges only Midscene-prefixed browser
storage. The final merged report is generated with `pnpm midscene:report:merge`.

## Verified Matrix

BlockNote v13 migration verification on 2026-08-15:

| Command | Result |
| --- | --- |
| `pnpm lint` | passed with 0 errors (one existing fast-refresh warning) |
| `pnpm typecheck` | passed |
| `pnpm test` | 85 files, 435 tests passed after continuous-canvas migration |
| `pnpm test:init` | 4 initializer checks passed |
| `pnpm test:e2e` | 9 unified BlockNote/workspace/layout/theme/PDF journeys passed |
| `pnpm test:e2e:blocknote` | 2 v13 journeys passed |
| Rust tests | 48 passed |
| `pnpm build` | passed with the existing large-chunk warning |
| `pnpm tauri:build` | passed; MSI produced |

Verified on 2026-08-12:

| Command | Result |
| --- | --- |
| `pnpm lint` | passed with 0 errors (one existing fast-refresh warning) |
| `pnpm typecheck` | passed |
| `pnpm test` | 88 files, 495 tests passed |
| `pnpm test:init` | 4 initializer harness checks passed |
| `pnpm test:e2e` | 25 Playwright tests passed, including 17 v12 canvas UI/UE regressions |
| `pnpm midscene:model:verify` | text, vision, and AI locate checks passed through the local proxy bridge |
| `pnpm midscene:smoke` | read-only Preshot `aiAct` passed and generated an HTML report |
| `pnpm test:midscene:web` | 8 plan-text AI journeys passed across isolated fresh-project runs; all UI cleanup receipts reported zero storage residue |
| `cargo test --manifest-path src-tauri\Cargo.toml` | 48 Rust tests passed |
| `pnpm build` | passed (Vite reports the existing large-chunk warning) |

## Coverage by Layer

### UI/UE Contract Regression

`docs/design_docs/uiue.md` is the required UI/UE regression index. Every
accepted interaction has a stable UIUE ID and maps to one or more deterministic
component or Playwright tests. A UI/UE change is incomplete until the contract,
implementation, mapped tests, and affected architecture/design documentation
are updated together. When expected behavior changes, update the requirement
first and then change the test; do not merely loosen geometry or visibility
assertions to make an old implementation pass.

Use React Testing Library for accessible local states and close/cancel behavior.
Use Playwright for selection, outside-pointer dismissal, responsive geometry,
page-relative scaling, persistence, and cross-feature workflows. Midscene may
add visual evidence for interactions that require judgment, but it does not
replace deterministic assertions. The current mapping is maintained in the
UI/UE contract rather than duplicated here.

### Domain

The schema-v12 canvas tests cover migration from legacy payloads, strict marker
integrity, visual-order flattening of recursive text, canonical document HTML,
and per-image frame/crop metadata preservation.
`engine.test.ts` covers reference pagination, including the regression that
moves a late component when no complete first image row fits while preserving
normal top-of-page and fitting-row behavior.

`referenceLayout`, caption sizing, naming, history, drop-target, and service
tests cover pure image slots, independent captions, description visibility,
drag targets, persistence boundaries, and no-op identity behavior without
browser or Tauri mocks.

### Components

React Testing Library tests assert accessible UI behavior:

- component frames expose all four resize edges;
- image tiles render four direct-size handles above caption editors and expose
  reset only for a custom `displayHeight`;
- reference views keep toolbar and final-slot import/capture actions, hide only
  the group description, and preserve independent caption editing;
- `ProjectCanvasProvider` covers capture cancellation, partial batch-import
  reporting, retirement/rebase persistence, and image-ratio hydration.

### Adapters and PDF

Tauri/browser adapter tests validate command names, payloads, result shapes,
and contextual failures. Browser seed tests assert canonical schema-v12
document HTML, matching image-group markers, and deterministic image IDs.

PDF tests use real pdf-lib fonts and generated PNGs. They cover hidden
descriptions, independent captions, exact image slots, continuation fragments,
and scale `0.5`, `1`, and `2` for component geometry, reference imagery,
component titles, rich-text sizes/line heights, and caption sizes. Image-view
tests additionally cover centered-cover migration, normalized crop validation,
source-pixel mapping, focal-point preservation, and crop-aware PDF bitmaps.

### Rust

Rust unit tests cover atomic manifest/PDF writes, image import and removal,
workspace manifests, settings, and the Windows capture helper. Capture tests
cover token lifecycle, PNG writing, and invalid RGBA rejection without opening
the screen-snipping UI.

### Browser Smoke

The focused Playwright suite verifies canonical v12 loading, one unrestricted
document, resizable atomic image groups, page-relative contextual toolbar
geometry, selection-only visibility, outside-pointer dismissal, centered wheel
zoom, top/page-end insertion, image import and group scaling, atomic deletion,
HTML persistence, Word-style four-corner pages, inert page gaps, unified
title-free editing, PDF export, workspace navigation, settings, and undo/redo.
The focused `PagedCanvasSurface` component regression additionally fixes the
corner mapping and verifies that each inward-pointing vertex lands on the text
boundary while its line arms remain outside it.

The focused `PlanCanvas` document-mode regression covers image selection,
invisible four-edge/four-corner image and group resize zones, dual-axis image
resize, image-toolbar-only deletion, source lightbox opening, group frame resize,
`− / px / +` group scaling, and contextual-toolbar dismissal on wheel.
`ReferenceImageLightbox` coverage verifies reset-before-close ordering and focus
restoration to the originating image.
The matching browser journey also locks selection styling: group background
changes while group/image borders, shadows, and geometry remain unchanged; the
group has no selection pseudo-frame, and the selected image shows its number.
Browser-level canvas coverage retains import, wrapping, persistence, atomic
group deletion, pagination, and PDF export journeys.

The independent BlockNote v13 Playwright configuration runs on port 1430 with
the same production BlockNote canvas. It covers new-project JSON editing, slash-menu
image-group insertion, image import, eight-way image/group handles, image
resize/reorder, standard side-menu duplication/deletion, autosave, JSON PDF
export, and schema-v12 incompatibility.

The v13 layout regression asserts that the editor has exactly one continuous
document surface and no `canvas-page-background` elements. Adding blocks grows
the document and the middle workspace scrolls; PDF pagination is tested only in
the exporter.

## Expectations

Add a failing regression before fixing a defect. Use the smallest focused test
first, then run the affected matrix. Keep domain tests free of platform mocks,
component tests user-visible and accessible, and Playwright limited to
cross-feature smoke flows rather than duplicating unit coverage.
