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
| `pnpm exec vitest run src\app\packaging\docsCheck.test.ts src\app\packaging\msiConfig.test.ts src\app\packaging\versionConfig.test.ts src\domain\workspace\starterProject.test.ts src\domain\workspace\service.test.ts src\infrastructure\workspace\tauriWorkspace.test.ts` | Focused documentation, MSI, release-version, starter/bootstrap, service, and Tauri-adapter contracts. |
| `pnpm test:watch` | Vitest watch mode for local TDD. |
| `cargo test --manifest-path src-tauri\Cargo.toml` | Rust unit tests for Tauri-side commands and helpers. |
| `pnpm build` | TypeScript build plus Vite production bundle. |
| `pnpm tauri:build` | Desktop package build. |

If Visual Studio tools are not already active in the shell, use **Developer PowerShell for VS 2022** before running Rust or Tauri packaging commands.

### Production MSI matrix

The non-installing release matrix is:

| Stage | Exact command | Coverage |
| --- | --- | --- |
| Documentation | `pnpm docs:check` | English canonical docs, required files, JSON, links, stale canonical references. |
| Static packaging/bootstrap contracts | `pnpm exec vitest run src\app\packaging\docsCheck.test.ts src\app\packaging\msiConfig.test.ts src\app\packaging\versionConfig.test.ts src\domain\workspace\starterProject.test.ts src\domain\workspace\service.test.ts src\infrastructure\workspace\tauriWorkspace.test.ts` | WiX/Tauri pin, distinct per-user and historical per-machine UpgradeCodes, localized legacy detection/LaunchCondition, mandatory executable ownership, checked WebView2 command construction, version policy, scripts/artifact paths, starter content, bootstrap ordering/rollback, native argument shaping. |
| Production-script fixtures | `pnpm test:production-scripts` | Version limits and synchronization, first-publish lineage gate, offline targeted Cargo.lock updates, command failure propagation, compiled MSI Upgrade/LaunchCondition and runtime table assertions, artifact inspection, expected/mismatched signer handling across PowerShell and signtool readers, publish/local hook invocation, deterministic manifest/checksum, tamper rejection, and safe stale-MSI cleanup. |
| Native bootstrap contracts | `cargo test --manifest-path src-tauri\Cargo.toml workspace::tests::` | Root creation, adoption, exact starter creation, contention, atomic manifest failure cleanup, token authority, quarantine rollback, and preservation. |
| Full unit/static | `pnpm test` | Complete Vitest suite. |
| Full native | `cargo test --manifest-path src-tauri\Cargo.toml --target x86_64-pc-windows-msvc --all-features --all-targets --locked` | Locked full Rust release-target suite. |
| Build | `pnpm production:build` | All non-E2E checks above, prerequisites, safe stale-MSI cleanup, explicit x64 MSI build with a version-only bundle override, compiled Upgrade/LaunchCondition/FeatureComponents/CustomAction/File/Shortcut inspection, optional signing, artifact metadata/checksum/manifest generation. |
| Existing-artifact verification | `pnpm production:verify` | Repeats the full static/unit/native matrix, both Playwright suites, compiled MSI runtime-contract, signature, and metadata verification, then an optional non-destructive installer hook; does not rebuild or install. |

Expected versioned outputs are:

```text
src-tauri\target\x86_64-pc-windows-msvc\release\preshot.exe
src-tauri\target\x86_64-pc-windows-msvc\release\bundle\msi\Preshot_<version>_x64_en-US.msi
src-tauri\target\x86_64-pc-windows-msvc\release\bundle\msi\Preshot_<version>_x64_en-US.msi.sha256
src-tauri\target\x86_64-pc-windows-msvc\release\bundle\msi\Preshot-<version>-release.json
```

### Clean-VM installer matrix

Run this only in disposable Windows VMs after the non-installing matrix passes:

| Scenario | Exact command |
| --- | --- |
| Interactive default install | `msiexec.exe /i ".\Preshot_<version>_x64_en-US.msi" /L*v ".\install.log"` |
| Silent Desktop-opt-in install | `msiexec.exe /i ".\Preshot_<version>_x64_en-US.msi" DESKTOPSHORTCUT=1 /qn /norestart /L*v ".\install-desktop.log"` |
| Higher-version major upgrade | `msiexec.exe /i ".\Preshot_<higher-version>_x64_en-US.msi" /L*v ".\upgrade.log"` |
| Repair | `msiexec.exe /famus "{PRODUCT-CODE-GUID}" /qn /norestart /L*v ".\repair.log"` |
| Silent uninstall | `msiexec.exe /x "{PRODUCT-CODE-GUID}" /qn /norestart /L*v ".\uninstall.log"` |

For every VM scenario, assert LocalAppData/HKCU scope, shortcut policy,
WebView2 behavior, application launch, starter/adoption behavior, and
preservation of `%USERPROFILE%\.preshot` across upgrade, forced rollback,
repair, and uninstall. Also run negative attempts for downgrade and
`ALLUSERS=1`. Do not run this matrix on a developer workstation.

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
  `src-tauri\target\x86_64-pc-windows-msvc\release\bundle\msi\Preshot_0.0.1_x64_en-US.msi`,
  with no other Preshot MSI in that output directory.

The final acceptance reran the production browser export while retaining only
the three reviewed files under `artifacts\pdf-export-regressions`. It confirmed
non-empty UI-downloaded React-PDF bytes, A4/page/text/link/image structure,
CJK-first content, cropped/resized/wrapped and weighted-column image groups,
near-bottom and positive-offset pagination, row-boundary oversized-group
pagination, a tall native image with long Latin/CJK captions, atomic image
rows, no editor chrome or wrap warning, contextual asset failures, and no
silent legacy fallback. The production CSP permits self-hosted fonts and Yoga
WASM while rejecting remote proxy/network sources.

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

## Agent panel acceptance (2026-08-22)

The completed production assistant-panel review passed:

- documentation, ESLint, TypeScript, and the production web build;
- 159 Vitest files / 1,070 tests, including controller context controls,
  setup/history/composer/IME/streaming/tool/permission/input/usage/error/
  citation behavior, all proposal review paths, dialog focus, forced-color,
  reduced-motion, and 240-420px contracts;
- all 29 main Playwright journeys;
- all 14 focused BlockNote journeys and all 3 isolated capture journeys;
- 144 passed Rust tests with only the 2 explicitly ignored local live-proxy
  probes; and
- both focused mocked agent journeys covering configure, chat, tool proposal,
  apply, session-resume receipt reload, undo, verified image attachment,
  abort, queued-switch cancellation, and Stop/switch.

The Vite large-chunk advisory remains unchanged and is not an agent-panel
failure.

The standalone deterministic agent eval is `pnpm test:agent-evals`. It uses no
live model, proxy, network, user document, or user image and refreshes
[`tests/artifacts/agent-mvp-eval-report.md`](../tests/artifacts/agent-mvp-eval-report.md).
Its fixture inventory covers all 18 normalized event variants, all 24 typed
errors, text/vision/no-model capability gates, eight adversarial
shell/network/path/media/schema proposal payloads, every allowed text block
type and nesting, source identity, no mutation before Apply, stale revision,
hash conflict, Apply, and restart-safe Undo. Rust fixtures separately map every
supported SDK event class, native error class, and ephemeral non-replay event.
The final runner report records 54/54 deterministic checks, including five
send-time attachment token/receipt/lifetime cases.

## Long-image acceptance (2026-08-20)

The completed long-image audit passed:

- `pnpm docs:check`, ESLint, TypeScript, and `pnpm build`;
- 127 Vitest files / 842 tests;
- the 15-file focused long-image/package/composition matrix / 151 tests;
- 11 focused Rust `long_image` tests;
- all 22 unified Playwright journeys, including 12 BlockNote journeys and all
  3 DOM-capture journeys; and
- the independently rerun focused production long-image journey and isolated
  3-test capture suite.

The retained production JPEG is 900 × 85px and 2,617 bytes with the expected
JPEG signature, a `.jpg` filename, and zero external requests. The retained
fixture evidence includes 900 × 1600px PNG/JPEG captures plus a complete
900 × 6000px PNG (142,408 bytes), verified bottom sentinel, bounded-pixel flag,
zero external requests, and zero active workers/iframes after cleanup. The
eight exact files are listed in the Playwright acceptance section below.

### Browser-shell tests

| Command | Purpose |
| --- | --- |
| `pnpm test:e2e` | Main Playwright suite on `http://127.0.0.1:1420` using Microsoft Edge. |
| `pnpm test:e2e:blocknote` | Focused BlockNote v14 Playwright suite on `http://127.0.0.1:1430`. |
| `pnpm test:e2e:capture` | Bounded `modern-screenshot` adapter fixture on `http://127.0.0.1:1440`, including offline fonts/assets, PNG/JPEG bytes, a 6000px capture, contiguous segments from one reused context, worker/CSP compatibility, and cleanup. |
| `pnpm test:init` | PowerShell harness for `init.ps1` error handling and Node version boundaries. |
| `pnpm test:production-scripts` | Isolated PowerShell production/release tooling contracts. |
| `pnpm test:agent-evals` | Offline agent event/error/capability/security/proposal fixtures; no live model in CI. |

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
- immutable image-drag snapshots, projection purity, same-/cross-/empty-group
  normalization, wrap/no-shrink preview geometry, row-major targeting,
  hysteresis, keyboard targets, rollback identity, and stale finalization,
- long-image 1080-to-900/890 geometry, preset limits, decoded-memory bounds,
  block/image-row segmentation, contiguous parts, no-split failures, adaptive
  JPEG quality, PNG byte re-splitting, actionable atomic-block/image-row
  exhaustion failures, safe names, and immutable manifests,
- stable-gap non-overlap wrapping, derived group height, side-only
  current-ratio resize, and prioritized Smart Guide snapping,
- PDF layout primitives and typed BlockNote PDF visual-contract boundaries
  (root/column scaling, stable rounding, and page-safe row fragments),
- deterministic React-PDF preflight traversal for root groups, weighted
  columns, empty groups, page-limit groups, positive-offset flow footprints,
  zero/negative offset safety, row partitioning, and emergency row scaling,
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
- the production assistant setup states, project-scoped create/resume/rename/
  delete history, RAF-batched transcript auto-follow, reasoning/tool/
  permission/input rendering, usage and typed errors, IME-safe drafts,
  removable context and selected-image attachment behavior, send-time token
  refresh after expiry, bounded token pruning, deleted/moved/revised image
  rejection, and path/thumbnail-free receipts, citations,
  stacked proposal review/apply/discard/revision/stale/undo-conflict paths,
  and focus-safe project-switch/destructive dialogs,
- save-state UI,
- the BlockNote editor wrapper,
- image-group selection, drag-safe double-click viewing, within/cross-group
  movement and empty targets, dnd-kit pointer/keyboard sensor composition,
  overlay/source/insertion placeholders, row-major keyboard projection,
  Chinese announcements, 48px zoom-safe auto-scroll, reduced motion,
  stale/focus/decode cancellation, one-step undo and save boundaries, preview
  non-persistence, committed exporter ordering, side-only live resize,
  wrapping, cancellation, and guide feedback,
- reference-image crop presets, Free sizing, pan/nudge, zoom, reset,
  cancel/confirm, progress, focus restoration, and actionable errors, and
- provider refresh/reflow and save-state behavior after crop overwrite, and
- PDF and DOCX export menu ordering, format-specific progress, concurrency guards,
  orchestration ordering, cancellation, write failures, browser downloads, and
  non-fatal project-directory open failures after a successful write, and
- long-image dialog presets, format-dependent controls, focus trap/restoration,
  honest limit messaging, shared export concurrency, phase/part progress,
  AbortController cancellation, multipart saves, and contextual failures.

Use React Testing Library and assert via roles, labels, visible text, and interaction outcomes.

The main Playwright suite also runs a deterministic assistant journey through
the production panel: configure the browser model, chat, stage a tool proposal,
review/apply, resume the session to reload proposal receipts, undo, verify a
vision attachment including pin/remove/reselect, abort streaming, and exercise
Wait/Cancel and Stop/switch project behavior.

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
- long-image export-surface readiness, bounded segmented DOM capture, adaptive
  JPEG/PNG encoding, browser single-download and typed multipart behavior, and
  native atomic multipart saves,
- exact production composition of the shared long-image exporter with the
  Tauri batch saver, and browser/Midscene composition with the one-download /
  typed multipart browser saver,
- production exporter composition from preflight through mapping and
  browser-compatible Blob bytes, including A4 output, immutable plan input,
  contextual failures, no silent legacy fallback, and unchanged save bytes and
  filename,
- production renderer acceptance for complete CJK/H1-H6/list/style/link
  documents, native and fallback media, image-heavy wrapped groups,
  positive-offset next-page keep-together behavior, oversized one-page
  scaling, first-block and preceded oversized groups, authored page breaks
  before root and fragmented-column groups, exact full-page predecessors,
  weighted columns, mixed long-text/image rows, exact page/image counts,
  blank-page rejection, real annotations, image draws, page dimensions, and
  absence of editor chrome,
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
- `modern-screenshot@4.7.0` version/MIT/license/lockfile coverage, absence of a
  BlockNote image-export package, same-origin non-inline worker bundling,
  external capture-fetch rejection, and absence of Node globals,
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
- PDF atomic writes, DOCX extension/path validation and atomic writes,
- long-image full-batch preflight, deterministic numbered sibling writes,
  Unicode names, serialization, rollback to exact original bytes, removal of
  only attempt-owned new outputs, and preservation of unrelated extensions, and
- Windows screen-capture helpers.

### Playwright

`pnpm test:e2e` exercises the browser-shell path used for smoke coverage. It starts Vite in `e2e` mode, uses Microsoft Edge, and validates top-level workflows such as workspace loading, project opening, editor presence, and related UI flows.

`pnpm test:e2e:blocknote` is the focused browser suite for the current v14 editor surface. Use it when changing BlockNote document behavior, image groups, columns, native media, or PDF/DOCX-adjacent editing flows.

Long-image work should run both the focused production journey in
`blocknote-v14.spec.ts` and `pnpm test:e2e:capture`. The former verifies
menu/dialog/download composition; the latter verifies renderer fidelity,
segmentation primitives, worker isolation, and cleanup without duplicating
provider or domain-unit coverage.

Unit coverage fixes the memory contract at 32 parts, cumulative retained-byte
budgets of 24 MiB for WeChat JPEG, 48 MiB for high-quality JPEG, and 64 MiB
for PNG, plus a separate 64 MiB raw-image desktop IPC ceiling. It exercises
each exact boundary, one byte over, many tiny parts, rejection before
base64/Tauri invocation, provider byte-array identity, normal multipart saves,
actionable error context, and deterministic canvas/context/object-URL cleanup.

Its create/edit/save journey asserts single-click selection, double-click
viewer opening, drag-safe viewer suppression, side-only image handles,
current-ratio resizing, group resizing, persistence, reload, and PDF export.

The dedicated live image-drag journey covers keyboard pickup/movement/cancel,
pointer activation, same- and cross-group source/target placeholders, real-time
row-major reflow, no preview persistence, one committed autosave, and CSS zoom
at 55%, 85%, 100%, and 180%. It drives the 48px central-scroller edge when the
target is below the viewport, verifies the remeasured target, and checks
recursive visible document order plus focus continuity during keyboard
projection. Unit/static contracts additionally cover same-frame pointer
release before the projection RAF, stable hysteresis release, outside-release
rollback, latest-physical-pointer auto-scroll and cleanup, mutation/reorder
rebasing, retirement ordering, dnd-kit dependency pins, removal of the legacy
`startImageDrag`/`data-image-drop-target` path, projection purity,
export/interactive renderer composition, and committed PDF/DOCX/long-image
order.

Every run attaches `live image drag preview` and `committed image drag`
screenshots to the Playwright result. To retain the canonical review set:

```powershell
$env:PRESHOT_IMAGE_DRAG_REVIEW_ARTIFACTS = "artifacts\image-drag-regressions"
pnpm exec playwright test --config playwright.blocknote.config.ts --grep "previews and commits a cross-group image drag transaction"
Remove-Item Env:PRESHOT_IMAGE_DRAG_REVIEW_ARTIFACTS
```

The retained set is `live-preview.png`, `committed-layout.png`, and
`browser-summary.json`; the summary records the CSS zoom matrix, confirms that
preview state was not persisted, and records the committed group order.

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

The long-image acceptance has two complementary Playwright layers:

- `pnpm test:e2e:capture` runs three isolated Edge tests against the
  representative DOM fixture. They verify exact 900px PNG/JPEG bytes, fonts,
  headings, crops, rounded images, two-/three-column geometry, editor-chrome
  exclusion, a complete 6000px capture with bottom sentinel, two contiguous
  3000px segments from one context, same-origin workers, zero external
  requests, bounded pixels, and worker/iframe cleanup.
- `pnpm exec playwright test --config playwright.blocknote.config.ts --grep
  "opts into splitting and downloads one offline 900px JPEG long image"` drives
  the production export menu and modal, checks the WeChat/JPEG/900px defaults
  with automatic splitting initially unchecked, verifies PNG, 890/900, and
  preset changes keep it unchecked, explicitly opts in, observes the disabled
  progress state, downloads the actual image, parses its JPEG
  signature/dimensions, enforces the 6000px / 1 MiB targets, and records zero
  external requests.

Focused TypeScript and Rust filename tests additionally cover NFC-normalized
project titles, 43-character Chinese bases, astral emoji without surrogate
splitting, decomposed combining marks, the 120-code-point ASCII boundary and
its +1 rejection, Windows reserved/trailing/path-traversal cases, numbered
suffixes, Unicode destinations, dialog-renamed authoritative bases, and the
separate 120-unit-base / 128-unit-final-component UTF-16 safety budget.

To refresh the complete reviewed set in PowerShell:

```powershell
$env:PRESHOT_LONG_IMAGE_REVIEW_ARTIFACTS = "artifacts\long-image-export-regressions"
pnpm exec playwright test --config playwright.blocknote.config.ts --grep "opts into splitting and downloads one offline 900px JPEG long image"
pnpm test:e2e:capture
Remove-Item Env:PRESHOT_LONG_IMAGE_REVIEW_ARTIFACTS
```

The retained acceptance set under
`artifacts\long-image-export-regressions` is exactly:

- `browser-production-900.jpg`
- `browser-production-summary.json`
- `capture-fidelity-900x1600.jpg`
- `capture-fidelity-900x1600.png`
- `capture-fidelity-summary.json`
- `capture-6000.png`
- `capture-6000-summary.json`
- `validation-summary.json`

The summaries record signatures, filenames, dimensions, byte counts, probes,
column/crop/chrome/font evidence, 6000px / 1 MiB targets, bottom sentinels,
worker/iframe cleanup, external-request lists, and the final limits/naming/test
matrix. They are generated evidence, not golden-image snapshots.

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
- MSI/bootstrap/production-script change: run the focused production MSI
  matrix above, then `pnpm test`, `pnpm lint`, `pnpm typecheck`, and
  `git diff --check`. Defer the destructive clean-VM matrix until explicitly
  scheduled.

## Non-goals

- Do not use broad snapshot coverage for dynamic editor, image layout, or PDF output.
- Do not replace deterministic browser assertions with Midscene-only evidence.
- Do not “fix” failing tests by loosening accepted behavior without updating the documented contract.
