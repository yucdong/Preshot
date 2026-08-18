# Testing

## Principles

- Add a failing regression test before fixing a defect.
- Keep domain tests pure and fast.
- Keep component tests focused on accessible, user-visible behavior.
- Mock only platform boundaries such as Tauri `invoke`, file pickers, or browser storage.
- Use Playwright as a browser-shell smoke/integration layer rather than a replacement for unit coverage.
- Keep Midscene evidence supplementary; it does not replace deterministic assertions.
- Use the real Simplified Chinese UI strings in tests unless the change intentionally updates localization.

## Command matrix

Run commands from the repository root on Windows.

### Static checks, unit tests, and build

| Command | Purpose |
| --- | --- |
| `pnpm docs:check` | English-only repository documentation, feature-list JSON parsing, local Markdown links, and stale current-v13/old-name checks. |
| `pnpm lint` | ESLint for the TypeScript, React, and script code. |
| `pnpm typecheck` | TypeScript project build in type-check mode. |
| `pnpm test` | Vitest suite for domain, components, adapters, and utility logic. |
| `pnpm test:watch` | Vitest watch mode for local TDD. |
| `cargo test --manifest-path src-tauri\Cargo.toml` | Rust unit tests for Tauri-side commands and helpers. |
| `pnpm build` | TypeScript build plus Vite production bundle. |
| `pnpm tauri:build` | Desktop package build. |

If Visual Studio tools are not already active in the shell, use **Developer PowerShell for VS 2022** before running Rust or Tauri packaging commands.

## Preshot 0.0.1 verification

The final release-hardening matrix completed on 2026-08-18 after the PDF and
DOCX export reviews:

- documentation checks passed;
- ESLint passed with zero warnings;
- TypeScript passed;
- 115 Vitest files / 676 tests passed;
- 4 PowerShell initializer tests passed;
- 73 Rust tests passed;
- 18 unified Playwright journeys passed;
- 11 focused BlockNote v14 Playwright journeys passed;
- the production web and Tauri builds passed; and
- the installer was produced as
  `src-tauri\target\release\bundle\msi\Preshot_0.0.1_x64_en-US.msi`, with no
  other MSI in that output directory.

The final acceptance reran the production browser export while retaining only
the three reviewed files under `artifacts\pdf-export-regressions`. It confirmed
non-empty UI-downloaded React-PDF bytes, A4/page/text/link/image structure,
CJK-first content, cropped/resized/wrapped and weighted-column image groups,
near-bottom and positive-offset pagination, oversized uniform scaling, a tall
native image with long Latin/CJK captions, atomic image groups, no editor
chrome or oversize warning, contextual asset failures, and no silent legacy
fallback. The production CSP permits self-hosted fonts and Yoga WASM while
rejecting remote proxy/network sources.

The production DOCX acceptance retains seven small files under
`artifacts\docx-export-regressions`: the downloaded DOCX, browser summary,
independent archive/XML inspection, Word-edited round trip, LibreOffice PDF
conversion, rendered first-page PNG, and desktop smoke summary. The browser
journey verifies the real `output.docx` download, required ZIP parts, valid
document/settings/styles/relationship XML, one inline composite PNG for one
image group, editable text, `keepLines`, no anchor or implicit
`pageBreakBefore`, no editor chrome/private path/external request, and an
effective 300 PPI raster. Microsoft Word opens and edits the artifact while
preserving its inline image; LibreOffice converts it to a one-page PDF whose
first page renders at 1241 x 1754 pixels.

Vite still reports its advisory large-chunk warning for the production bundle.
This is a known advisory, not a build failure.

### Browser-shell tests

| Command | Purpose |
| --- | --- |
| `pnpm test:e2e` | Main Playwright suite on `http://127.0.0.1:1420` using Microsoft Edge. |
| `pnpm test:e2e:blocknote` | Focused BlockNote v14 Playwright suite on `http://127.0.0.1:1430`. |
| `pnpm test:init` | PowerShell harness for `init.ps1` error handling and Node version boundaries. |

### Midscene and AI-assisted checks

| Command | Purpose |
| --- | --- |
| `pnpm dev:midscene` | Dedicated Vite server for Midscene-driven tests. |
| `pnpm midscene:proxy` | Start the local bridge that translates Midscene Chat Completions traffic to the Responses API. |
| `pnpm midscene:model:verify` | Verify the configured Midscene model pipeline. |
| `pnpm midscene:smoke` | Run the read-only Midscene smoke against a running app. |
| `pnpm test:midscene:web` | Serialized Midscene browser suite from `e2e-midscene/`. |
| `pnpm midscene:report:merge` | Merge Midscene text/HTML reports under `midscene_run\report`. |

## Coverage by layer

### Domain

Domain tests cover pure behavior such as:

- BlockNote v14 schema validation,
- v13-to-v14 migration,
- block nesting and image-group invariants,
- extraction of referenced `media/` files,
- image-group geometry and crop helpers,
- stable-gap non-overlap wrapping, derived group height, side-only
  current-ratio resize, and prioritized Smart Guide snapping,
- PDF layout primitives and typed BlockNote PDF visual-contract boundaries
  (root/column scaling, stable rounding, and oversized keep-together fitting),
- deterministic React-PDF preflight traversal for root groups, weighted
  columns, empty groups, page-limit groups, positive-offset flow footprints,
  zero/negative offset safety, and oversized uniform scaling,
- pure React-PDF image-group render models for root and weighted-column
  geometry, persisted-height wrapping, crop/asset identity, deterministic
  empty output, and actionable missing-context/asset failures,
- workspace registry behavior, and
- settings normalization.

Prefer domain tests when the bug can be reproduced without React or Tauri.

### React components and feature providers

Component tests cover user-visible behavior for:

- the workspace launcher, project rail, and project cards,
- app-shell resizing and focus mode,
- settings interactions,
- save-state UI,
- the BlockNote editor wrapper,
- image-group selection, drag-safe double-click viewing, within/cross-group
  movement, side-only live resize, wrapping, cancellation, and guide feedback,
- reference-image crop presets, Free sizing, pan/nudge, zoom, reset,
  cancel/confirm, progress, focus restoration, and actionable errors, and
- provider refresh/reflow and save-state behavior after crop overwrite, and
- PDF and DOCX export menu ordering, format-specific progress, concurrency guards,
  orchestration ordering, cancellation, write failures, browser downloads, and
  non-fatal project-directory open failures after a successful write.

Use React Testing Library and assert via roles, labels, visible text, and interaction outcomes.

### Infrastructure adapters

Adapter tests validate:

- Tauri workspace/plan/settings/screen-capture/PDF adapters,
- BlockNote PDF asset preflight, including normalized crop caching, repeated
  source reuse, largest draw-box selection, native-image measurement, missing
  and corrupt asset context, and hosted-proxy avoidance,
- React-PDF image-group mapping structure, including one relative
  `wrap={false}` flow wrapper, explicit positive top padding, one-time visual
  offset positioning, absolute ordered slots, standalone/column keep-together
  behavior, local optimized data, and absence of editor chrome,
- React-PDF ordinary mappings and rendering for bundled CJK fonts, H1-H6,
  inline styles/colors/alignment, lists, quote/code, row-safe tables, real link
  annotations, contextual media fallbacks, weighted columns, and offline
  project-local resolution without a hosted proxy,
- production exporter composition from preflight through mapping and
  browser-compatible Blob bytes, including A4 output, immutable plan input,
  contextual failures, no silent legacy fallback, and unchanged save bytes and
  filename,
- production renderer acceptance for complete CJK/H1-H6/list/style/link
  documents, native and fallback media, image-heavy wrapped groups,
  positive-offset next-page keep-together behavior, oversized one-page
  scaling, weighted columns, mixed long-text/image rows, real annotations,
  image draws, page dimensions, and absence of editor chrome,
- packed DOCX XML coverage for the exact shared schema, editable text and
  H1-H6 styles, top-level lists, list-only nesting depth, level-0 lists inside
  two- and three-column rows, true nested lists within columns, column-context
  resets, mixed structural nesting, nine supported levels, explicit level-9
  rejection without clamping, quote/code/table, links/colors/alignment,
  embedded native images, contextual media fallbacks, fixed weighted columns,
  conservative `cantSplit`, A4/24pt sections, Chinese locale/metadata, path
  suppression, and zero hosted/network resolution,
- production DOCX adapter coverage for immutable plan/assets, offline
  preflight, injected image-group composition, ZIP/PK bytes, contextual
  failures, native `output.docx` dialog/command arguments, cancellation,
  browser MIME/download behavior, and no browser reveal,
- least-privilege Tauri CSP coverage for the exact React-PDF WASM allowance,
  self-hosted assets/fonts, Tauri IPC origins, and rejection of broad network
  or general eval sources,
- browser test adapters used by memory and Midscene modes,
- typed PDF save options, Windows verbatim drive/UNC normalization,
  platform-safe `<project>\output.pdf` joining across trailing separators,
  spaces, and Unicode paths, unchanged PDF bytes, browser `output.pdf`
  downloads, and browser/Midscene export flows that skip directory reveal,
- argument shaping for narrow native commands, and
- deterministic same-path browser crop replacement/rollback plus validated
  Tauri crop begin/commit/rollback command arguments/results, and
- logging/sanitization helpers.

These tests should confirm boundary contracts without re-testing the pure domain logic underneath them.

### Rust

Rust unit tests cover:

- project creation and inspection,
- Explorer-compatible normalization of canonical drive/UNC project paths plus
  missing, invalid, non-directory, and spawn-failure handling,
- manifest reading and migration from `.preshot` to `.preshotproj`,
- manifest plan save/load,
- reference-image import/load/remove,
- JPG/PNG crop decode/encode, strict in-bitmap bounds, unchanged bytes after
  rejected crops, same-path output, atomic replacement, exact-byte rollback,
  idempotent committed-backup cleanup, and rejection of untrusted transaction
  identifiers,
- native media import/load/remove,
- settings read/write behavior,
- PDF atomic writes plus DOCX extension/path validation and atomic writes, and
- Windows screen-capture helpers.

### Playwright

`pnpm test:e2e` exercises the browser-shell path used for smoke coverage. It starts Vite in `e2e` mode, uses Microsoft Edge, and validates top-level workflows such as workspace loading, project opening, editor presence, and related UI flows.

`pnpm test:e2e:blocknote` is the focused browser suite for the current v14 editor surface. Use it when changing BlockNote document behavior, image groups, columns, native media, or PDF/DOCX-adjacent editing flows.

Its create/edit/save journey asserts single-click selection, double-click
viewer opening, drag-safe viewer suppression, side-only image handles,
current-ratio resizing, group resizing, persistence, reload, and PDF export.

The production PDF browser journey performs a real download through the
memory-browser save target, parses the bytes, checks A4 geometry and image draw
boxes, verifies transient progress and no external/proxy traffic, and uses
Poppler when available to validate text order and render the first page to PNG.
Set `PRESHOT_PDF_REVIEW_ARTIFACTS=artifacts\pdf-export-regressions` to retain
the reviewed PDF, PNG, and measurement summary.

The export-menu browser acceptance covers one top-right trigger, closed/open
state, below-trigger unclipped geometry at a 1280 × 700 viewport, PDF-before-
DOCX ordering, mouse/outside-click/toggle behavior, Enter/Space, Arrow-key
opening and cycling, Escape focus restoration, Tab departure, roles, expanded
state, and title. Component/provider regressions additionally cover
format-specific disabled progress labels, close-before-callback ordering,
exactly-once callbacks, cross-format concurrency, and incompatible-schema
suppression.

The DOCX browser acceptance performs a real `output.docx` download and
inspects required ZIP entries, document relationships, settings, styles,
editable text, inline image count, pagination properties, private-path
suppression, and external-request isolation.

The reviewed 2026-08-18 artifacts are
`browser-production.pdf`, `browser-production-page-1.png`, and
`browser-production-summary.json`. The summary records A4
595.28 × 841.89pt output, two measurable image draw boxes, zero external
requests, preserved text order, and a 1241 × 1754 rendered first page.

The reviewed DOCX artifacts are `browser-production.docx`,
`browser-production-summary.json`, `archive-inspection.json`,
`word-edit-roundtrip.docx`, `browser-production.pdf`,
`libreoffice-page-1.png`, and `desktop-smoke-summary.json` under
`artifacts\docx-export-regressions`.

Native image multiline-caption coverage verifies:

- Noto Sans metric-based CJK character and Latin word wrapping;
- iterative fitting at the final scaled image width;
- exact reuse of precomputed caption lines by the React-PDF mapping;
- local preflight optimization using the fitted image draw box; and
- a production-renderer acceptance document containing a 1000pt-tall image and
  an 80-word caption on one page without a React-PDF oversize warning.

### Midscene

Midscene tests are intentionally slower and serialized (`maxWorkers: 1`, no file parallelism). Use them when you need AI-assisted browser evidence beyond deterministic Playwright assertions.

## Documentation-linked behavior

The editor interaction contract lives alongside the design docs:

- [BlockNote v14 design](design_docs/blocknote_v14_design.md)
- [UI/UX contract](design_docs/UI_UX_CONTRACT.md)

When accepted behavior changes, update the implementation, the relevant tests, and those references together.

## Recommended test selection

- Small pure-logic change: run the smallest affected Vitest file first.
- Adapter-only change: run the matching adapter tests plus the nearest smoke coverage.
- Editor UI change: run the focused component tests first, then `pnpm test:e2e:blocknote` if behavior crosses browser/editor boundaries.
- Native command change: run the Rust unit tests that cover that command, then the affected TypeScript adapter tests.
- Reference-image crop change: cover normalized geometry and alias resets in
  the domain service, stale queued-save coalescing, manifest-failure rollback,
  viewer/provider behavior in component tests, the browser and Tauri adapters,
  Rust atomic overwrite/restore, and reload/PDF implications.
- Documentation-only change: application test runs are optional unless you
  changed behavior claims; run `pnpm docs:check`, parse
  `docs/design_docs/featurelist.json`, validate local Markdown links and
  English-only canonical docs, then run `git diff --check`.

## Non-goals

- Do not use broad snapshot coverage for dynamic editor, image layout, or PDF output.
- Do not replace deterministic browser assertions with Midscene-only evidence.
- Do not “fix” failing tests by loosening accepted behavior without updating the documented contract.
