# Preshot UI/UX Contract

**Status:** Active for `0.0.1`
**Platform:** Windows desktop
**Runtime language:** Simplified Chinese

## Workspace

- Opening a project maximizes the window.
- The project panel and assistant panel remain visible by default.
- The center workspace uses the available viewport with restrained gray margins.
- The white document has a fixed logical width of 1080px and can extend vertically.
- Mouse-wheel zoom uses 15% steps and remains anchored near the pointer.
- Fit-width keeps the document readable without creating a large gray gutter.

## Document editing

- BlockNote v14 is the only editable document surface.
- Text, image groups, images, video, audio, and column layouts participate in
  one continuous block document.
- Native block controls support insertion, movement, nesting, unnesting,
  duplication, conversion, and deletion.
- The compact block control strip stays inside the 36px white-page padding,
  does not overlap text, and scales with the document zoom.
- Pointer-based block dragging is used instead of native HTML5 dragging so
  drop geometry remains stable under CSS zoom.

## Image groups

- An image group can be moved from its six-dot handle, toolbar label, or
  non-interactive gray surface.
- A group can move before or after other blocks or into a column layout.
- Images can move within a group or between groups.
- Dragging previews the complete post-drop row-major layout for same-group,
  cross-group, end-position, and empty-group targets. The committed source slot
  and projected insertion slot remain visible while a crop-aware overlay
  follows the pointer outside the CSS-zoomed document.
- Preview rows wrap before overflow and never shrink authoritative image
  frames. Preview state is reversible and never appears in autosave or export;
  release commits one move, while Escape or invalid/stale state restores the
  original layout. The latest committed move is one Ctrl/Cmd+Z boundary.
- Mouse dragging activates after 6px. Touch and pen require a 180ms hold with
  6px tolerance. The workspace auto-scroll zone is 48px from each edge and
  works from 55%-180% CSS zoom.
- Keyboard users use Space, arrows, Home/End, Ctrl/Cmd+Arrow, Enter, and Escape.
  Group traversal follows visible recursive document order. Focus remains on a
  hidden keyboard anchor while the active image is a placeholder and returns
  to the image after cancel/drop. Simplified-Chinese polite announcements
  identify the group and human position and explain boundaries, commits, and
  cancellations.
- Motion uses transform/opacity only and is removed under
  `prefers-reduced-motion`; the final order and focus behavior stay unchanged.
- Drag cannot start before the local image decodes. Project/revision changes,
  deletion, asset/frame changes, blur, hidden-document state, pointer cancel,
  and unmount cancel stale work.
- Release uses the latest pointer position even before the next animation
  frame: valid stable targets commit once, while outside release rolls back
  instead of committing the last visible preview. Pointer auto-scroll tracks
  physical pointer movement only and stops in the viewport center.
- A single click selects an image and may begin dragging after the movement
  threshold. A pointer opens the full viewer only by double-clicking the image
  body; Enter is the keyboard equivalent.
- Images expose left and right resize handles only. Side resizing preserves the
  ratio displayed at pointer-down and anchors the opposite side.
- Imported images start at exactly 240 logical units high, with width derived
  from source aspect ratio. Batch imports share that height. On project load,
  untouched approximately 135-unit legacy defaults upgrade across all groups;
  square placeholders resolve to source/crop ratio during hydration, while
  intentional custom sizes do not change. A one-time polite notice asks the
  user to review the resulting layout while normal autosave persists it.
- Image groups retain four edge handles and four corner handles.
- Image resize previews reflow every image live, preserve order and stable
  gaps, wrap before overflow without overlap, and grow or shrink the group to
  the resulting content height. Pointer-up commits the coherent image/group
  geometry; pointer cancellation restores it.
- Frame dimensions remain authoritative during idle layout, load, and resize
  preview. Layout never scales images to fit a row or persisted group height;
  an oversized legacy frame occupies one clipped overflow row until a direct
  side-handle resize makes it narrower.
- Equal-width and equal-height feedback takes priority over group/image edge
  alignment. Equal-size matches show a dimension label; edge matches show one
  dashed guide. Guide entry/release thresholds prevent flicker.
- The image body is the selection/drag target. Controls use the normal arrow
  cursor, side handles use horizontal resize feedback, and editable text alone
  uses the text cursor.
- The compact upper-right toolbar exposes drag, insert image, screen capture,
  and delete actions with native hover titles.
- Deleting a group follows the same tombstone, notification, and undo behavior
  as deleting it from the block menu.
- There is no automatic size-reset command; frame size is user-controlled.
- Multi-image drag, swapping, freeform placement, preview persistence/export,
  and interactive drag controls in export-only surfaces are non-goals.

## Full-image viewer and crop

- Pointer users open the full-image viewer only from an image-body
  double-click; keyboard users can press Enter on the focused image.
- Crop mode provides Original, Free, 1:1, 4:5, 3:4, and 16:9 presets, pointer
  panning, keyboard nudging, 1x-8x zoom, Free width/height controls, reset,
  cancel, and confirm.
- Crop drafts are reversible. Escape, backdrop close, Cancel, or Reset never
  writes a draft; closing is disabled while confirmation is in flight.
- Confirming a crop physically overwrites only the image copy stored in the
  open project's `references/` directory. The external source selected during
  import remains unchanged.
- Progress, success, and actionable failure feedback stay in the viewer. A
  successful commit refreshes the viewer and document tile immediately.

## Columns

- Two- and three-column layouts can be inserted from the slash menu.
- Edge dropping can create a same-row column layout.
- Column widths are user-resizable and persisted.
- Image groups are valid as top-level blocks or direct column children.

## Media

- Native BlockNote image, video, and audio blocks use project-owned media
  files.
- Persisted documents store relative `media/...` paths; runtime rendering uses
  resolved data URLs.
- Image imports are limited to 16 MiB, audio to 64 MiB, and video to 128 MiB.
- Successful Windows captures are imported into the project and their
  Preshot-owned temporary PNG is discarded.
- Reload reads confirmed reference-image crops from the same project-relative
  path. Autosave persists the refreshed schema-v14 frame/source metadata, and
  PDF export uses the cropped project bitmap and current layout.

## PDF export

- Export uses the official `@blocknote/xl-pdf-exporter@0.53.0` mappings with
  `@react-pdf/renderer@4.3.0` as the production default. The legacy `pdf-lib`
  adapter is rollback-only and is never selected after a production failure.
- Output is A4 at 595.28 × 841.89pt with 24pt margins. The continuous editor
  does not show PDF page breaks, but ordinary blocks preserve their BlockNote
  semantics and custom image groups preserve their visible frame, crop,
  wrapping, spacing, and root/weighted-column geometry.
- Image groups are indivisible export units. A whole group moves to the next
  page when the current page lacks room. PDF and DOCX use the editor's same
  ordered wrap-before-overflow layout with authoritative persisted frame
  dimensions; root/column widths only select row breaks and coordinate scale.
  A whole group is uniformly reduced only when its complete physical footprint
  exceeds the page/column width or usable page height. Individual frames are
  never fitted to a row.
- Positive vertical group offsets reserve matching flow space so following
  content and pagination remain WYSIWYG. Zero/negative offsets never create a
  negative layout footprint.
- Native image blocks preserve aspect ratio and fit within the available page
  width and height. Multiline captions wrap with bundled Noto Sans SC metrics;
  export iteratively fits the image against the exact wrapped caption height,
  then renders those precomputed lines so the complete image/caption block
  stays on one usable page. Video and audio remain readable as labeled fallback
  rows.
- Export preflight resolves and optimizes only project-local assets. Missing or
  corrupt assets produce an actionable error; the app does not use a hosted
  proxy or silently emit degraded fallback output.

## Long-image export

- Long-image output is a continuous JPEG or PNG at exactly 900px by default;
  890px is the only compatibility width. The app never silently reduces width.
- The default WeChat preset prefers 6000px JPEG parts at 0.84 quality and
  adapts no lower than 0.68 before splitting at an earlier block boundary.
  Lossless PNG prefers 4000px parts. No part may exceed the absolute 8000px
  safety cap.
- WeChat height/byte/quality values are conservative empirical compatibility
  targets, not official upload limits. The dialog must not promise guaranteed
  acceptance or absence of platform-side recompression.
- Every preset stops at 32 parts. Total retained encoded-image limits are
  24 MiB for WeChat JPEG, 48 MiB for high-quality JPEG, and 64 MiB for
  lossless PNG. The desktop save boundary separately accepts at most 64 MiB of
  raw image bytes in its single rollback-safe IPC batch.
- Long documents remain one image by default. Automatic splitting requires the
  user to check **Automatic splitting**; it preserves atomic blocks, uses
  image-group row boundaries only for oversized groups, and emits contiguous
  multipart files with project-safe zero-padded names.
- Project-title output bases normalize to Unicode NFC and are capped at 120
  code points and 120 UTF-16 units. Final generated or dialog-selected
  filename components are capped at 128 UTF-16 units. Valid dialog renames are
  authoritative; invalid reserved, trailing, traversal, or over-limit names
  fail before native invocation.
- If automatic splitting is disabled and safety or encoded-size limits require
  more than one image, export fails with an actionable error instead of
  reducing dimensions or silently degrading output.
- The top-right export menu remains ordered PDF, DOCX, long image. Choosing
  long image opens a modal settings dialog for preset, JPEG/PNG, 900/890px,
  and automatic splitting; it does not start work until **Start export**.
- Automatic splitting starts unchecked on every new dialog. Preset, format,
  and width changes never enable it, and its prior value is not retained after
  the dialog closes.
- The dialog is labelled/described, traps focus, starts on the first preset,
  closes on Escape or backdrop/cancel, and restores focus to the export trigger.
  If the shared export lock is busy, it remains open instead of pretending the
  export started.
- During generation the export trigger shows long-image-specific disabled
  progress, the live region reports phase and N/M part progress, and
  cancellation is available until save begins. Errors remain visible and do
  not produce success-shaped files.
- Desktop save cancellation and any generation/write failure do not reveal
  Explorer. A successful native batch reveals the project directory; a reveal
  failure is a separate non-fatal notice. One-part browser output downloads
  directly, while browser/Midscene multipart uses the documented typed no-op
  test adapter and never claims to create a ZIP.
- Long-image export is an additional output path only. PDF and DOCX menu
  behavior, mappings, pagination, filenames, and save/reveal semantics remain
  unchanged.

## Feedback and accessibility

- Icon-only actions have accessible names and native hover titles.
- Destructive actions use explicit danger styling and confirmation where data
  loss would otherwise be surprising.
- Save failures remain visibly unsaved and show an actionable error.
- Unexpected rendering failures remain the responsibility of the application
  error boundary; expected operation failures are handled locally.
- Contributor documentation remains English; the production runtime UI,
  including viewer and crop labels, remains Simplified Chinese.

## Historical specifications

Earlier TipTap, paged-canvas, split-text, and card experiments remain under
`docs/design_docs` and `docs/design_refs` as historical design evidence. They
do not override this contract or the current architecture documentation.
