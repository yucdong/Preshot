# A4 Document Flow Canvas Design

## Goal

Replace the schema-v7 continuous free canvas with a print-first A4 document
flow. Components retain adjustable width and height, but each component owns a
full row, follows persisted array order, and never crosses a page boundary.
Overflow creates real persisted continuation components.

## Confirmed Product Decisions

- A narrow component still reserves the entire row; no second component may use
  its remaining horizontal space.
- Width and height remain adjustable. Horizontal `x` is retained and clamped to
  the printable content box; free vertical `y` is removed.
- Component drag changes array order rather than absolute coordinates.
- Continuations are persisted components and participate in editing, history,
  autosave, PDF export, and subsequent reordering.
- Reference images shrink proportionally down to `67.5pt` image height before
  the image list is split into a suffixed continuation group.
- Plan text splits at top-level BlockNote block boundaries. A single block that
  exceeds a full page may split by rendered lines as the terminal fallback.

## Schema v8

`ProjectPlan.schemaVersion` becomes `8`. A component keeps:

```ts
interface BaseComponent {
  id: string;
  name: string;
  x: number;
  width: number;
  height: number;
}
```

The persisted `y` field is removed. `components[]` is the authoritative visual
order. The v7-to-v8 migration sorts once by `y`, then `x`, then original array
index, drops `y`, and clamps each rectangle to the A4 printable content width.

Continuation components receive new globally unique ids and the first available
name in the sequence `Name (2)`, `Name (3)`, and so on. No hidden fragment model
is persisted.

## Shared Layout Pipeline

The screen and PDF consume the same normalized v8 plan:

1. Measure current component content.
2. Normalize overflow into persisted continuation components.
3. Lay components out in array order with one component per row.
4. Move a component intact to the next A4 page when the remaining height is
   insufficient.
5. Render the resulting page placements on screen or in PDF.

`layoutDocumentFlow` is pure and rejects components taller than one printable
page. This makes accidental cross-page rendering impossible and forces callers
to run overflow normalization first.

## Overflow Normalization

### Reference groups

For a reference component that is taller than the available page:

1. Repack all images at their current frame sizes.
2. Reduce every image frame by a common scale until the component fits or the
   smallest image reaches `67.5pt` height.
3. If it still does not fit, keep the largest prefix of complete image rows in
   the original component and move the remaining images into a new continuation
   component on the next page.
4. Repeat until every resulting component fits one page.

Image records and source files are moved, not copied. Empty descriptions are
used on generated continuation groups so introductory text is not duplicated.

### Plan text

Parse persisted HTML through the existing BlockNote HTML boundary. Move the
largest suffix of complete top-level blocks into a continuation until both
components fit. Preserve block markup and formatting. If one top-level block is
taller than a full page, use measured line boundaries as the final split path.

Normalization is idempotent: running it on an already fitting plan returns the
same object and creates no history or save-state change.

## Interaction and History

- Component DnD uses sortable insertion targets and a compact drag overlay.
- The source row remains as a placeholder while dragging.
- One drop commits one reorder mutation and one history entry.
- Automatic overflow normalization caused by an edit or resize is grouped with
  that initiating mutation in one structural history entry.
- Rich-text native undo remains inside BlockNote; generated structural splits
  are handled by canvas undo/redo.

## Rendering

- Restore `PagedCanvasSurface` as the active surface.
- Every page is exactly `595.28pt x 841.89pt` with the existing 24pt margin.
- Screen scaling is visual only; all layout calculations remain in points.
- Page gaps exist only in screen coordinates and never affect persisted values
  or PDF geometry.
- Component chrome is shown on screen but excluded from PDF using the existing
  editable/PDF chrome geometry boundary.

## Failure Handling

- A failed text parse or image measurement must abort normalization and surface
  a contextual error; it must not save partial continuation data.
- Export validates that all components fit a page and all expected image files
  are loaded before creating the PDF.
- Project retirement continues to serialize behind in-flight normalization and
  persistence through the existing service coordinator.