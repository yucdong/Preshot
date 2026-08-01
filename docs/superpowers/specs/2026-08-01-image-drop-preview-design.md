# Reference Image Drop Preview (WYSIWYG Live Reflow) Design

## Goal

Upgrade the just-shipped reference-image drag-and-drop so that, while dragging,
the gallery previews the **exact result of the drop** — the other tiles reflow to
open the target slot (front, middle, or end of a group), including reflowing into
another group, even an empty one. The move is always "take one image and reflow
the rest" — never a two-image swap. On release it commits; on cancel or an
invalid drop it snaps back with no change.

This replaces v1's commit-on-release behavior (which showed within-group sortable
shuffling but no cross-group positional feedback and no explicit preview).

## Scope

In scope:

- Live WYSIWYG reflow preview during a drag: the layout shows the image already
  moved to the hovered insertion point.
- Insert at the **front**, **middle**, or **end** of a group.
- Move **across groups**, including into an **empty** group.
- Commit the previewed move on release; revert on cancel / drop outside any group.
- Keep click-to-open-lightbox (pointer activation distance) and the × remove.

Out of scope (non-goals, unchanged from v1):

- Group reordering; multi-select drag; keyboard drag (tiles stay
  keyboard-openable/removable, dragging is pointer-only).
- Changing persistence: a move is still pure metadata committed via the existing
  `onMoveImage` → provider → 5s auto-save path (no file I/O, `.preshot`
  schema unchanged).

## Decisions (from brainstorming)

- **Preview style:** WYSIWYG live reflow — the tiles reflow to show the
  post-insertion layout ("模拟显示插入后的效果，所见即所得"), not a static
  insertion line. A `DragOverlay` still follows the cursor for grab feedback.
- **Never swap:** move-one-and-reflow semantics (dnd-kit sortable reflow, not a
  swap strategy).
- **Reuse the domain reducer:** the live preview is produced by the existing,
  tested `moveImage` reducer, so the preview is guaranteed identical to the
  committed result.

## Architecture & Data Flow

The plan (via props) stays the single source of truth. During an active drag,
`ReferenceImagesTab` holds two pieces of local state:

```ts
// the dragged image and where it started
const [drag, setDrag] = useState<{ imageId: string; fromGroupId: string } | null>(null);
// the previewed groups to render while dragging (null = render from props)
const [preview, setPreview] = useState<ReferenceGroup[] | null>(null);
```

Handlers on the single `DndContext`:

- **`onDragStart`**: resolve the dragged image's origin group from props; set
  `drag = { imageId, fromGroupId }`; set `preview = groups` (no move yet).
- **`onDragOver`**: compute the hovered drop target from the event
  (`computeDropTarget`, below). If there is a valid target, set
  `preview = moveImage(planOf(groups), { fromGroupId, imageId, toGroupId, toIndex }).referenceGroups`.
  The preview is always recomputed from the **original props `groups`** (not from
  the previous preview), so it never drifts and always equals "origin → current
  target".
- **`onDragEnd`**: recompute the target; if valid, call the existing
  `onMoveImage({ fromGroupId, imageId, toGroupId, toIndex })` **once**; then clear
  `drag`/`preview`. If invalid (dropped outside any group/tile) → clear only
  (revert, no commit).
- **`onDragCancel`**: clear `drag`/`preview`.

Rendering uses `const view = preview ?? groups;` — each `GroupImageGrid` and the
`DragOverlay` read from `view`, so the tiles reflow live. Because commit reuses
the same `moveImage` call the preview used, **preview === committed result**
(true WYSIWYG). After commit, props update (via the provider) to the same
ordering, so clearing `preview` causes no flicker.

`planOf(groups)` wraps the groups in a throwaway `ProjectPlan`
(`{ photographyPlan: "", referenceGroups: groups }`) so the pure `moveImage`
reducer can be reused for the preview.

### Drop target computation

`computeDropTarget(groups, activeId, overId, insertAfter): { toGroupId: string; toIndex: number } | null`
— a **pure** function (in `src/features/plan/dropTarget.ts`):

- `overId === null` → `null` (invalid → revert).
- `overId` is a **group container id** (`"group:<id>"`) → `{ toGroupId, toIndex:
  target.images.length }` (append; an empty group yields `toIndex: 0`).
- `overId` is a **tile id** → `toGroupId` = the group containing it. Let
  `withoutActive` be the target group's images with the active image removed (for
  a same-group move; for a cross-group move it is the target's images unchanged).
  Let `overPos` be the over tile's index in `withoutActive`. Then
  `toIndex = overPos + (insertAfter ? 1 : 0)`. This yields the true insertion gap
  in `moveImage`'s post-removal index space, so **front** (left of the first
  tile → `toIndex 0`), **middle**, and **end** (right of the last tile) all land
  where pointed, in-group and cross-group.

`insertAfter` (is the pointer past the over tile's midpoint) is derived in the
handler from dnd-kit's rects (`active.rect.current.translated` vs `over.rect`
center); this tiny rect read is the only non-pure part and is covered by the e2e,
while `computeDropTarget` itself is exhaustively unit-tested.

### What changes

- **Reused unchanged:** `moveImage` reducer, `MoveImageParams`,
  `PlanService.moveImage`, the provider `moveImage` handler, `GroupImageGrid` /
  `SortableImageTile` (they already render whatever images they're given and stay
  a droppable `SortableContext`).
- **Replaced:** `resolveImageMove` / `handleImageDragEnd` (v1 commit-on-release,
  over-tile-only) are removed in favor of `computeDropTarget` + the live
  `onDragStart`/`onDragOver`/`onDragEnd`/`onDragCancel` handlers. `groupDroppableId`
  moves to `dropTarget.ts` (still used by `GroupImageGrid`).
- **Reworked:** `ReferenceImagesTab` gains the drag/preview state and the four
  handlers and renders from `view`.
- **Sensors unchanged:** `PointerSensor` with `activationConstraint: { distance:
  6 }` (click still opens the lightbox); pointer-only. Collision detection stays
  `closestCorners`.

## Error Handling

`computeDropTarget` is total: unknown ids / `overId === null` → `null` → revert
(no commit, no throw). `moveImage` already returns the plan unchanged for
no-op/unknown, so a drop-in-place neither previews a change nor marks the project
dirty. No new failure surface, no file I/O.

## Testing

- **`dropTarget.test.ts` (pure):** container append (incl. empty group → 0);
  tile target with `insertAfter` true/false; front (before first tile → 0), end
  (after last), middle; same-group before/after (verifying the post-removal index
  is correct, e.g. dragging tile 0 to just-before tile 2 lands before tile 2, not
  after); cross-group before/after; `overId === null` → null; unknown ids → null.
- **Preview correctness** is covered transitively: the preview is `moveImage(...)`
  output, and `moveImage` is already exhaustively tested; a focused test asserts
  `computeDropTarget` + `moveImage` produce the expected ordering for a
  representative front/middle/end/cross/empty set.
- **Component:** `ReferenceImagesTab` / `GroupImageGrid` tests keep asserting that
  tiles render, click opens the lightbox, and add/remove still work (dnd-kit
  pointer drags aren't simulable in jsdom — `fireEvent.click`, as today).
- **E2E (Playwright):** drag an image to a new position **within** a group and
  assert the committed order; drag an image **into another group** (including an
  empty one) and assert both groups' resulting order; the existing "Open
  reference image 1 → lightbox" test continues to guard click-vs-drag.
- Reuse the existing jsdom shims; add a dnd-kit shim only if a mount error needs
  one.

## Risks & Mitigations

- **Optimistic-state reconciliation / flicker:** preview is derived from props via
  `moveImage`, and commit reuses the same params, so post-commit props match the
  last preview — clearing `preview` is seamless. Recomputing from original props
  each `onDragOver` prevents drift.
- **Grid side-detection precision (`insertAfter`):** isolated to a small rect read
  in the handler; `computeDropTarget` is pure and fully tested; the e2e validates
  real drags. If mid-grid precision needs tuning, only the rect read changes.
- **`onDragOver` frequency:** recomputes `moveImage` on small arrays each move —
  negligible for typical plan sizes.
- **dnd-kit active item crossing SortableContexts:** the active tile re-renders in
  the target group's `SortableContext` during preview; this is dnd-kit's
  supported multi-container behavior. The `DragOverlay` provides continuous grab
  feedback regardless.

## Documented Limitations

- Real drag interaction is validated by the pure `computeDropTarget` tests plus
  Playwright e2e, not by simulated pointer drags in jsdom.
- No group reordering, multi-select, or keyboard drag.
