# Testing

## Commands

Run these from the repository root on Windows:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:init
pnpm test:e2e
& $env:ComSpec /c 'call "<VS>\VC\Auxiliary\Build\vcvars64.bat" >nul && cd /d C:\projects\Preshot && cargo test --manifest-path src-tauri\Cargo.toml'
pnpm build
```

Playwright starts Vite in `e2e` mode and uses Microsoft Edge. It selects the
browser workspace and canvas adapters, never a live Tauri backend.

## Verified Matrix

Verified on 2026-08-07:

| Command | Result |
| --- | --- |
| `pnpm lint` | passed with 0 errors (one existing fast-refresh warning) |
| `pnpm typecheck` | passed |
| `pnpm test` | 73 files, 629 tests passed |
| `pnpm test:init` | 4 initializer harness checks passed |
| `pnpm test:e2e` | 18 Edge smoke tests passed |
| `cargo test --manifest-path src-tauri\Cargo.toml` | 47 Rust tests passed |
| `pnpm build` | passed (Vite reports the existing large-chunk warning) |

## Coverage by Layer

### Domain

The schema-v6 canvas tests cover migration from legacy payloads, strict v6
validation, flat ordered component movement, continuous width packing,
four-edge content-scale math, and per-image `displayHeight` clamping/reset.
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
and contextual failures. Browser seed tests assert schema-v6 data, including
`contentScale`, visible group description, and deterministic image IDs.

PDF tests use real pdf-lib fonts and generated PNGs. They cover hidden
descriptions, independent captions, exact image slots, continuation fragments,
and scale `0.5`, `1`, and `2` for component geometry, reference imagery,
component titles, rich-text sizes/line heights, and caption sizes.

### Rust

Rust unit tests cover atomic manifest/PDF writes, image import and removal,
workspace manifests, settings, and the Windows capture helper. Capture tests
cover token lifecycle, PNG writing, and invalid RGBA rejection without opening
the screen-snipping UI.

### Browser Smoke

The focused Playwright suite verifies schema-v6 seed loading, automatic
packing after resize, toolbar placement, final-slot hover actions, four-edge
component controls, per-image resize/reset, group-description Hide,
independent captions, capture import, PDF export, layout growth, component
drag preview/commit, workspace navigation, settings, and undo/redo.

## Expectations

Add a failing regression before fixing a defect. Use the smallest focused test
first, then run the affected matrix. Keep domain tests free of platform mocks,
component tests user-visible and accessible, and Playwright limited to
cross-feature smoke flows rather than duplicating unit coverage.
