# Architecture

## Goals

Preshot is a Windows-first desktop application for local photography planning.
It keeps platform-independent rules in TypeScript domain code and puts native
filesystem, dialog, PDF-save, and capture work behind narrow Tauri adapters.

```text
React UI -> domain use case -> domain port -> infrastructure adapter -> Tauri
```

`src/domain` never imports React, browser APIs, Tauri, or infrastructure.
Direct `@tauri-apps/api` imports are confined to `src/infrastructure`; Rust
commands serialize OS work only and do not contain UI or planning rules.

## Areas

- `src/app`: dependency composition, workspace lifecycle, shell, settings, and
  error boundary.
- `src/features`: canvas/editor UI, interactions, image import progress, and
  project-retirement orchestration.
- `src/domain`: workspace and schema-v6 canvas models, pure layout/reducers,
  migration, and ports.
- `src/infrastructure`: Tauri and browser implementations of those ports.
- `src-tauri`: filesystem, PDF, screen-capture, menu, and settings commands.

## Workspace and Project Storage

`workspace.json` in AppData records recent projects. Each project directory has
a `.preshot` manifest containing project identity and the optional plan. The
workspace service serializes mutations; unavailable manifests remain visible
for recovery but cannot be opened as a project.

Canvas plans are migrated at the manifest boundary to `schemaVersion: 6`.
Earlier schemas are accepted only as migration input. A valid v6 plan has a
flat, ordered `components` array; it does not persist row IDs, manual rows, or
crop metadata.

## Schema v6 Canvas

Each component has a continuous `width` and `contentScale` in `[0.5, 2]`.
The pure `layoutPlan` engine packs the ordered components left-to-right with
the configured gap, then wraps and paginates them. Resizing or moving a
component changes the flat order/geometry only; rows are always recomputed.
The same engine drives the editable screen canvas and PDF placement so their
page and reference-row fragmentation rules stay aligned.

Reference components contain:

- a rich-text `description` and `showDescription`; hiding it removes it from
  the canvas and PDF while preserving its stored content;
- a shared `imageHeight`;
- image records with aspect ratio, an optional independent `caption`, and an
  optional `displayHeight`.

`displayHeight` is a per-image override bounded by the group image height.
Dragging any image edge changes that image only; reset removes the override.
Captions are independent per-image editors, not a group-level visibility
toggle. Caption bands are calculated with the same slot model used by screen
and PDF output.

`contentScale` affects component geometry and visible content consistently:
plan rich-text measurements, reference descriptions, image slots, captions,
and component titles scale together. The synthetic document-title spacer used
only by PDF export always remains scale `1`.

Reference pagination keeps a complete first image row with its header. If a
reference starts late on a page and only its header/visible description fits,
the engine moves the component to the next page instead of emitting a
header-only first fragment. Components at page top and rows that fit retain
normal fragmentation.

## Canvas UI and PDF

`PlanCanvas` renders A4 pages from pure placements. `ComponentFrame` supplies
the drag chrome and four edge handles: left/right change width; top/bottom
adjust content scale. `ReferenceComponentView` exposes import and screen
capture both in its toolbar and on the hoverable final empty slot.

`canvasPdfExporter` builds the same layout using pdf-lib and bundled Noto Sans
SC. It prepares text at logical component width, scales PDF text commands and
image/caption rectangles, and draws images contain-fit inside framed slots.
The PDF save adapter opens a native save dialog and calls the narrow Rust
`save_pdf` command for atomic byte writes.

## Image Import and Windows Capture

The canvas plan service serializes image operations. A native import moves a
validated image into `references/`, returns its data URL, updates the plan,
and preserves operation context on failure. Multi-file imports proceed one
file at a time so successful items remain available when another file fails.

`ScreenCapture` is a domain port. Its Windows implementation starts
`ms-screenclip:`, associates a token with the clipboard sequence number, and
polls until a later clipboard image can be written to a token-specific
temporary PNG. The provider then imports that path through the ordinary image
flow. Cancelling invalidates the token, dismisses the overlay, and prevents a
late capture result from mutating the plan.

## Persistence and Retirement

`ProjectCanvasProvider` maintains a per-project persistence snapshot and
auto-saves only changed serialized plans every five seconds. Image side-effect
operations persist through the service queue. On project switch or unmount,
the project-retirement coordinator serializes retirement barriers, waits for
in-flight mutations and image measurement, and saves the latest rebased
snapshot before another provider loads that project.

## Error Flow

Adapters wrap native failures with operation context. Expected failures become
visible feature errors; they never return success-shaped fallback data.
Unexpected rendering failures reach the application error boundary only.
