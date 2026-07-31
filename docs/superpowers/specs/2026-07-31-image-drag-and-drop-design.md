# Reference Image Drag-and-Drop Design

## Goal

Let users reorder reference images by dragging them with the mouse. A dragged
image can be dropped at a precise position **within its group** or **into another
group**; on drop the image lands at the target slot and the remaining images
reflow to fill the gap. Releasing over a location that is not a valid image slot
cancels the operation (the image snaps back, nothing changes).

## Scope

In scope:

- Drag any reference image tile (drag starts anywhere on the tile).
- Reorder within a group and move across groups, with array reflow.
- Precise insertion (drop at a specific slot), including appending to a group and
  dropping into an empty group.
- Cancel on invalid drop (released where there is no valid image slot).
- Persist the new order to `.preshot` via the existing 5-second auto-save (a move
  is pure metadata — no image files change).

Out of scope (non-goals):

- Reordering whole groups.
- Multi-select drag; dragging multiple images at once.
- Live cross-group insertion preview (the image visually hopping into the other
  group mid-drag). v1 finalizes the move on drop; feedback during drag is the
  drag overlay plus the within-group sortable gap.
- Touch-specific UI polish (pointer/touch works via the pointer sensor, but the
  target is the Windows desktop mouse flow).

## Decisions (from brainstorming)

- **Trigger:** whole tile is draggable, using a small pointer activation
  distance so a plain click still opens the lightbox and the × still removes.
- **Coverage:** images only (not groups).
- **Library:** `@dnd-kit/core` + `@dnd-kit/sortable` (+ `@dnd-kit/utilities`),
  React 19-compatible (`@dnd-kit/core` peers `react >=16.8.0`). Chosen over
  native HTML5 DnD (clunky, no touch, manual math) and a custom pointer engine
  (too much code).
- **Persistence:** a move is pure metadata → deferred to the 5s auto-save,
  exactly like `setColumns` (no immediate write, no file I/O).
- **Finalize on drop:** compute and apply the move once in `onDragEnd` (single
  source of truth is the plan), keeping the state model simple and the drop
  logic unit-testable via a pure resolver.

## Architecture (respects layering)

```text
ReferenceImagesTab (DndContext + SortableContext per group + DragOverlay)
  -- on drag end --> resolveImageMove(plan, activeId, overId): MoveImageParams | null
       null  -> cancel (no state change)
       params -> onMoveImage(params)
  -> ProjectPlanProvider.moveImage (deferred, like setColumns)
       -> PlanService.moveImage (non-persisting) -> moveImage(plan, params) reducer
       -> applyPlan(next); 5s auto-save persists
```

- `src/domain/plan` gains the pure reducer + use case; it imports **no** React or
  dnd-kit.
- `@dnd-kit/*` is imported **only** in `src/features/plan`.
- `resolveImageMove` is a pure function (no dnd-kit types beyond plain string
  ids), so the drop logic is testable without simulating pointer events.

## Data model & `moveImage` semantics

Types are unchanged: `ReferenceImage { id, file }` inside
`ReferenceGroup.images[]`. A move relocates the existing `{ id, file }` object
between arrays and/or indices; `file` never changes.

```ts
export interface MoveImageParams {
  fromGroupId: string;
  imageId: string;
  toGroupId: string;
  toIndex: number; // insertion index into the target list AFTER the image is removed
}

export function moveImage(plan: ProjectPlan, params: MoveImageParams): ProjectPlan;
```

Reducer contract (`src/domain/plan/plan.ts`):

1. Locate the source group (`fromGroupId`) and the image (`imageId`) within it,
   and the target group (`toGroupId`). If any is missing → return `plan`
   unchanged.
2. `sourceImages' = source.images` with `imageId` removed.
3. `targetBase = fromGroupId === toGroupId ? sourceImages' : target.images`.
4. `index = clamp(toIndex, 0, targetBase.length)`.
5. `targetImages' = [...targetBase.slice(0, index), image, ...targetBase.slice(index)]`.
6. Return a new plan where the target group's `images = targetImages'` and (for a
   cross-group move) the source group's `images = sourceImages'`. Same-group
   moves change only that one group.
7. **No-op guard:** if the resulting arrays are order-identical to the input,
   return the original `plan` reference unchanged (so a drop-in-place does not
   mark the project dirty).

`toIndex` is defined as the insertion index into the target list **with the moved
image already removed**, which makes same-group and cross-group math uniform and
unambiguous.

`PlanService.moveImage(plan, params)` is a non-persisting use case (returns
`Promise.resolve(moveImage(plan, params))`), mirroring `setColumns`.

## Drop resolution (`resolveImageMove`)

`resolveImageMove(plan, activeId, overId): MoveImageParams | null` lives in
`src/features/plan` and maps a dnd-kit drag-end into reducer params:

- `activeId` is the dragged image's id. `fromGroupId` = the group currently
  containing it (from `plan`). If not found → `null`.
- `overId === null` (released over nothing droppable) → `null` (cancel).
- `overId` is a **group container id** (`"group:<groupId>"`) → `toGroupId` = that
  group; `toIndex` = that group's current image count. The reducer clamps this to
  the post-removal length, i.e. **append** (works for empty groups and the
  end-of-grid, same group or cross-group).
- `overId` is an **image id** → `toGroupId` = the group containing it; `toIndex` =
  the index of that image within `toGroupId`'s images **as they currently are**
  (the active image still present for a same-group drag). Because the reducer
  inserts into the list with the active image already removed, a same-group
  **forward** drag lands the image *after* the hovered tile and a **backward**
  drag lands it *before* — matching standard sortable behavior; a cross-group
  drop lands before the hovered tile.
- If the resolved move is a no-op (same group and the result order is unchanged,
  or `overId === activeId`) → `null`.

Group droppable ids are prefixed (`group:<id>`) so they never collide with image
ids. `resolveImageMove` chooses the `toIndex` value; `moveImage` always
interprets `toIndex` as an index into the post-removal target list and clamps it.
Exact insertion expectations (within-group forward/backward, cross-group,
append) are pinned by unit tests in the implementation plan.

## Interaction & feedback

- `DndContext` wraps all groups; each group is a `SortableContext` with a
  `rectSortingStrategy`; each tile uses `useSortable({ id: image.id })`; the group
  container is a droppable (`id: "group:<groupId>"`) so empty groups and the
  end-of-grid accept drops.
- `PointerSensor` with `activationConstraint: { distance: 6 }` — a click below the
  threshold opens the lightbox; the × button stops pointer propagation so it never
  starts a drag. Image dragging is mouse/pointer only; tiles remain
  keyboard-focusable and can be opened (Enter/Space) and removed.
- A `DragOverlay` renders a copy of the dragged image following the cursor; the
  source tile shows a dimmed placeholder; the hovered group animates a gap.
- On `onDragEnd`, call `resolveImageMove`; if non-null, `onMoveImage(params)`.

## Persistence & error handling

- `ProjectPlanProvider.moveImage` follows the `setColumns` pattern: `guard(...) →
  service.moveImage(planRef.current, params) → applyPlan(next)`. No `persisting`
  wrapper, no `markSaved` — the 5s auto-save flushes the change. Save status
  flips to "unsaved" then "saved", consistent with other metadata edits.
- The reducer is pure and total (bad/unknown ids → no-op), so there is no new
  failure surface and no file I/O to fail.

## Testing

- **Domain (`plan.test.ts`):** `moveImage` — within-group forward and backward,
  cross-group insert at start/middle/end, append via out-of-range `toIndex`
  (clamped), first/last positions, unknown group/image → unchanged, drop-in-place
  → same reference (no-op), source and target immutability, reflow correctness.
- **Service (`service.test.ts`):** `moveImage` resolves to the reducer output and
  does not persist (repository.savePlan not called).
- **Resolver (`resolveImageMove.test.ts`):** image-over-image within and across
  groups, group-container append, empty-group append, `overId === activeId` →
  null, released-over-nothing → null, no-op → null.
- **Component (`ReferenceImagesTab.test.tsx`):** tiles expose the draggable
  attributes/roles; a plain click still opens the lightbox (activation distance
  preserves it); invoking the drag-end path with a resolvable active/over calls
  `onMoveImage` with the expected params. Full pointer-drag simulation is
  unreliable in jsdom, so interactive DnD relies on the pure resolver plus this
  wiring test.
- **E2E:** DnD is mouse/pointer only; keyboard-open is covered by the existing
  "browses reference images" test that clicks "Open reference image 1" → lightbox.
  Drag-and-drop stays covered by the unit + component layers.
- Reuse the existing jsdom shims (`ResizeObserver`, etc.) added for BlockNote;
  add any dnd-kit-specific shim only if a mount error requires it.

## Risks & mitigations

- **Click vs drag conflict:** mitigated by the pointer activation distance; the ×
  button stops propagation. Covered by the component click-still-opens test.
- **jsdom can't drive real drags:** mitigated by extracting `resolveImageMove` as
  a pure, fully-tested function; the component test drives the drag-end path
  directly.
- **Off-by-one on same-group reorder:** mitigated by the explicit "index after
  removal" contract and exhaustive reducer tests.
- **Bundle growth:** `@dnd-kit` is small and tree-shakeable; acceptable.

## Documented limitations

- No live cross-group preview during drag (move commits on release).
- No group reordering, no multi-select.
- Real drag interaction is validated by unit/component tests (and an e2e only if
  non-flaky), not by simulated pointer drags in jsdom.
