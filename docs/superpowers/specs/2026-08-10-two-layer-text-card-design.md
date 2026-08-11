# Two-Layer Text Card Design

## Status

Approved and implemented on 2026-08-10.

Review sketch: `docs/design_refs/preshot-text-card-two-layer.html`.

## Goal

Reduce the text component to exactly two visible structural levels:

1. the outer text-component frame;
2. one or more editable text-leaf frames.

Titles are removed entirely. Recursive split parents remain in the data model for geometry but never render borders, backgrounds, headers, or reserved title space.

## Interaction

- A new text component contains one large text leaf filling the available inner area.
- Any leaf can split into equal columns or rows. Existing content stays in the first child and the second child starts empty.
- A selected or focused leaf reveals the existing compact square `Columns2` and `Rows2` icon buttons as an overlay. The smaller danger-colored `X` delete action is always the rightmost control. The overlay consumes no layout height.
- A split leaf may be deleted when another leaf exists. Clicking `X` opens a confirmation dialog explaining that the sibling subtree will fill the remaining region.
- Confirmation promotes the sibling subtree and records one structural history entry. The deletion can be restored through the visible Undo action or the existing `Ctrl+Z`; redo remains available through the existing history command.
- The contextual text-formatting toolbar remains an overlay and is unrelated to component structure.
- The outer frame retains component deletion, ordering, and edge resizing.
- Text leaves never have internal scrollbars. Their complete content is always visible on the canvas and in PDF output.
- Horizontal resizing triggers a fresh natural-height measurement. Narrower leaves grow as text wraps; wider leaves and the outer card shrink when wrapping decreases.

## Containment Rules

- Outer visual inset: `6pt` (`5pt` padding plus `1pt` frame border); split gap: `10pt`.
- Every split track uses `minmax(0, 1fr)`.
- Every split parent, leaf, BlockNote wrapper, editor, and ProseMirror root uses `min-width: 0`, `max-width: 100%`, and `width: 100%`.
- Split parents use no visible decoration and clip only invalid horizontal overflow at the component content boundary.
- Text uses `overflow-wrap: anywhere`; normal prose still wraps at word boundaries first.
- The component, split geometry, gaps, controls, and type share one logical point coordinate system and one canvas scale.
- Leaves, BlockNote wrappers, editors, and ProseMirror roots use visible vertical overflow and never `overflow-y: auto` or `scroll`.
- A leaf's natural height is measured from its rendered content at the current assigned width.
- A columns split assigns both children the maximum of their two recursively measured heights, keeping every box in that row bottom-aligned.
- A rows split uses the sum of both recursively measured child heights plus the split gap.
- The recursive result becomes the component body height. The outer card therefore converges in both directions instead of retaining a previous larger height.
- Natural content height grows the outer component. Manual shrinking cannot commit below measured content height.
- A split is constrained when it would create a leaf smaller than `132 x 64pt`; the resize boundary explains the size requirement.
- Tree depth remains unrestricted while all leaves satisfy the minimum size.

### Resize Measurement Sequence

1. Apply the preview width in logical canvas points.
2. Let all editors reflow at their assigned recursive widths.
3. In one animation frame, read each leaf's natural `scrollHeight` without a fixed height.
4. Reduce the tree bottom-up: columns use `max`, rows use `sum + gap`.
5. Apply all sibling heights and the outer card height together so no intermediate row appears misaligned.
6. Persist the settled width and height after pointer release. A measurement epsilon prevents save loops.

## Schema Decision

Schema v10 removes `title` from `PlanTextLeaf` rather than retaining a hidden field. Migration discards v9 leaf titles and preserves leaf IDs, HTML, split IDs, directions, gaps, and component geometry.

PDF export renders only leaf HTML in the same recursive geometry. No title spacing or title text is emitted.

## Visual Specification

- Outer selected frame: functional cyan `1.5px` border plus a subtle focus halo.
- Leaf frame: neutral `1px` border, `5px` radius, white surface.
- Active leaf: cyan-tinted border without an additional container.
- Split parents: transparent and borderless.
- Controls: compact white overlay, visible on leaf hover or keyboard focus.
- Leaf control order: `Columns2`, `Rows2`, then the smaller danger-colored `X` at the far right.
- Delete confirmation uses the existing modal surface and danger button. Initial focus lands on Delete; Escape, Cancel, and backdrop click close it without mutation.
- After confirmation, a compact status notice offers Undo without stealing editing focus in production.
- Motion: `160ms` opacity/transform for overlays only; resizing and reflow do not animate.

## Acceptance Criteria

1. No text title button, title input, title placeholder, or title export remains.
2. Single-leaf and recursively split cards show no more than two visible frame levels.
3. Every leaf/editor right edge stays within the outer component right edge at all supported component widths and canvas zoom values.
4. No leaf, BlockNote wrapper, editor, or ProseMirror root exposes a horizontal or vertical scrollbar.
5. Every leaf/editor bottom edge stays within the component after resize settles; content overflow grows the component before persistence.
6. Leaves sharing a columns split have equal rendered heights, based on the tallest recursive child.
7. Widening a card enough to reduce wrapping reduces the persisted card height; narrowing it increases the height.
8. Split, delete/promote, undo/redo, save/reload, migration, and PDF geometry remain deterministic.
9. Keyboard focus reveals the same leaf actions as hover and all icon-only actions keep accessible labels.
10. Leaf deletion never mutates before confirmation, and one undo restores the exact prior recursive tree and geometry.

## Confirmed Decisions

The implemented behavior is represented in the sketch:

- keep leaf borders visible in single and split states;
- use a fixed `10pt` split gap;
- make horizontal width the user-controlled dimension and derive height entirely from content;
- reject widths that would violate the minimum leaf size;
- remove title data in a schema migration instead of merely hiding it.

## Implementation Verification

- Schema v1-v9 migrations converge to strict title-free v10 documents.
- Component tests cover rightmost delete placement, cancel/confirm gating, and the visible Undo action.
- Browser coverage verifies two-layer recursive rendering, equal-height column siblings, no internal scroll containers, width-driven height growth/shrink, save/reload, confirmed deletion, and keyboard undo.
- PDF coverage renders recursive leaf HTML directly without title text or title spacing.