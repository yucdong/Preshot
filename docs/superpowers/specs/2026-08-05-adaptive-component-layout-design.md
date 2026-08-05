# Adaptive Component Layout and Drag Preview — Design

## Goal

Make photography-plan and reference-image components size themselves from their
content instead of retaining a manually fixed height. Text and image rows should
grow naturally, reference images should keep their original aspect ratio without
cropping, and dragging components or images should show the final insertion
position through a live animated placeholder before the pointer is released.

## Decisions

- Component height is fully automatic. Users can still resize component width,
  but the top, bottom, and corner height handles are removed.
- Existing reference-image heights are migrated once to `oldHeight * 0.75`.
  The image-height +/- control remains, with a 15pt step instead of 20pt.
- Images are displayed in full (`object-contain`), never cropped. At a requested
  height `H`, width is `H * aspectRatio`; oversized single images scale down
  proportionally to fit the available row width.
- Reference groups have no internal scrollbar. More images create more rows,
  which increases the component height.
- A reference group taller than an A4 content area is split at image-row
  boundaries across pages. Its first fragment contains the editable heading,
  description, and controls; continuation fragments repeat a read-only
  `<title>（续）` heading.
- Photography-plan rich text remains one BlockNote editor. Its natural DOM
  height is measured at runtime. When it spans multiple pages, the canvas shows
  page-break markers while retaining a single editor instance.
- Components and images use live sortable reflow with an equal-size placeholder
  and `DragOverlay`. The drop target is visible before release.
- Reduced-motion users get the placeholder and final position without animated
  translation.

## Data Model and Migration

Introduce `ProjectPlan.schemaVersion = 4`.

`BaseComponent` keeps:

```ts
interface BaseComponent {
  id: string;
  width: number;
}
```

The persisted `height` field is removed from the v4 model because height is now
derived. The v3-to-v4 migration:

1. Copies component identity, type, width, text, titles, descriptions, captions,
   and images without loss.
2. Drops the old component `height` value.
3. Replaces each reference component's `imageHeight` with
   `clampImageHeight(oldImageHeight * 0.75)`.
4. Runs only when `schemaVersion === 3`, so already-migrated projects are never
   reduced a second time.

New reference components use a 135pt default image height (75% of 180pt).

Runtime text measurements are not persisted. A
`Map<componentId, measuredHeightPoints>` belongs to the mounted canvas only and
is reset on project load.

## Layout Architecture

### Pure domain layout

Create an adaptive layout layer in `src/domain/plan/canvas` with focused units:

- `packAspectRows`: converts image aspect ratios into rows at the configured
  image height.
- `referenceContentLayout`: derives title/description/control/image/add-button
  rectangles and total natural height.
- `paginateReferenceRows`: splits a group only between complete image rows.
- `layoutPlan`: consumes v4 components, A4 geometry, and runtime text
  measurements, then returns page placements and fragments.

The layout result may contain multiple placements for one logical component:

```ts
interface ComponentFragmentPlacement {
  fragmentId: string;
  componentId: string;
  fragmentIndex: number;
  pageIndex: number;
  kind: "whole" | "first" | "continuation";
  rect: Rect;
  imageSlots?: ImageSlot[];
}
```

Logical ordering and persistence remain component-based; fragments exist only
in the render/PDF layout result.

### Photography-plan measurement

`PlanTextComponentView` exposes its natural content height through
`ResizeObserver`. The observer:

- measures the BlockNote wrapper, including its border and internal padding;
- converts CSS pixels to A4 points using the current canvas scale;
- reports only finite values;
- ignores changes smaller than approximately 1pt to prevent feedback loops.

Before the first measurement, the engine uses a compact one-line fallback
height. Once measured, the component transitions to its natural height.

One BlockNote instance remains mounted even when the component spans more than
one page. A small pagination adapter observes BlockNote's top-level block
elements and adds a page-break spacer *before* the first block that would cross
an A4 content boundary. This preserves one editor/undo stack while moving whole
blocks past the bottom margin and into the next page content area. The adapter
records only runtime spacer metadata; it never rewrites the persisted HTML.

If one indivisible block is taller than a full content page, it is allowed to
flow across that boundary and receives a visual continuation marker rather than
entering a measurement loop.

### Continuous paged canvas surface

Replace separate, isolated `CanvasPage` positioning roots with a single
`PagedCanvasSurface` logical coordinate system. It renders A4 sheet backgrounds,
page margins, and page separators, while all placements use one global
coordinate space.

This is necessary for one BlockNote DOM tree to span page boundaries. Reference
components still render as discrete first/continuation fragment frames aligned
to page content areas. Photography-plan components render once, with runtime
block spacers matching the surface's page geometry.

The logical page gap is included in the global Y conversion helper, so layout,
hit-testing, drag previews, and visual page backgrounds use one mapping instead
of independently adding page offsets.

### Reference-group pagination

Reference layout is deterministic and does not require DOM measurement.

The first page fragment reserves space for:

- the component heading and controls;
- optional rich-text description;
- top/bottom padding;
- as many complete image rows as fit.

Continuation fragments reserve a compact read-only continuation heading and
then place subsequent complete rows. An individual image that cannot fit the
available width or height is scaled down proportionally. No image is divided
between pages.

## Spacing and Content Sizing

Use a shared A4-point `COMPONENT_INSET` for:

- the left/right position of the photography-plan editor;
- reference title, controls, description, grid, and add-image button;
- continuation headings.

This replaces the current combination of frame gutter padding plus unrelated
inner padding. The visible editor border and reference content align to the same
left/right lines.

Remove content-area `h-full`, `flex-1`, and `overflow-auto` assumptions from
component views. The page/canvas viewport may scroll, but a component's own body
must not scroll.

BlockNote's empty state keeps only one editable line plus normal padding. Its
container grows with content.

## Reference Image Flow

For each image:

```text
requestedHeight = component.imageHeight
requestedWidth  = requestedHeight * normalizedAspectRatio
```

`normalizedAspectRatio` falls back to `1` for zero, negative, non-finite, or
missing values.

Rows are packed left-to-right with the shared image gap. If the next image does
not fit, it begins a new row. If one image is wider than the full inner width,
both width and height scale down by the same factor.

When captions are hidden, the tile height equals the image display height.
When captions are shown, the caption occupies approximately one third of the
image height below the image; it never overlays the image.

The add-image button is the final item in the flow and participates in wrapping.
The component's natural height is the bottom of the final row/button plus the
component inset.

`SortableImageTile` uses exact slot dimensions and `object-contain`. The tile's
background remains visible only as letterboxing for pathological source/data
differences; normal images fill the calculated aspect-ratio rectangle without
cropping.

## Dragging and Animation

### Components

Move component ordering from plain `useDraggable` to `useSortable`, using the
same logical component ids as persistence and undo/redo.

The pointer sensor activates after approximately 180ms with a small movement
tolerance on the component top border. During dragging:

1. The original component remains in layout as an equal-size dashed
   placeholder.
2. `DragOverlay` renders a raised visual copy following the pointer.
3. `onDragOver` updates an in-memory preview order.
4. The adaptive layout recomputes width wrapping, content height, and page
   placement for the preview.
5. Non-active components animate to their preview rectangles over about 200ms
   with an ease-out curve.
6. `onDragEnd` commits one move; `onDragCancel` restores the original view.

For multi-page components, the placeholder reserves all logical fragments. The
overlay is capped to a compact heading/summary preview so it does not cover the
viewport, but dropping moves every fragment of that logical component together.

### Images

Images retain `useSortable`, but layout animation is enabled for all affected
tiles, including cross-group/cross-page moves. The active image gets a
`DragOverlay`; its original slot remains a same-size placeholder. Captions move
with their image.

`onDragOver` changes preview order only. `onDragEnd` emits one `MoveImageParams`
operation, preserving the current undo/redo behavior as one structural entry.

For `prefers-reduced-motion: reduce`, translations are disabled while
placeholders and the preview insertion position remain visible.

## PDF Consistency

The PDF export path reuses the pure reference row and fragment layout:

- the same image height, aspect-ratio width, gap, caption band, and row wrapping;
- the same reference-row page splitting;
- no image crop.

Rich-text PDF pagination continues to use the existing HTML/block renderer. It
does not consume runtime DOM measurements, but it follows the same A4 margins
and component inset.

## Error Handling

- Invalid image aspect ratios normalize to 1:1.
- Non-finite/negative measured text heights are ignored, retaining the last
  valid measurement or compact fallback.
- A measurement update smaller than 1pt is ignored.
- A single image too large for a row/page is proportionally reduced.
- Missing image data keeps the calculated slot and shows the localized loading
  state; it does not collapse the row.
- Drag cancel or an absent collision target restores the original order without
  recording history.
- Layout functions remain pure and never throw for malformed numeric input.

## Testing

### Domain

- v3-to-v4 migration drops persisted component-height semantics and applies
  image-height `* 0.75` exactly once.
- 4:3 and 2:3 images at height `H` get widths `4H/3` and `2H/3`.
- Invalid ratios fall back to 1:1.
- Images wrap without horizontal overlap; oversized items scale proportionally.
- Caption rows and the add button contribute to natural height.
- Reference rows split only at row boundaries and never exceed A4 content.
- Component ordering, side-by-side width wrapping, and page fragments remain
  stable under content-height changes.

### Component

- Plan and reference content share the same left/right inset.
- `ResizeObserver` growth updates the plan placement without persisting height.
- Long plan blocks get runtime page-break spacers without duplicating the
  BlockNote editor or rewriting HTML.
- Reference views contain no internal scroll container.
- Only left/right width resize handles remain.
- Image tiles use exact ratio dimensions and `object-contain`.
- Component/image drag renders overlay + placeholder and animates surrounding
  items; reduced-motion disables translation.

### E2E

- Typing multiple lines increases the plan card height without large empty
  padding.
- Adding enough images creates more rows and grows/paginates the reference group
  without an internal scrollbar.
- Landscape/portrait tile bounds reflect their ratios.
- During component/image drag, the preview placeholder shows the eventual
  position; release commits the preview order.
- Existing undo/redo, auto-save, PDF, theme, and workspace smoke tests remain
  green.

## Scope and Follow-ups

This phase implements automatic height, schema v4 migration, aspect-ratio image
flow, reference-row pagination, continuous long-plan page markers, and live drag
preview animation.

It does not add arbitrary image cropping modes, masonry packing with variable
row heights, or manual component-height overrides.
