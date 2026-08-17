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
- `src/domain`: workspace and schema-v12 canvas models, pure layout/reducers,
  migration, and ports.
- `src/infrastructure`: Tauri and browser implementations of those ports.
- `src-tauri`: filesystem, PDF, screen-capture, menu, and settings commands.

## Workspace and Project Storage

`workspace.json` in AppData records recent projects. Each project directory has
a `.preshot` manifest containing project identity and the optional plan. The
workspace service serializes mutations; unavailable manifests remain visible
for recovery but cannot be opened as a project.

Production now creates schema-v14 BlockNote canvas plans. The canonical v14
document is strict JSON (`document.format = "preshot-blocks"`, document version
2), supports `columnList` / `column` rows, and stores image-group metadata
separately in `imageGroups`. Schema v13 plans are migrated atomically to v14;
older schema v1-v12 plans are returned as an explicit incompatible load result
and are never opened, autosaved, exported, or modified.

Legacy canvas plans were migrated at the manifest boundary to `schemaVersion: 12`.
Earlier schemas are accepted only as migration input. In strict v12,
`documentHtml` is the sole source of text and image-group order, while
`components` contains only reference/image-group metadata. Every image-group
marker must match exactly one component record and vice versa. Reference image
records preserve source dimensions, frame geometry, captions, and normalized
crop independently of the HTML marker.

## Legacy Schema v12 Continuous Document

Schema-v12 historically used one TipTap 3 editor behind the shared `RichTextEditor`
contract. Text blocks and resizable atomic image-group nodes share one
ProseMirror document, so text can continue before, between, and after image
groups without separate frames. Top-level nodes provide pagination boundaries;
editor serialization persists stable image-group markers rather than runtime
NodeView DOM or data URLs.

The editor is visually paged like a word processor. Each A4 background exposes
four printable-area corner marks; page-gap overlays sit above the continuous
ProseMirror surface so a caret cannot be placed between pages. Pagination uses
ProseMirror decorations to move keep-together blocks and view-fit oversized
blocks without changing canonical HTML. `ProjectPlan.title` remains project
metadata only: canonical v12 canvas and PDF do not render a separate title
input or title band. A visible document title is ordinary H1/H2 content inside
`documentHtml`.

The A4 document is horizontally centered in its scroll viewport. Wheel zoom
uses the page center horizontally and preserves the vertical interaction point.
Contextual toolbars are portaled to `document.body` for reliable viewport
positioning, then explicitly scaled by the current A4 scale. A text toolbar is
visible only for a non-empty text selection; outside pointer input collapses
the selection and closes contextual UI.

Image-group records contain:

- a rich-text `description` and `showDescription`; hiding it removes it from
  the canvas and PDF while preserving its stored content;
- a shared `imageHeight`;
- image records with aspect ratio, an optional independent `caption`, and an
  optional `displayHeight`, source dimensions, and normalized crop.

`displayHeight` is a per-image override bounded by the group image height.
Dragging any image edge changes that image only and recalculates its crop while
preserving the current focal point. Adjustment mode pans the crop without
activating image reorder. Reset restores the source ratio and full-image crop.
Captions are independent per-image editors, not a group-level visibility
toggle. Caption bands are calculated with the same slot model used by screen
and PDF output.

Image-group pagination keeps each image intact and may break only between image
rows. The screen and PDF both resolve marker order through `documentHtml` and
render frame/crop geometry from the matching image-group record.

## Schema v14 BlockNote Document

New projects use one BlockNote editor with native paragraph, H1-H3, list,
checklist, toggle, quote, code, table, divider, formatting toolbar, slash menu,
side menu, undo/redo, and block drag behavior. Font-size and H4-H6 parity are
not part of v14.

The custom `imageGroup` block has no editable content and stores only a
primitive `groupId`. Its React renderer resolves frame/crop/image metadata from
the plan's `imageGroups` collection. Image groups may be top-level or direct
children of `column` blocks. Internal image pointer regions use
`bn-drag-exclude` so image DnD/resize does not start BlockNote block drag.

The GPL-3.0 `@blocknote/xl-multi-column` extension adds `columnList` and
`column` structures, adjustable flex-weight widths, and two-/three-column slash
commands. Preshot's pointer drag detects left/right block edges to create or
extend column rows under CSS zoom.

Native BlockNote `image`, `video`, and `audio` blocks use the editor's
`uploadFile` boundary. Tauri stores accepted files under the project's
`media/` directory and returns runtime data URLs; canonical JSON persists only
relative `media/...` paths. Removed media remains available for undo and is
physically deleted during project retirement. Native images render in PDF;
video and audio render explicit caption/name fallback rows because PDF cannot
embed interactive players.

BlockNote document changes remain editor-owned. Image-group deletion retains
runtime tombstones so native undo can restore metadata; unreferenced project
files are reaped at project retirement. Same-project duplication creates new
group and image IDs while safely reusing the underlying files.

The BlockNote editing canvas is one continuous white document that grows
vertically with its blocks. It does not render A4 page backgrounds, page gaps,
corner marks, runtime page spacers, or view-fit transforms. v13 PDF export
performs A4 pagination independently, traverses JSON directly, and resolves
image groups through `groupId`; it does not serialize to HTML and parse it
again.

Image-group custom blocks constrain their rendered x/width to the actual
BlockNote block-content box rather than the nominal document geometry, so the
card aligns to both text edges and cannot overflow the paper. Ctrl+wheel zooms
the continuous canvas from 50% to 150% around the pointer; ordinary wheel input
remains scrolling.

Imported image data URLs are decoded once to record source dimensions.
All images imported in one group start from the same frame height, while each
frame width is derived from the source aspect ratio. Canvas and PDF consume
these persisted frame dimensions and full-source crop, so images are never
stretched.

## UI/UE Contract

`docs/design_docs/uiue.md` is the canonical summary of accepted UI/UE
interaction requirements. Feature design documents may contain richer visual
exploration, but their accepted behavior must be assigned a stable UIUE ID and
summarized there. Any interaction change must update the UI/UE contract,
implementation, mapped regression tests, and affected architecture/testing
documentation in the same change.

## Legacy Canvas UI and PDF

The removed `PlanCanvas` path routed canonical v12 plans to `PlanDocumentCanvas`, which rendered
one Word-style paged A4 TipTap document. The legacy component canvas remains only as a
compatibility branch for fixtures without `documentHtml` and is not a second
canonical persistence model. Each page draws Word-style corner marks outside the
printable text rectangle, with their four vertices pointing inward and coinciding
with the rectangle corners.

Document image-group NodeViews reuse persisted reference metadata rather than
introducing a second editor store. Group corner resize writes existing
`x/width/height` fields through `resizeComponent`; image edge/corner resize
writes `frameWidth/frameHeight` through `setImageFrame`, which recomputes the
single normalized crop. Reset restores the default frame and full-source crop.
When a resized group cannot contain its frames, the shared document image-group
layout computes one display fit scale consumed by both the NodeView and PDF
renderer without mutating persisted image frames.

`canvasPdfExporter` builds the same layout using pdf-lib and bundled Noto Sans
SC. It prepares text at logical component width, scales PDF text commands and
image/caption rectangles, and rasterizes the persisted normalized crop into
each framed slot. Canvas CSS and PDF bitmap rendering derive from the same pure
`ImageViewRenderSpec`; export adapters do not independently contain, cover, or
recenter images. A future PPT adapter must consume this contract as well.
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
