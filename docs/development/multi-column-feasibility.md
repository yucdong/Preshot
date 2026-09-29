# Multi-column feasibility and visual study

[Documentation index](../README.md) · [Interactive prototype](../../design-system/preshot/prototypes/multi-column.html)

Status: research baseline, 2026-09-29. Implementation now follows this study;
see the [current editor guide](../features/editor.md) and
[implementation acceptance](../test_reports/multi-column-acceptance.md).
The observations below describe the pre-implementation code and isolated probe.
The interactive prototype is a design reference, not the shipping editor.

## Recommendation

`@blocknote/xl-multi-column@0.53.0` is technically compatible with the current
BlockNote 0.53.0 / React 19 application. Its containers can render our location,
model, props/clothing and image-group blocks. A real, isolated browser probe
confirmed that composition. However, shipping it requires a coordinated schema,
layout, interaction, material-library and export change. Installing the package
and wrapping the editor schema alone is insufficient.

Support **an arbitrary finite number of sibling columns**, without a product
limit of two or three. Two/three-column menu entries are presets, not schema
limits. Qualify increasing counts during delivery rather than treating a small
test matrix as the feature's allowed range. Keep normal full-width blocks
before/after a column row. A column row is a set of independent vertical stacks,
not newspaper text that automatically flows from one column to the next.

Revised direction after review: scale each gallery's image layout uniformly with
its available width, retaining relative frame sizes and arrangement. This is
feasible for image groups and galleries inside location/model/props cards. It
does not remove the separate width requirements of text, buttons, padding or
export formats. No fixed column-count cap does not mean an infinite number can
be legibly displayed on a fixed-width page. Column nesting is a separate scope
decision; arbitrary sibling counts do not require arbitrary nesting depth.

## Evidence and what was actually tested

- Inspected the published **0.53.0** package, not the latest unrelated version.
  Its dependency ranges include `@blocknote/core` / `@blocknote/react` `^0.53.0`, React peer
  support includes 18 and 19, and the relevant Tiptap/ProseMirror versions match
  the installed dependency family. Pin the new package to 0.53.0 on adoption and
  verify one shared ProseMirror/Tiptap graph in the pnpm lockfile.
- The package exposes `withMultiColumn(schema)`, `ColumnBlock`,
  `ColumnListBlock`, `multiColumnDropCursor`, and multi-column slash-menu items.
  Column lists contain at least two columns; each column contains blocks.
  `column.props.width` is a positive **relative flex weight**, default 1, not a
  pixel width or a value that necessarily sums to 1. Normalize weights when
  deriving physical widths or export geometry.
- In `pm-nodes/ColumnList.ts`, the actual content expression is
  `column column+`: at least two columns, with no maximum count in that rule.
  The drop handler can insert another column into the existing row and
  normalizes weights to an average of one. This supports the requested
  no-fixed-count-limit direction; it is not a performance or export guarantee.
- The upstream schema wrapper extends an existing custom schema. Its slash menu
  offers two/three columns and inserts a new row after an existing ancestor
  column row instead of nesting through that menu.
- The package is `GPL-3.0 OR PROPRIETARY`. This is the same licensing choice
  already used for the shipping XL PDF/DOCX exporters; include its notice and
  corresponding source in the existing GPL distribution process, or obtain the
  applicable commercial license. It is not covered by BlockNote core's MIT
  license merely because it shares the same namespace.
- A temporary Vite surface composed the real `withMultiColumn` schema with
  Preshot's existing custom specs and real read-only artifact/image-group
  renderers. Only mock in-memory sidecar readers and local demo images were used.
  Equal columns, unequal columns and three columns rendered without a JavaScript
  exception. This proves renderer composition, **not** production save, editable
  forms, dragging, MSI operation or export acceptance.
- A follow-up probe constructed **4, 6, 12 and 32 sibling columns** with the
  same official schema and unmodified read-only components. All counts rendered
  without a JavaScript exception; geometry exposed the expected spacing and
  readability failure at high counts. See the measured results below. This
  probe also does not implement the proposed image scaling or establish a
  maximum supported count.
- Passing that real column document to the current domain validator failed with
  `Stored document block 2 is an invalid block`. Independently placing a location
  or image group below an ordinary parent failed with `must be top-level`.
  These are intentional current restrictions, not newly introduced defects.

The downloaded archive SHA-256 is
`6a9bce1860a606c74757dbe785dd597cd7e24164b56d7fc9f9d089a24ecb7af9`.
The probe, geometry measurements and validation outputs are retained locally in
`.preshot-build-cache/multi-column`. Upstream references:
[package/version](https://www.npmjs.com/package/@blocknote/xl-multi-column/v/0.53.0),
[source repository](https://github.com/TypeCellOS/BlockNote/tree/main/packages/xl-multi-column).
Conclusions here use the downloaded versioned source; the repository's main
branch may subsequently change.

## Current rendering: the important failure

The production document has a 1080 logical-pixel outer width and 36px padding on
each side: **1008px content width**. The probe uses those dimensions. Upstream
columns have asymmetric internal padding, so equal weights do not produce
identical measured border-box widths.

| Probe | Measured card / inner gallery | Observation |
| --- | --- | --- |
| Equal two columns | Card client width 482px; split tracks about 220px + 131px; image-content region about 113px | Existing 430px container threshold retains the horizontal card layout. A nominal 320px image frame has 318px client width and is clipped inside the much narrower gallery. |
| Three equal columns | Card client width about 307px; stacked inner layout about 275px; image-content region about 257px | Cards do switch to stacked content, but the same nominal 320px image is still clipped. Stacking alone does not solve image sizing. |
| Standalone image group in two columns | Image-content region about 466px | Two 320px frames wrap to separate rows. They are not automatically reduced to fit one row. |

[Real two-column component probe](../prototypes/media/multi-column-current-two.png)
· [Real three-column component probe](../prototypes/media/multi-column-current-three.png)

The reason is concrete: `layoutDocumentImageGroupForWidth()` always calls its
layout helper with scale **1**. It wraps before overflow but never shrinks an
oversized individual frame. The export/preview gallery then hides overflow.
The editable renderer shares this layout function, although its exact controls
and clipping behaviour still need their own multi-column acceptance tests.

The card already has `container-type: inline-size`, full-width/min-width-zero
behaviour, and a 430px stacking query. These are useful starting points. The
current grid also reserves a 220px minimum for the text side; 40/60 proportions
cannot be maintained once that minimum dominates a narrow card.

## Proposed component behaviour

| Component | Two columns | Three columns / narrow columns | Required adjustment |
| --- | --- | --- | --- |
| Location | Name, address/notes and sample images can be displayed | Stack text above photos; let long notes increase height | Switch by the card's own content width, not the app viewport; constrain gallery frames |
| Model | Good with stacked fields and sample images | Full form becomes tall; a compact summary/edit mode may be useful later | Preserve readable labels/units; keep two field columns only while each field has usable width |
| Props/clothing | Good for short descriptions and samples | Stack description/images; expanded clothing galleries need more height | Constrain each gallery independently; preserve legacy clothing identity |
| Image group | Good; scale the image layout together | Keep arrangement and scale further; tiny previews need a larger editing surface | One common gallery scale, including offsets/gaps; reflow is a separate explicit mode |
| Native image | Good within the column | Limit the preview frame to the column | Keep project-owned media identity; audit `previewWidth`, resize events and exporter sizing |
| Text/list/table | Text/list normally reflows | Wide tables can still overflow | Define scroll/fit policy and verify selection/keyboard/row handling; do not promise every table fits |

Suggested initial rules, **not upstream defaults**:

- Card fills its containing column; its outer box has no resize handle.
- Prefer a consistent text-above-gallery arrangement **inside columns**, with
  the familiar two-area layout available for full-width cards. A breakpoint
  between 40/60 and stacked layouts can suddenly give the gallery more width
  while its containing column gets narrower, making images visibly jump larger.
  The earlier prototype uses a 560px content-width breakpoint for comparison;
  this should not be mistaken for the final continuous-resize contract.
- Preserve logical font size; do not apply a transform to shrink a whole form.
  Global document zoom remains a separate existing action.
- Use width thresholds for compact presentation or expanded editing, not for
  refusing another column. The earlier 260px suggestion is a readability
  reference, not a mandatory minimum. Define overflow when physical space runs
  out. Upstream's minimum weight of 0.5 is not a pixel readability guarantee.
- Wrap toolbars, using short/icon actions plus accessible names in narrow spaces.
  Keep popovers and crop controls outside clipping containers where needed.
- Retain a separate full-width material editor. Saving a card from a column
  should save the component and image choices, not its surrounding column row.

The prototype uses a **20px gutter** between proposed columns. At 1008px content
width, equal columns are 494px each; 2:1 columns are approximately 659/329px;
three columns are approximately 323px each. These are proposal dimensions and
differ from the upstream padded column probe above.

## Image scaling: three independent operations

### 1. Resizing a column is a layout change

Keep original image bytes, normalized crop, fit mode and preferred frame
dimensions unchanged. Compute a temporary display frame from the image's
current **local available width**, after column/card/gallery insets.

For a zero-offset frame with preferred dimensions `(W, H)` and available width
`A`, a conservative compatibility rule is:

```text
s = min(1, A / W)
displayWidth  = W * s
displayHeight = H * s
```

For example, a 640 × 480 preferred frame in 300px of usable space renders as
300 × 225. Widening the column restores its preferred size up to 640 × 480.
This does not resample the file, change crop, autosave new image dimensions or
add image-edit undo entries. When frames have offsets, fit their complete
footprint and scale offsets consistently; the simple formula is insufficient.

For the revised **scale-the-group** direction, resolve row-major geometry once
at a stable reference inner width `B`, then use one common factor:

```text
galleryScale = availableInnerWidth / referenceInnerWidth
displaySlot  = referenceSlot * galleryScale  // x, y, width and height
displayGap   = referenceGap * galleryScale
displayImageAreaHeight = referenceImageAreaHeight * galleryScale
```

Include each signed offset's complete footprint in the reference geometry.
Scale image-area insets consistently, or subtract any fixed insets before
calculating the factor. Leave card text/header/controls outside this image-only
geometry. The outer card's height is its reflowed text/controls plus the scaled
image area's height; it is not the old whole-card height multiplied by the scale.

Example: two 320 x 240 frames with a 7px gap occupy 647px. In a 300px image area,
the common factor is about 0.464: each frame is about 148.4 x 111.3, and their
gap is about 3.2px. They remain side by side. Scaling only each frame to a maximum
300px and re-running wrapping would instead put them on separate rows; that is
a different layout policy from shrinking the group together.

Do not multiply the last displayed sizes repeatedly when dragging: derive each
frame from immutable reference geometry to avoid rounding drift. A stable
reference-width policy is essential for reopening, export, library insertion
and moving a group between columns. Existing `group.width` is currently a
fallback rather than a validated reference-width contract. Define/version that
meaning or derive a canonical reference from document/card layout; do not adopt
the last measured DOM width as persistent truth. Preserve single-column legacy
appearance during migration. Enlarging a column may enlarge the display back
from its small state; enlargement above the preferred reference can either be
allowed or explicitly capped at one, without resampling the source file.

The existing `compactArtifactGalleryImages()` also derives new frames from
source aspect ratios and resets offsets. It is not a drop-in implementation of
this contract, which must preserve chosen frame aspect, crop and offsets.

Use shared resolved geometry for editor hit testing, drag placeholders, preview
and all exports. CSS `transform: scale()` alone leaves the old flow dimensions
and input hit regions unless the wrapper is also adjusted. Derived slot sizes
and an explicit scaled container height fit the existing renderer better.

### 2. Resizing an image is an explicit image edit

The existing eight continuous resize zones can remain:

- Corners preserve the displayed frame ratio at pointerdown.
- Left/right edges change only width; top/bottom edges change only height.
- Clamp horizontal extent to the containing gallery/column, not the whole page.
- Freeze the local width/geometry at gesture start. Convert screen-pixel movement
  to logical units using document zoom. Do not mix already-scaled display sizes
  with unscaled persisted dimensions; that creates jumps or an immovable edge.
- For an individually fitted, fixed-size image, one option is to start from the displayed frame and
  commit a deliberate new preferred size on a successful changed resize. A
  click with no resize and a cancelled gesture must retain the old preferred
  size. This makes shrinking a constrained image predictable when it later moves
  back to a wide column. One resize is one undo operation.
- If retaining raw preferred-coordinate editing instead, map deltas through
  `zoom × displayScale` and specify the resulting wide-column behaviour. Do not
  mix the two semantics within one gesture.

For uniform group scaling, reference-coordinate editing is the natural choice:
freeze `galleryScale`, reference width and document zoom at pointerdown, and map
movement through their product. A screen movement of 20px at document zoom 0.8
and gallery scale 0.5 means 50 reference units. Snapping candidates, guide lines,
offsets, minimum frame constraints and keyboard increments must use the same
coordinate contract. Reference-size minima must not force the displayed image
to overflow a tiny column. Keep focus/resize affordances usable in screen space;
when they overlap on very small previews, use expanded editing or toolbar actions.

An explicit **follow column width** mode can later store a fractional width plus
frame aspect. That requires a defined schema/export representation, including
the native image block's currently pixel-based `previewWidth`. Keep old frames
as fixed preferred-size input; do not silently convert every old image to a
percentage. The prototype's width slider demonstrates this optional relative
interaction, not an already implemented persistence contract.

### 3. Fit/crop is a content choice

`cover` preserves image proportions while filling the frame; changing only one
frame axis changes how much of the photo is cropped. `stretch` intentionally
distorts the pixels to match the frame. Changing column width alone preserves
the frame aspect and therefore must not choose a new crop or stretch mode.
Keep normalized crop coordinates relative to the source and original files
immutable. A contain/letterbox mode could be a separate feature; it is not one
of the application's current fit modes.

The earlier prototype's optional two-per-row design computes `(A - gap) / 2` as the slot width and
falls back to one slot below a minimum useful width. It is explicitly different
from current no-shrink wrapping. The prototype falls back below 307px of usable
space (two 150px slots plus a 7px gap); treat that as an initial design value.
It demonstrates responsive reflow, not the revised preserve-arrangement common
scale policy. Do not automatically change rows at this threshold in that policy.

## Arbitrary column counts: remaining constraints

For equal columns within the proposed 1008px content width and 20px gutters,
before card padding, the width is `(1008 - (N - 1) * 20) / N`:

| Count | Width per column | Practical implication |
| --- | --- | --- |
| 4 | 237px | Stacked cards and wrapped controls remain plausible |
| 6 | 151px | Images can fit; full field labels and action bars need compact treatment |
| 8 | 108.5px | Useful as image previews; direct editing becomes difficult |
| 12 | 65.7px | Text and controls dominate even if images are perfectly scaled |

These are illustrative proposal dimensions, not measurements of upstream CSS.
At sufficiently large counts the gutters alone consume the entire page. Core's
current columns similarly have fixed horizontal padding (normally 40px per
middle column) and `overflow-x: auto`. Image scaling cannot reclaim that space.

Actual follow-up measurements with upstream padding, a 1008px row, four custom
blocks and additional short text columns:

| Count | Inner width per column after upstream padding | Row width / scroll width |
| --- | --- | --- |
| 4 | About 222px | 1008 / 1008px |
| 6 | About 135px | 1008 / 1008px |
| 12 | About 47px | 1008 / 1008px |
| 32 | 0px | 1008 / 1240px |

[Six-column current rendering](../prototypes/media/multi-column-current-6.png)
and [twelve-column current rendering](../prototypes/media/multi-column-current-12.png)
show wrapped field labels, header crowding and clipped image frames. The 32-column
case exhausted the row's width through padding alone; it did not hit a schema
count restriction. Measurements were rounded by the browser's client dimensions.
The local fixture/results are in `.preshot-build-cache/multi-column/inspect-many.mjs`
and `many-results.json`. These are layout observations, not editable or performance
acceptance tests.

Recommended behavior is: allow adding columns, proportionally distribute usable
width while it exists, reduce decorative spacing for dense rows, then provide
row-level horizontal overflow when a positive usable column width can no longer
be maintained. Selecting a tiny card can open a larger editing surface without
changing the saved layout. Do not silently delete columns, wrap them into new
rows, clip content, or shrink form text to illegibility. The exact dense-row
transition is a UI decision to qualify, not a fixed maximum count.

| Concern | Why scaling images is insufficient | Required behavior |
| --- | --- | --- |
| Text and fields | Chinese can become one character per line; English words/URLs and inputs can overflow | Wrap safely, preserve font size, use compact summaries and expanded editing where necessary |
| Pointer targeting | Upstream column resizing uses 20px edge regions; our images have eight resize zones and their own drag targets | Resolve competing gestures, keep handles in screen coordinates, provide keyboard/menu alternatives |
| Height and ordering | Independent columns have different heights; following full-width content starts below the tallest | Accept whitespace, preserve column-major document order and reading/selection order; do not promise masonry or automatic text flow |
| Column removal | Removing/moving the final block can trigger upstream empty-column normalization | Preserve remaining content/IDs, clear stale anchors, collapse a one-column row predictably, and undo as one operation |
| History/autosave | Upstream 0.53.0 writes node widths on mousemove with `addToHistory: false`; its mouseup only changes plugin state | Add a deliberate undoable width commit and control autosave of intermediate weights. Do not assume upstream already records one resize undo |
| Performance | Small CSS previews still decode the original images; many columns add nodes, observers and hit-test work | Reuse decoded assets, batch measurements, calculate layout without re-importing files, and avoid per-image persistence on column resize |
| Data compatibility | Current TS/Rust validation, clipboard and library receipts require single-column structure | Version the structure, preserve ownership/IDs, use column-aware anchors and native exact-delta validation |
| Resource bounds | No fixed column cap still runs on finite memory and finite document/IPC size | Keep finite-number, document-size, total-node and depth validation; measure large-count behavior rather than advertising unlimited capacity |
| Export | Fixed paper width cannot represent indefinitely many columns at readable size; DOCX uses table cells, and long-image splits cross every column | Resolve all column widths, verify supported target limits, offer explicit fit/wider-page/grouped output where implemented or return a useful error; never silently discard/flatten columns |

Sibling-column count and nesting depth must be tested separately. In upstream
0.53.0, a column's direct children are `blockContainer+`; the menu deliberately
avoids creating nested column rows. Do not infer arbitrary direct nesting from
the absence of a sibling-count maximum.

## Production integration map

| Area | Current restriction / implementation | Necessary change |
| --- | --- | --- |
| Editor schema | [preshotBlockNoteSchema.ts](../../src/features/plan/blocknote/preshotBlockNoteSchema.ts) omits column types | Extend the existing schema with `withMultiColumn`; register column menu/drop behaviour and localization alongside existing menus |
| Domain/manifest | [blockDocument.ts](../../src/domain/plan/canvas/blockDocument.ts) allows neither type and requires artifact/group markers at the document root | Version the change; a candidate is plan v16/document v4. Validate column-only parent structure, positive finite weights, total-node/depth/size bounds and unique sidecar references, without a two/three-column cap. Migrate old single-column plans without regrouping them; old readers should fail clearly |
| Native paste | [image_paste_validation.rs](../../src-tauri/src/image_paste_validation.rs) explicitly rejects columns | Update its closed structure/delta validation and durable receipts for column-aware insertion; preserve independent physical files |
| Material save/insert | [validation.rs](../../src-tauri/src/library/validation.rs) requires top-level snapshots and top-level insertion deltas | Find an allowed component inside a column, freeze its identity and column/sibling insertion anchor, and validate an exact local delta; never broadly allow arbitrary document mutations |
| Block drag | [blockPointerDrag.ts](../../src/features/plan/blocknote/blockPointerDrag.ts) and [blockOperations.ts](../../src/features/plan/blocknote/blockOperations.ts) hoist component targets to the top-level ancestor | Recognize column parents; arbitrate block drag versus column resizing versus image-tile drag; preserve valid-on-release and single-commit guarantees |
| Image geometry | [documentImageGroupLayout.ts](../../src/domain/plan/canvas/documentImageGroupLayout.ts) wraps at scale 1; [ImageGroupBlockView.tsx](../../src/features/plan/blocknote/ImageGroupBlockView.tsx) measures local width | Resolve a stable reference layout plus one common gallery scale, correct resize coordinates, handle clipping and live width changes without editing preferred sizes |
| Card layout | [styles.css](../../src/styles.css) has 430px container query / 220px text minimum | Adjust based on real editable controls and both languages; cover compact and long-content cases |
| Cached editors/history | Open sessions preserve editor instances; upstream resize updates node weights during mousemove and excludes them from history | Avoid image reload/recreation and excessive autosaves; add a deliberate one-operation undo/redo boundary |
| Library payloads | Single-component snapshots with independent images | Keep a component payload independent of its surrounding column layout. Whole column-row materials would be a separate feature |

The domain's recursive traversal is useful groundwork, but relaxing the list of
block names alone still fails its explicit top-level marker rules and native
material insertion contracts.

## Export is part of the feature

| Format | Upstream support | Preshot work still required |
| --- | --- | --- |
| PDF | Default `column` renders a flex-weighted React-PDF View; `columnList` is a horizontal row | Current [mappings](../../src/infrastructure/pdf/blockNoteReactPdfMappings.tsx) explicitly delete both mappings. Restore/customize them and propagate each column's width through [preflight](../../src/domain/plan/blocknote/pdfExportPreflight.ts), custom image/card geometry and pagination. Prove short rows stay together and tall rows paginate without overlaps or clipped text/images |
| DOCX | Default columns become borderless table cells in one table row | Current [mappings](../../src/infrastructure/docx/preshotDocxMappings.ts) delete them. Normalize weights into fixed usable cell widths, size nested cards/composited groups/native images to their cells, and test Word's table pagination. This is a table layout, not newspaper-style Word sections |
| Long image | The shared DOM schema can render columns once extended | Current block/row-aware splitting assumes a vertical block stream. A cut must be safe across **all** columns at that y-coordinate; a boundary safe in one column can bisect a photo in another. Keep a short column row intact, calculate common safe cuts for tall rows, or fail actionably when no safe split exists |

Restoring upstream mappings is a starting point, not export acceptance. The
current PDF preflight understands nested parent dimensions, but does not yet
allocate column widths. DOCX uses custom card tables and image compositing that
need their actual cell width. Long-image splitting must retain the existing
memory, pixel, byte and part-count limits. Do not silently flatten columns or
switch exporters on failure. An explicit “export as a single column” option could
be separately offered if desired.

## Visual artifacts and their limits

Open [the offline HTML prototype](../../design-system/preshot/prototypes/multi-column.html) in Edge or
Chrome. Its images are embedded; it makes no network requests. Available controls:

1. Single column, equal double column, 2:1 double column and triple column.
2. Column ratio slider, pointer divider and keyboard arrows.
3. Image selection, width slider, corner drag, frame aspect and cover/stretch.
4. Two-per-row versus preferred-size group layouts.
5. Proposed stacking versus a simplified current-size comparison; reset.

It uses a purpose-built presentation of the same example data, **not a mounted
production editor**. Its tool icons are illustrative; it has no real upload,
capture, library, save, block-drag or export implementation. The “current rules”
view illustrates overflow using scrolling and is not a pixel-exact replay of
the real clipped renderers. Use the real probe screenshots above for evidence
of the actual current behaviour.

[Overview](../prototypes/multi-column-preview.png)
· [Proposed 2:1 layout](../prototypes/media/multi-column-proposed-wide.png)
· [Proposed three-column layout](../prototypes/media/multi-column-proposed-three.png)

Verified in an isolated headless Edge browser: all four presets, seven decoded
images, no column overflow in proposed layouts, ratio boundaries, square frame,
stretch, image-corner drag, column-divider drag, comparison/reset and a 600px
browser viewport. No JavaScript errors. The narrow browser scales the existing
logical paper like Preshot's document zoom; it does not prove phone editing
usability. The current-rule mode intentionally exposes oversized frames.

The interactive HTML remains the earlier four-preset study. It does not yet
implement arbitrary column counts or the revised common-scale geometry; use
the revised sections above for that contract.

## Suggested delivery order and acceptance

1. **Data contract first:** versioned schema, migration, valid column structure,
   unique group/artifact references and column-aware native save/paste/library
   receipts. Add rejection and recovery tests before changing the contracts.
2. **Column editor without a preset-count limit:** insert/move/delete columns and blocks; preserve cursor,
   keyboard focus, undo/redo, cached sessions, source images and draft ownership.
   Add common-scale gallery geometry and verify 1:1, 2:1, increasing column
   counts, extreme ratios, row overflow, zoom and English UI. Assert unchanged
   image data across repeated shrink/grow and save/reopen cycles.
3. **All three exports:** mixed text/cards/images and a tall-column case; inspect
   actual PDF pages, DOCX output and long-image pixels/split boundaries.
4. **Installed acceptance:** MSI create/save/restart, native image import/capture,
   material insertion into arbitrary columns and recovery, then large-document
   performance. Include legacy single-column migration and unsupported-target
   export errors in acceptance.

This is a cross-cutting layout feature with substantial regression scope. The
probe supports adopting the official container implementation; it does not
support enabling production columns before the data and export work is complete.
