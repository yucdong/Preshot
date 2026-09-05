# BlockNote Canvas v14 multi-column design (including v13 migration history)

**Status:** Active production design; legacy TipTap editing path and direct dependencies removed
**Date:** 2026-08-18
**Detailed implementation plan:** session `plan.md`

## Confirmed decisions

- New projects save schema v14 / document v2 BlockNote JSON.
- Schema v13 / document v1 plans migrate to v14 during load and are immediately persisted. Schema v1-v12 projects cannot be opened, viewed, or exported, and their files are not modified.
- Use the npm-published BlockNote build. The highest version currently available in the organization mirror is 0.53.0; 0.54.0 was not installed because the mirror has not synced yet and the official npm registry TLS request failed.
- Use `@blocknote/xl-pdf-exporter@0.53.0` with
  `@react-pdf/renderer@4.3.0` as the production PDF pipeline. Keep the previous
  `pdf-lib` exporter only as an explicitly constructed rollback adapter, with
  no silent fallback.
- The UI uses `@blocknote/mantine`.
- Text capability uses native BlockNote functionality, allowing H4-H6, font size, and similar features to degrade.
- Image groups are `content: "none"` React custom blocks that persist only `groupId`.
- Image-group metadata is stored independently in `imageGroups`.
- Image groups may live at the top level or as direct children of columns, and use the Preshot Pointer side-menu handle for dragging.
- Duplicating an image group generates new group/image IDs while reusing the same image file plus frame/crop data.
- An image tile is selected or prepared for dragging with one click; a pointer
  opens the full-image viewer only by double-clicking the image body. Enter is
  the keyboard equivalent.
- Individual images resize only from the left or right side. The current
  displayed frame ratio is locked during the gesture; image groups retain
  no outer-card resize interaction.
- Individual-image resize reflows the complete group live, preserves image
  order and stable gaps, prevents overlap, and derives the group height from
  the wrapped rows.
- Individual-image drag uses one dnd-kit pointer/keyboard context and an
  immutable preview transaction. Preview state never reaches plan persistence
  or export; one valid drop creates one move/undo/save boundary.
- Confirmed crops physically replace only the Preshot-owned project copy.
  External import sources are never modified.

## Current implementation

- `src/domain/plan/canvas/blockDocument.ts`
  - v14 portable JSON block contract plus the v13-to-v14 migration;
  - strict validation of block IDs, types, content, column nesting, media paths, and image-group references.
- `src/domain/plan/blocknote`
  - v14 seed for new projects and v13 migration on load;
  - typed incompatible-load path for old schemas;
  - v14 save, image/media import and deletion, and retirement-cleanup services.
- `src/features/plan/blocknote`
  - Mantine BlockNote editor;
  - native slash menu, formatting UI, and side menu;
  - image-group custom block;
  - top-level constraints, duplicate reconciliation, runtime tombstones;
  - one continuous white canvas growing naturally from top to bottom;
  - image import, selection, double-click viewing, deletion, within-group and
    cross-/empty-group transactional dragging, source/insertion placeholders,
    crop-aware overlay, side-only ratio-locked image resize, full-row
    content-driven group layout, live wrapping, Smart Guides, and crop editing.
  - Enter-to-create-block does not use `onBeforeChange(getChanges)`; image-group hierarchy constraints are normalized after the change so a brand-new block without an ID does not interrupt the ProseMirror transaction.
- `src/infrastructure/pdf/reactPdfBlockNoteExporter.ts`
  - snapshots the plan/assets, runs deterministic local preflight, maps the
    exact shared schema through the official BlockNote exporter, and renders
    browser-compatible PDF bytes with React-PDF;
  - does not round-trip through HTML or silently fall back;
  - injects the custom WYSIWYG `imageGroup` mapping.
- `src/infrastructure/pdf/blockNotePdfExporter.ts`
  - retains the previous `pdf-lib` implementation as
    `createLegacyBlockNotePdfExporter` for explicit rollback and acceptance
    comparison only.
- `src/infrastructure/longImage`
  - renders the shared schema-14 document and resolved local assets on an
    isolated export surface, captures bounded 890/900px segments, and encodes
    adaptive JPEG or lossless PNG parts without network access;
  - saves one or more numbered files through browser or native adapters.
- BlockNote 0.53 supplies no image exporter. Long-image output therefore uses
  the exact shared schema in a read-only export-only DOM view plus the
  MIT-licensed `modern-screenshot@4.7.0`; it does not route through the PDF or
  DOCX exporters.
- `src-tauri/src/plan.rs`
  - validates integer crop bounds against project-local JPG/PNG bitmaps;
  - backs up the original bytes, re-encodes the cropped bitmap to a sibling
    temporary file, atomically replaces the existing `references/` path, and
    exposes UUID-scoped commit/rollback commands.

## Runtime entry

BlockNote v14 is the only editable canvas entry point. There is no longer a TipTap feature flag or dynamic rollback provider. Old-schema projects only show version incompatibility and do not load legacy editor code.

The persisted version has now been upgraded to schema 14 / document version 2. Schema 13 is automatically migrated and immediately saved on open; schema 1-12 remains blocked.

## Continuous-canvas strategy

- The editing UI no longer renders A4 page surfaces, page seams, pagination corner markers, or runtime spacers.
- The canvas keeps a fixed logical width of 1080px, with 36px page padding on each side. BlockNote no longer adds duplicate internal padding, so the effective editable width is about 1008px.
- When opening or switching projects, maximize the Windows app window by default while keeping the project sidebar and assistant sidebar persistently visible. Focus mode can still be enabled manually, in which case both sidebars become floating layers opened on demand.
- On first open, auto-scale to the available width, keeping only about 20px workspace margin. Short documents fill at least the visible height; long documents keep only about 20px after the tail to avoid large meaningless gray areas.
- Page scrolling is handled only by the central workspace; no internal paginated scrolling area is created inside the editor.
- PDF export paginates separately through the production React-PDF adapter; the
  screen does not promise matching page-break positions, but exported block and
  image-group geometry follows the documented visual contract.
- Long-image export separately scales the logical 1080px document to an exact
  900px default or 890px compatibility surface. Viewport zoom never
  participates, and PDF/DOCX mappings remain unchanged.
- Image groups read actual `.bn-block-content` width, fill it, and derive their
  outer height from wrapped image content. Legacy group `x`/`width`/`height`
  metadata remains compatibility input but does not control an interactive
  outer card. Artifact cards follow the same full-row, content-driven rule;
  legacy artifact layout metadata is ignored by editor and export renderers.
- After image import, original pixel width/height are measured. Batch images keep the same `frameHeight`, and `frameWidth = frameHeight × sourceWidth / sourceHeight`, with full original crop persisted so landscape and portrait images are never stretched.
- New and batch-imported images use exactly 240 logical units of frame height.
  The loaded-project compatibility pass recognizes only approximately
  135-unit untouched defaults: square pre-hydration placeholders or widths
  matching stored, source, or crop-adjusted aspect ratios. It upgrades every
  match in every image group to exactly 240 units high, preserves image
  identity/order/crop/focal/offset metadata, and recomputes wrap-first group
  height from the available parent width. Hydration then replaces a square
  placeholder width with the measured source/crop ratio. Intentional custom
  dimensions remain authoritative.
- A changed compatibility pass marks the loaded plan unsaved and displays one
  non-blocking layout-review notice. Persistence uses the existing service
  autosave, manual save, and retirement flush; the pass is idempotent, so the
  saved plan reloads without another notice or write.
- Image import always copies files into the project's `references/` directory and generates new sequential filenames. The original file selected by the user remains in its original location; rename/move semantics are not used.
- `Ctrl+Wheel` zooms the entire text canvas between 55% and 180% in 15% steps, anchored at the mouse position. Ordinary wheel still scrolls vertically. The toolbar also provides zoom out, 100%, zoom in, and fit-width buttons.

## Block operations

- Use a custom BlockNote `SideMenuController` and Drag Handle Menu.
- Support insert above/below, sibling-subtree movement, full-subtree duplication, type conversion, delete/undo, nest, and unnest.
- The six-dot handle uses Pointer Events instead of native HTML5 drag, which breaks under CSS zoom. Dragging shows an independent fixed insertion line / nesting highlight, and on release the full subtree is moved by transaction.
- In addition to the six-dot handle, image groups can start the same block-level Pointer drag from gray blank areas that are not image, button, or resize-handle regions; internal image drag and size adjustment never bubble into block dragging.
- The upper-right image-group toolbar exposes native hover titles for "Drag image group / Insert image / Capture / Delete image group". Delete uses the same `removeBlocks` path as the left-side block menu, and closes the previous history group before deletion so the toast undo restores only this deletion.
- `Ctrl+D` duplicates the current block, `Alt+↑/↓` performs sibling movement, and Tab/Shift+Tab continue to use BlockNote's native nesting shortcuts.
- Image groups cannot use ordinary indentation nesting, but they can enter the same row through column layout; move, duplicate, delete, and undo are supported.
- Duplicating a regular block strips the original ID so BlockNote generates unique IDs for the whole subtree; duplicating an image group still creates new group/image IDs while reusing the underlying image files.

## Production image interaction

### Live drag preview

- `ImageDragPreviewProvider` owns the production dnd-kit `DndContext`,
  `PointerSensor`, `KeyboardSensor`, collision projection, `DragOverlay`,
  accessibility instructions, and auto-scroller. The old component-local
  `startImageDrag` Pointer Events path and `data-image-drop-target` marker are
  intentionally absent; Pointer Events remain valid for block dragging and
  internal image resize gestures.
- Drag start requires a decoded project-local source and snapshots every
  ordered group, image metadata/crop/frame, and current plan revision. The pure
  domain projector performs same-group normalization, cross-group movement,
  insertion at start/middle/end, and empty-group insertion without mutating the
  snapshot.
- Preview removes the active image from projected source flow, retains a
  source-slot placeholder, inserts an equal-geometry target placeholder, and
  ports a crop-aware, pointer-transparent overlay to `document.body`. Other
  tiles use transform/opacity FLIP motion. Rows wrap before overflow with the
  stable gap; authoritative frames never shrink to fit.
- Pointer collision resolves the containing group before row/image midpoint
  order and applies an 8px/two-sample dead band. Mouse activation is 6px;
  touch/pen activation is 180ms with 6px tolerance. A dedicated auto-scroller
  uses the latest physical pointer in the central viewport's fixed 48px edge
  band, stops at center, never runs for keyboard dragging, and remeasures
  droppables after movement, independent of 55%-180% CSS zoom. Pointer release
  resolves collision synchronously and cancels pending projection frames:
  same-frame valid targets commit once, while outside targets cancel.
- Keyboard interaction uses Space to pick up, arrows/Home/End within a group,
  Ctrl/Cmd+Arrow between groups, Space/Enter to commit, and Escape to cancel.
  Groups follow recursively collected visible document order. A hidden focus
  anchor preserves keyboard input while the active tile is represented by a
  placeholder, then focus returns to the image after cancel/drop. One
  Simplified-Chinese polite live region announces selection, pickup, projected
  group/position, boundaries, commit, and rollback. Reduced-motion preference
  disables reflow and landing transitions without changing order.
- Escape, outside/invalid release, pointer cancel, blur/hidden document,
  project/revision change, deleted group/image, decoded asset or frame change,
  and unmount restore the exact snapshot and cancel queued frames/timers. A
  valid release calls `moveImage` exactly once; Ctrl/Cmd+Z can restore the
  pre-move plan, while autosave/manual save/retirement and PDF/DOCX/long-image
  export observe committed state only. Older queued import/crop/removal/capture
  completions rebase onto the latest reorder and retirement waits for both
  mutation paths.
- Non-goals: multi-selection drag, swapping, freeform coordinates, shrinking
  frames during drag, saving/exporting preview state, or mounting interactive
  controls on the export-only BlockNote surface.

- Selection is global across image groups. A single click selects the tile and
  the same pointer press may become a drag after the 6px movement threshold.
  A drag suppresses the following double-click so reordering cannot
  accidentally open the viewer.
- A body double-click opens the full-image viewer, with Enter as the accessible
  keyboard equivalent. Delete controls and resize handles remain isolated from
  selection, dragging, and viewer activation.
- Only the left and right image handles are rendered. Horizontal pointer
  movement changes both frame width and frame height from the ratio displayed
  at pointer-down; left-side resizing keeps the opposite edge anchored.
- Every resize preview runs the whole ordered image list through the width-led
  layout. Rows wrap before overflow with a stable 7px gap, never overlap, and
  update the group height live. Pointer-up commits the image frame and derived
  group height together; pointer cancellation restores persisted geometry.
- Image frame width and height are authoritative. Editor layout never scales an
  image to fit the remaining row width or persisted group height; it
  wraps immediately before the next image would overflow. A legacy image wider
  than the current inner width remains unchanged on a single clipped overflow
  row until the user directly shrinks it.
- Smart Guides use a 6px entry threshold and 10px release hysteresis.
  Equal-width feedback has first priority, equal-height feedback second, and
  group/image edge alignment third. Equal-size matches show a dimension label;
  edge matches show one dashed positional guide.

## Full viewer and destructive crop

- The viewer starts in non-destructive full-image mode. Crop mode offers
  Original, Free, 1:1, 4:5, 3:4, and 16:9 presets.
- Users can pan the focal point with the pointer, nudge it with the arrow keys,
  zoom from 1x to 8x, independently size a Free crop, reset, cancel, or
  confirm. Draft changes never alter persisted data.
- Confirmation converts normalized crop geometry to strict source-pixel
  bounds, then calls the narrow native crop port. The native command accepts
  only project-relative JPG/PNG files under `references/`, decodes and
  re-encodes the crop, flushes a unique sibling temporary file, and atomically
  replaces the existing project-owned file.
- The relative file identity is preserved. The external file originally
  selected for import is not reopened or written.
- Every image alias that references the overwritten project file is reset to
  the new source dimensions, full-image crop, zero frame offsets, and a frame
  width derived from its retained frame height and the new bitmap ratio.
- Crop overwrite, plan save, image import/removal, and detached cleanup share
  the BlockNote plan service mutation queue. The viewer remains busy during a
  commit, refreshes the active bitmap immediately on success, and keeps the
  crop editor open with an actionable error on failure.
- Queued save snapshots carry their crop revision. A snapshot that queued
  during a crop keeps its newer document content but coalesces metadata from
  the crop before it reaches the manifest.

## Save, reload, and PDF behavior

- A successful crop operation saves the updated schema-v14 metadata, then the
  mounted provider adopts the refreshed plan and marks its current editor
  snapshot unsaved. The normal 5-second autosave, Ctrl/Cmd+S, and project
  retirement flush reconcile that snapshot through the same serialized save
  path.
- Reload resolves the unchanged `references/...` path and reads the physically
  cropped bitmap plus the reset full-image crop metadata.
- PDF export receives the current in-memory plan and refreshed image data. It
  renders the cropped bitmap through the normal image-group layout; subsequent
  reloads export the same project-local bitmap from disk.
- The export menu orders PDF, DOCX, and long-image export. Long-image export
  opens an accessible settings dialog with WeChat-compatible JPEG defaults
  (900px, target 1 MB / 6000px), high-quality JPEG, and lossless PNG presets.
  Automatic splitting is unchecked on every dialog open and remains unchanged
  by preset, format, and width selection. Without opt-in, long documents remain
  one image or fail actionably at the safe limit; with opt-in, they become
  numbered block-boundary parts. The UI reports actual phase and part progress
  after layout and supports cancellation during generation.
- PDF, DOCX, and long-image work share one provider-level export lock.
  Successful native long-image saves reveal the project directory; save-dialog
  cancellation is quiet, while generation/save and non-fatal reveal failures
  remain separately actionable.
- The production React-PDF exporter consumes the platform-independent contract
  in `src/domain/plan/blocknote/pdfVisualContract.ts`. It fixes A4 at
  595.28 × 841.89pt with 24pt
  margins and a 547.28pt content width. The 1080-unit editor surface has 1008
  logical content units, whose root export scale is `547.28 / 1008`; viewport
  zoom is deliberately absent from export geometry.
- The contract fixes 11pt body type, derives H1-H6 from the editor's
  32/24/20/18/16/14px hierarchy, and owns line heights, block spacing, column
  gaps and weights, colors, borders, image-group surfaces, width-conserving
  column rounding, one-page normal-group fitting, and row-safe oversized-group
  pagination.
- The React-PDF preflight validates exact image-group marker/data
  integrity, traverses root and weighted-column content in stable order, and
  creates an immutable `PreshotPdfExportContext` with logical/PDF parent
  widths, editor-equivalent no-shrink group slots, keep-together metadata,
  visual tokens, and indexed groups/assets. Persisted frame width/height stays
  authoritative; parent width selects row breaks and logical-to-output
  conversion only. Preflight stores explicit row IDs, natural and rendered row
  heights, fragment membership, first-fragment padding, and emergency scale.
  A positive persisted group Y offset is represented as first-fragment
  flow-top padding; zero and negative offsets add no flow height.
- A normal image-group mapping uses that padding inside one `wrap={false}`
  outer footprint and removes the positive value from relative positioning.
  An over-height group uses a breakable wrapper of page-safe `wrap={false}`
  fragments. Negative values remain relative positioning on the first
  fragment, preserving the editor-visible offset without double application
  or a negative Yoga height.
- Root image groups use the 1008-unit editor content width and root scale.
  Column children use their weighted, gap-adjusted parent width with
  width-conserving rounding. In either scope, the complete group moves to the
  next page when the remaining space is insufficient. Groups taller than one
  content page start fresh after prior content and split only at existing
  wrap-first row boundaries; consecutive rows pack greedily into fragments,
  with the positive group offset present only before the first fragment. A
  frame wider than its logical parent retains width-only physical fitting.
  A single row taller than the usable page receives a row-local uniform scale
  only when the result remains at least 0.25; otherwise export fails
  actionably. DOCX retains its independent complete-group page-height safety
  scale and long-image behavior is unchanged.
- Reference and native images are resolved only from project-local data maps
  and optimized through the injectable browser canvas optimizer at 144 DPI.
  Normalized source/crop uses share the largest required draw box; missing or
  corrupt data fails with block/group/image context. Hosted proxies and private
  filesystem paths are not part of the preflight contract.
- Ordinary React-PDF block/inline/style mappings compose the official 0.53
  defaults with the visual contract and preflight context. Bundled upright
  Noto Sans SC regular/bold, CJK-safe synthetic italic/code, H1-H6, lists,
  quote/code, row-safe tables, actual link annotations, weighted columns,
  project-local images, accessible media fallbacks, and `emojiSource: false`
  are enforced.
- Native image blocks are measured from local assets and preserve aspect ratio.
  Preflight uses bundled Noto Sans SC regular-face glyph advances to wrap CJK
  characters and Latin words, recalculates wrapping at each candidate image
  width, and iterates image scaling until image height, wrapped caption height,
  and trailing spacing fit one usable page. The final caption lines are stored
  in `PreshotPdfExportContext` and joined with explicit line breaks by the
  React-PDF mapping, preventing renderer-side reflow from invalidating the fit.
- The custom image-group renderer stays behind a typed injected mapping seam.
  Production, browser-memory, and Midscene composition select React-PDF; the
  pdf-lib adapter is explicit rollback-only and is never invoked silently.
- Atomic replacement prevents a failed native write from exposing a partial
  image. The original project bytes remain in a UUID-scoped backup until the
  manifest save succeeds; a manifest failure atomically restores them, and a
  rollback failure is appended to the original save error.
- Backup deletion after a successful manifest commit is non-fatal housekeeping:
  cleanup is idempotent, failures use the standard warning logger, and the
  service retries asynchronously without changing the successful crop result.

## Long-image export contract

- The platform-independent contract supports JPEG and PNG at exactly 900px or
  890px wide. It uniformly scales the 1080-unit editor surface and 1008-unit
  content area; viewport zoom never participates and width is never silently
  reduced.
- The default WeChat preset targets 900px × 6000px JPEG parts, 1 MiB, and
  adaptive quality from 0.84 down to 0.68. High-quality JPEG targets 3 MiB at
  up to 8000px; lossless PNG targets 8 MiB at up to 4000px. The WeChat values
  are conservative empirical compatibility targets, not official limits or a
  guarantee that a client will not recompress the output.
- All presets stop at 32 parts. Retained encoded bytes are capped at 24 MiB
  for WeChat JPEG, 48 MiB for high-quality JPEG, and 64 MiB for lossless PNG.
  The desktop adapter separately rejects raw batches above 64 MiB before the
  dialog, base64 allocation, or the single all-or-rollback Tauri IPC call;
  Rust repeats estimated and exact decoded-byte checks.
- Segmentation chooses the last complete block boundary within the target.
  Atomic blocks may exceed the preferred height up to the absolute 8000px
  safety cap. Larger image groups split only at measured row boundaries;
  other indivisible oversized blocks use explicit emergency pixel tiles with
  warnings. Every part range is contiguous with no overlap or gap.
- Encoded-size decisions are separate from capture. JPEG uses an injectable,
  bounded binary quality search and requests an earlier block/row boundary
  when minimum quality misses the byte target. Oversized PNG requests the same
  re-split. Automatic splitting is opt-in in both the dialog and exporter API;
  an omitted or false `allowSplit` that encounters a required split produces a
  typed error asking the user to enable it, shorten the plan, or use PDF/DOCX.
- Filename planning emits `.jpg` or `.png`, preserves a single unnumbered
  output, and uses zero-padded project-safe names for multipart output.
  Project-title bases normalize to NFC, stop at 120 Unicode code points and
  120 UTF-16 units, and reserve a 128-UTF-16-unit final component budget for
  numbering (`-01` through `-32`) and extension. Dialog-selected renames are
  authoritative only after the same Windows reserved/traversal/length checks.
- The export-only surface uses the exact production schema with local resolved
  assets and no BlockNote image exporter or hosted proxy. One reusable
  `modern-screenshot@4.7.0` context captures parts sequentially; each canvas is
  zeroed after encode and the same-origin worker, context, and offscreen root
  are destroyed after success, failure, or cancellation.
- Desktop save uses one dialog and one serialized native batch. Complete
  preflight precedes writes; commit failure restores exact prior bytes and
  removes only new files still owned by that attempt. Browser downloads one
  part and exposes multipart only through the explicit typed no-op test
  adapter. PDF and DOCX exporters remain independent and unchanged.

## Multi-column layout

- Use `@blocknote/xl-multi-column@0.53.0` under the GPL-3.0 option.
- The schema adds `columnList` and `column` through `withMultiColumn`.
- `/Two columns` and `/Three columns` create resizable column layouts.
- Pointer dragging onto the left/right 20% edge of a block creates or extends a `columnList`.
- Image groups are allowed at the top level or as direct regular-block children of a column, but remain forbidden under paragraphs, lists, blockquotes, or other image groups.
- When text and image groups auto-create a same-row layout, the default column weight is 0.75:1.25; users can drag the column divider.
- The JSON-to-PDF mapping preserves column weights; column content is laid out horizontally, and the entire row paginates as a keep-together unit.

## Native media blocks

- The schema registers BlockNote-native `image`, `video`, and `audio`.
- `uploadFile(File)` writes bytes into project `media/`; when saving JSON, runtime data URLs are converted back to relative paths and resolved back into data URLs before reload.
- Supported formats: JPG/PNG/GIF/WebP (max 16 MiB), MP3/WAV/OGG/M4A (max 64 MiB), MP4/WebM/MOV (max 128 MiB).
- Media blocks may live at the top level, in ordinary nesting, or inside columns, and reuse block operations plus dragging.
- Deletion uses detached media tombstones, and undo restores references; project retirement cleans up unreferenced files.
- Native images in PDF export as bitmaps; video/audio export as `[Video]` / `[Audio]` text cards; external HTTP URLs remain clickable links.
- Tauri CSP explicitly allows `media-src 'self' data:`.
- React-PDF uses the least-privilege CSP allowance
  `script-src 'self' 'wasm-unsafe-eval'`; bundled Noto Sans SC fonts remain
  self-hosted under `default-src 'self'`, and `connect-src` remains limited to
  self plus Tauri IPC. General `unsafe-eval`, wildcard, and broad network
  sources are forbidden.

## Unfinished follow-up

- Upgrade BlockNote from 0.53.0 to 0.54.x once the organization mirror syncs.
- Add Midscene visual validation for BlockNote block dragging.
