# Canvas Phase D — Image reordering + PDF slot fit (final parity)

The last deferred items from the Phase B/C reviews, completing v1→v2 canvas parity.

## Context

The A4 canvas is fully wired (Phases A–C, all on `main`): components, captions,
plan template, WYSIWYG subsetted PDF. Two gaps remain, both recorded in
`featurelist.json`'s `remaining`:

1. **Within-group (and cross-component) image drag-reorder** — v1 had it; the
   migration disabled it. The pure reducer `moveImage(plan, { fromComponentId,
   imageId, toComponentId, toIndex })` (`src/domain/plan/canvas/plan.ts`) already
   exists and is unit-tested, but no UI dispatches it. In Phase B the image tiles
   were made NON-draggable (`GroupImageGrid enableReorder` defaults `false`;
   `SortableImageTile draggable` defaults `true` but the grid passes
   `enableReorder`) to avoid a broken affordance. The v1 2-D drop-target helper
   (`src/features/plan/dropTarget.ts`) was deleted in Phase B and must be
   re-created, adapted to the v2 model.

2. **~6 pt horizontal image-slot overflow in the PDF** — `referenceImageSlots`
   (`src/domain/plan/canvas/engine.ts`) computes slots on the FULL component
   width (`innerWidth = rect.width`), but the exporter draws them from the
   gutter-inset `contentRect.x`, so the rightmost column bleeds ~a gutter past
   the content box into the page margin.

## Global Constraints (binding — copy into every reviewer prompt)

- All new UI strings are Chinese i18n keys in `src/shared/i18n/locales/zh.ts`,
  read via `useTranslation`. No hardcoded UI text.
- Image reorder uses the CLIENT-SIDE metadata pattern: a provider handler calls
  the pure `moveImage` reducer + `applyPlan` (deferred 5 s auto-save, NO file
  I/O, NO service method) — mirroring `handleMoveComponent`.
- Reuse the existing nested-DnD discipline: ONE `DndContext` in `PlanCanvas`;
  drags carry `data.type` (`"component"` vs `"image"`); handlers branch on it and
  early-return on the wrong type. Optimistic preview === commit via `moveImage`
  on an optimistic copy + a `lastParamsRef` loop guard (mirror the existing
  component-drag handlers and the historical image-drag pattern). Component drags
  must keep working unchanged.
- `moveImage`'s `toIndex` for a SAME-component move is the over-tile's index in
  the current (with-active) images array — this reproduces arrayMove given the
  reducer removes the active image first (see the v1 `computeDropTarget` comment).
- The image caption `<textarea>` (C3) must keep stopping propagation so it never
  starts a drag; clicking a tile must still open the lightbox (pointer
  activation distance).
- jsdom cannot drive dnd-kit pointer drags; drop-target math is pure-unit-tested;
  a real drag is Playwright e2e. Co-locate Vitest as `*.test.ts(x)`.
- Every task keeps the whole suite green (`pnpm typecheck`, `lint`, `test`) and
  lists its validation. Commit trailer:
  `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

## Task D1: Fit PDF image slots inside the gutter-inset content box

**Files:** `src/domain/plan/canvas/engine.ts`, `src/domain/plan/canvas/engine.test.ts`.

**Interfaces:** `referenceImageSlots(rect, component, geometry)` currently sets
`const innerWidth = rect.width;` and `x: rect.x + xOffsets[column]`. The exporter
draws each slot at `contentRect.x + slot.x` where `contentRect.x` is already inset
by `geometry.gutter / 2` and `contentRect.width = rect.width - geometry.gutter`.

- [ ] **Steps (TDD):**
  1. Update the failing engine test first: assert that for a full-width reference
     component, the rightmost slot's right edge (`slot.x + slot.width`) is `<=`
     the content width (`rect.width - geometry.gutter`), not the full `rect.width`
     (this fails today).
  2. Change `referenceImageSlots` so slots span the gutter-inset content width:
     `const innerWidth = rect.width - geometry.gutter;` (keep `x: rect.x +
     xOffsets[column]`, 0-based within the content box; the exporter's
     `contentRect.x + slot.x` then lands them exactly inside the content box —
     no double inset). Do NOT change the vertical placement, the caption-band
     split, or `slotToPageRect`.
  3. Update the other `referenceImageSlots`/`layoutPlan` assertions in
     `engine.test.ts` for the new (slightly smaller) `slotSize`/tile heights.
     Confirm `slotCaptionSplit` invariants still hold. Validation: `engine.test.ts`
     + `canvasPdfExporter.test.ts` (still green) + `pnpm typecheck`, `lint`.

## Task D2: Pure v2 image drop-target helper

**Files:** new `src/features/plan/canvas/imageDropTarget.ts` (+`.test.ts`).

**Interfaces:** re-create the deleted v1 logic, adapted to the v2 model and the
`moveImage` params. Export:
```ts
export const IMAGE_GROUP_PREFIX = "imagegroup:";
export function imageGroupDroppableId(componentId: string): string; // `${PREFIX}${id}`
export interface ImageDropTarget { fromComponentId: string; toComponentId: string; toIndex: number; }
export function imageDropTarget(
  components: PlanComponent[],
  activeImageId: string,
  overId: string | null,
  insertAfter: boolean,
): ImageDropTarget | null;
```
Adapt the v1 `computeDropTarget` algorithm (retrieved from git history of the
deleted `src/features/plan/dropTarget.ts`):
- Find `fromComponentId` = the reference component whose `images` contain
  `activeImageId`; return `null` if none, or if `overId` is null/=== active.
- If `overId` starts with `IMAGE_GROUP_PREFIX`: `toComponentId` = the suffix;
  `toIndex` = (that component's images excluding the active).length (append).
- Else find the reference component whose images contain `overId`:
  - Same component: `toIndex` = that component's `images.findIndex(overId)`
    (with-active index — reproduces arrayMove; `insertAfter` unused here).
  - Different component: `toIndex` = `overPos + (insertAfter ? 1 : 0)`.
- Only consider `reference`-type components; ignore plan components.
Also add a pure event mapper mirroring the component one
(`insertAfterFromRects`-style): compute `insertAfter` from the active vs over
rects' horizontal centers.

- [ ] **Steps (TDD):** Write exhaustive unit tests FIRST: same-component reorder
  (arrayMove indices for active-before-over and active-after-over), cross-component
  insert at front/middle/end, drop onto an empty component via its group droppable
  id (append at 0), no-op cases (overId null, over === active, over id not found,
  active not in any component, over a plan component). Then implement. Validation:
  `imageDropTarget.test.ts` + `pnpm typecheck`, `lint`.

## Task D3: Wire nested image drag-and-drop in the canvas

**Files:** `src/features/plan/canvas/PlanCanvas.tsx`,
`src/features/plan/canvas/ReferenceComponentView.tsx`,
`src/features/plan/GroupImageGrid.tsx`, `src/features/plan/SortableImageTile.tsx`,
`src/features/plan/ProjectCanvasProvider.tsx`.

**Interfaces & wiring:**
- `SortableImageTile`: when draggable, its `useSortable` must set
  `data: { type: "image", componentId }` so the canvas handlers can identify
  image drags and their source. Add a `componentId` prop; keep the caption
  textarea + remove button stopping propagation; keep the pointer activation
  distance so a click still opens the lightbox.
- `GroupImageGrid`: when `enableReorder`, wrap tiles in `SortableContext` (already
  present) AND expose a group-level droppable using `imageGroupDroppableId(group.id)`
  (for dropping onto an empty component / the gaps). Pass `componentId={group.id}`
  to each tile.
- `ReferenceComponentView`: pass `enableReorder` (true in the canvas) to
  `GroupImageGrid`.
- `PlanCanvas`: extend the existing single `DndContext` handlers to branch on
  `event.active.data.current?.type`:
  - `"component"` → existing component-reorder path (unchanged).
  - `"image"` → new path: compute the target with `imageDropTarget(components,
    activeImageId, overId, insertAfter)`; drive an optimistic `moveImage` preview
    on `view` with a `lastParamsRef` loop guard (only update the preview for a
    valid, CHANGED target; never revert mid-drag); commit the release-time target
    (falling back to the last previewed target when `over === active`), calling
    `onMoveImage`. Reset preview/refs on end/cancel.
  - Collision detection must return image/group droppables when dragging an image
    (reuse `rectIntersection` favouring image tiles, with `pointerWithin` /
    `closestCorners` fallback for empty-group droppables), and component
    droppables only when dragging a component. Keep the existing component filter.
- `ProjectCanvasProvider`: add `handleMoveImage(params: MoveImageParams)` =
  `applyPlan(moveImage(planRef.current, params))` (client-side; the deferred 5 s
  auto-save persists it; no service call, no file I/O), and pass
  `onMoveImage={handleMoveImage}` into `PlanCanvas`.

- [ ] **Steps (TDD):** Add a component/unit test asserting the tile is draggable
  when `enableReorder` (has the sortable drag attributes / `data.type === "image"`)
  and that the group droppable id is present; the pure move math is already covered
  by D2, and real drags are e2e (D4). Then implement. Keep component-drag,
  caption, lightbox, and existing tests green. Validation: the touched component
  tests + `pnpm typecheck`, `lint`, `pnpm test`.

## Task D4: e2e, featurelist, and full-matrix validation

**Files:** `e2e/canvas.spec.ts` (extend), `docs/design_docs/featurelist.json`.

- [ ] **Steps:**
  1. Add an e2e that drags one reference image over another within the same
     component and asserts the COMMITTED order changed (capture image ids/order
     before and after via a stable attribute, mirror the component-reorder e2e's
     approach), plus `save-status` → `有未保存的更改`. Keep all existing canvas
     e2e green (the caption textarea and lightbox click must still work).
  2. Update `docs/design_docs/featurelist.json` "Canvas Component System": move
     within-group image drag-reorder from `remaining` to delivered
     (feature_descriptions/decisions); note the PDF slot-fit fix; leave `remaining`
     empty (or only genuinely-future items); refresh `lastVerified`. Validate JSON.
  3. Run the FULL matrix: `pnpm typecheck`, `pnpm lint`, `pnpm test`,
     `pnpm test:e2e`, `cargo test --manifest-path src-tauri\Cargo.toml`,
     `pnpm build`. All green. Commit
     `feat(canvas): restore image drag-reorder and fit PDF slots`.

## Self-Review Notes

- **Parity restored:** image reorder within/across reference components (D2+D3)
  matches the v1 capability the migration dropped; PDF slots now sit inside the
  content box (D1).
- **Green-at-every-task:** D1 pure-domain + tests; D2 pure helper + tests; D3
  UI wiring behind `enableReorder` with component-drag untouched; D4 e2e + matrix.
- **Risk (D3):** nested DnD is the crux — the loop-guarded optimistic preview and
  the `data.type` branch mirror the proven component-drag and historical
  image-drag patterns; jsdom can't drive drags so D4's Playwright e2e is the real
  guard.
- After D4 the canvas component system (2A+2B+2C + parity) is complete.
