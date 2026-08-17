# BlockNote Canvas v14 multi-column design (including v13 migration history)

**Status:** Migration implemented; legacy TipTap editing path and direct dependencies removed
**Date:** 2026-08-14
**Detailed implementation plan:** session `plan.md`

## Confirmed decisions

- New projects save schema v14 / document v2 BlockNote JSON.
- Schema v13 / document v1 plans migrate to v14 during load and are immediately persisted. Schema v1-v12 projects cannot be opened, viewed, or exported, and their files are not modified.
- Use the npm-published BlockNote build. The highest version currently available in the organization mirror is 0.53.0; 0.54.0 was not installed because the mirror has not synced yet and the official npm registry TLS request failed.
- The UI uses `@blocknote/mantine`.
- Text capability uses native BlockNote functionality, allowing H4-H6, font size, and similar features to degrade.
- Image groups are `content: "none"` React custom blocks that persist only `groupId`.
- Image-group metadata is stored independently in `imageGroups`.
- Image groups may live at the top level or as direct children of columns, and use the Preshot Pointer side-menu handle for dragging.
- Duplicating an image group generates new group/image IDs while reusing the same image file plus frame/crop data.

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
  - image import, viewing, deletion, dragging, and eight-direction resize.
  - Enter-to-create-block does not use `onBeforeChange(getChanges)`; image-group hierarchy constraints are normalized after the change so a brand-new block without an ID does not interrupt the ProseMirror transaction.
- `src/infrastructure/pdf/blockNotePdfExporter.ts`
  - traverses JSON directly;
  - does not round-trip through HTML;
  - reuses image-group crop/frame/layout.

## Runtime entry

BlockNote v14 is the only editable canvas entry point. There is no longer a TipTap feature flag or dynamic rollback provider. Old-schema projects only show version incompatibility and do not load legacy editor code.

The persisted version has now been upgraded to schema 14 / document version 2. Schema 13 is automatically migrated and immediately saved on open; schema 1-12 remains blocked.

## Continuous-canvas strategy

- The editing UI no longer renders A4 page surfaces, page seams, pagination corner markers, or runtime spacers.
- The canvas keeps a fixed logical width of 1080px, with 36px page padding on each side. BlockNote no longer adds duplicate internal padding, so the effective editable width is about 1008px.
- When opening or switching projects, maximize the Windows app window by default while keeping the project sidebar and assistant sidebar persistently visible. Focus mode can still be enabled manually, in which case both sidebars become floating layers opened on demand.
- On first open, auto-scale to the available width, keeping only about 20px workspace margin. Short documents fill at least the visible height; long documents keep only about 20px after the tail to avoid large meaningless gray areas.
- Page scrolling is handled only by the central workspace; no internal paginated scrolling area is created inside the editor.
- PDF export continues to paginate separately to A4 inside `blockNotePdfExporter`; the screen no longer promises WYSIWYG matching to PDF page breaks.
- Image groups read actual `.bn-block-content` width, fill it by default, and stay left/right aligned. Persisted width/x is clamped to that range and cannot cross the white canvas.
- After image import, original pixel width/height are measured. Batch images keep the same `frameHeight`, and `frameWidth = frameHeight × sourceWidth / sourceHeight`, with full original crop persisted so landscape and portrait images are never stretched.
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

## Unfinished follow-up

- Upgrade BlockNote from 0.53.0 to 0.54.x once the organization mirror syncs.
- Add Midscene visual validation for BlockNote block dragging.
