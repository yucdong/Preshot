# Reference Image Drop Preview (WYSIWYG Live Reflow) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While dragging a reference image, preview the exact post-drop layout (tiles reflow to the target slot — front/middle/end, across groups incl. empty), then commit that same move on release.

**Architecture:** A pure `computeDropTarget`/`dropTargetFromEvent` maps a dnd-kit drag event to `{ toGroupId, toIndex }`. `ReferenceImagesTab` keeps an optimistic `preview` produced by the existing, tested `moveImage` reducer on each `onDragOver`, renders from `preview ?? groups`, and commits the same params via the existing `onMoveImage` on `onDragEnd` — so preview always equals the committed result.

**Tech Stack:** React 19, TypeScript, Vitest + Testing Library (jsdom), Playwright, `@dnd-kit/core` + `@dnd-kit/sortable`.

## Global Constraints

- Package manager: **pnpm** only (no npm/yarn lock files).
- `@dnd-kit/*` imported only under `src/features/plan`; `src/domain` imports no React/dnd-kit.
- A move stays pure metadata committed via the existing `onMoveImage` → provider → 5s auto-save (no file I/O, `.preshot` schema unchanged).
- The live preview MUST be produced by the domain `moveImage` reducer (so preview === committed result — true WYSIWYG).
- `computeDropTarget` `toIndex` is an index into the target group's images **with the active image removed** (matches `moveImage`'s contract).
- Keep `PointerSensor` `activationConstraint: { distance: 6 }` (a plain click still opens the lightbox) and pointer-only; collision detection stays `closestCorners`.
- Move-one-and-reflow only — never a two-image swap; no group reordering, multi-select, or keyboard drag.
- Every commit message ends with the trailer exactly: `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

---

### Task 1: Pure `dropTarget.ts` (computeDropTarget + dropTargetFromEvent)

**Files:**
- Create: `src/features/plan/dropTarget.ts`
- Test: `src/features/plan/dropTarget.test.ts`

**Interfaces:**
- Consumes: `ReferenceGroup`, `MoveImageParams` from `../../domain/plan/models`.
- Produces:
  - `GROUP_PREFIX = "group:"` and `groupDroppableId(groupId: string): string`.
  - `type DropTarget = Pick<MoveImageParams, "toGroupId" | "toIndex">`.
  - `computeDropTarget(groups: ReferenceGroup[], activeId: string, overId: string | null, insertAfter: boolean): DropTarget | null`.
  - `dropTargetFromEvent(groups: ReferenceGroup[], event: DropDragEvent): DropTarget | null` where `DropDragEvent = { active: { id: string | number; rect: { current: { translated: DropRect | null } } }; over: { id: string | number; rect: DropRect } | null }` and `DropRect = { top: number; left: number; width: number; height: number }`.

**Note (transient duplication):** `resolveImageMove.ts` still defines its own `GROUP_PREFIX`/`groupDroppableId`; that whole file is deleted in Task 2. Leaving both here for one task keeps Task 1 purely additive (no edits to existing files) and green. Do NOT edit `resolveImageMove.ts`, `GroupImageGrid.tsx`, or `ReferenceImagesTab.tsx` in this task.

- [ ] **Step 1: Write the failing tests**

Create `src/features/plan/dropTarget.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { ReferenceGroup } from "../../domain/plan/models";
import { computeDropTarget, dropTargetFromEvent, groupDroppableId } from "./dropTarget";

const groups: ReferenceGroup[] = [
  { id: "g1", title: "A", description: "", columnsPerRow: 3, images: [
    { id: "a", file: "a.png" }, { id: "b", file: "b.png" }, { id: "c", file: "c.png" },
  ] },
  { id: "g2", title: "B", description: "", columnsPerRow: 3, images: [{ id: "x", file: "x.png" }] },
  { id: "g3", title: "C", description: "", columnsPerRow: 3, images: [] },
];

describe("computeDropTarget", () => {
  it("returns null for no over, self-hover, or unknown active", () => {
    expect(computeDropTarget(groups, "a", null, false)).toBeNull();
    expect(computeDropTarget(groups, "a", "a", false)).toBeNull();
    expect(computeDropTarget(groups, "zz", "b", false)).toBeNull();
  });

  it("appends when over a group container (incl. empty group)", () => {
    expect(computeDropTarget(groups, "a", groupDroppableId("g2"), false)).toEqual({ toGroupId: "g2", toIndex: 1 });
    expect(computeDropTarget(groups, "a", groupDroppableId("g3"), false)).toEqual({ toGroupId: "g3", toIndex: 0 });
  });

  it("returns null for an unknown group container", () => {
    expect(computeDropTarget(groups, "a", groupDroppableId("nope"), false)).toBeNull();
  });

  it("inserts before/after the over tile within a group (post-removal index)", () => {
    // active a removed -> [b,c]; over c at index 1
    expect(computeDropTarget(groups, "a", "c", false)).toEqual({ toGroupId: "g1", toIndex: 1 });
    expect(computeDropTarget(groups, "a", "c", true)).toEqual({ toGroupId: "g1", toIndex: 2 });
  });

  it("supports front insertion (before the first tile)", () => {
    // active c removed -> [a,b]; over a at index 0, before -> 0
    expect(computeDropTarget(groups, "c", "a", false)).toEqual({ toGroupId: "g1", toIndex: 0 });
  });

  it("inserts before/after the over tile across groups", () => {
    expect(computeDropTarget(groups, "a", "x", false)).toEqual({ toGroupId: "g2", toIndex: 0 });
    expect(computeDropTarget(groups, "a", "x", true)).toEqual({ toGroupId: "g2", toIndex: 1 });
  });
});

describe("dropTargetFromEvent", () => {
  const rect = (left: number) => ({ left, width: 100, top: 0, height: 100 });
  const event = (overId: string | null, activeLeft: number, overLeft: number) => ({
    active: { id: "a", rect: { current: { translated: rect(activeLeft) } } },
    over: overId ? { id: overId, rect: rect(overLeft) } : null,
  });

  it("returns null when there is no over target", () => {
    expect(dropTargetFromEvent(groups, event(null, 0, 0))).toBeNull();
  });

  it("derives insertAfter from the pointer/tile centers", () => {
    // active center 250 > over center 150 -> insertAfter true -> after c (index 2)
    expect(dropTargetFromEvent(groups, event("c", 200, 100))).toEqual({ toGroupId: "g1", toIndex: 2 });
    // active center 50 < over center 150 -> insertAfter false -> before c (index 1)
    expect(dropTargetFromEvent(groups, event("c", 0, 100))).toEqual({ toGroupId: "g1", toIndex: 1 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/features/plan/dropTarget.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `dropTarget.ts`**

Create `src/features/plan/dropTarget.ts`:
```ts
import type { MoveImageParams, ReferenceGroup } from "../../domain/plan/models";

export const GROUP_PREFIX = "group:";

export function groupDroppableId(groupId: string): string {
  return `${GROUP_PREFIX}${groupId}`;
}

export type DropTarget = Pick<MoveImageParams, "toGroupId" | "toIndex">;

export function computeDropTarget(
  groups: ReferenceGroup[],
  activeId: string,
  overId: string | null,
  insertAfter: boolean,
): DropTarget | null {
  if (overId === null || overId === activeId) {
    return null;
  }
  const fromGroup = groups.find((group) => group.images.some((image) => image.id === activeId));
  if (!fromGroup) {
    return null;
  }

  if (overId.startsWith(GROUP_PREFIX)) {
    const toGroupId = overId.slice(GROUP_PREFIX.length);
    const target = groups.find((group) => group.id === toGroupId);
    if (!target) {
      return null;
    }
    const withoutActive = target.images.filter((image) => image.id !== activeId);
    return { toGroupId, toIndex: withoutActive.length };
  }

  const target = groups.find((group) => group.images.some((image) => image.id === overId));
  if (!target) {
    return null;
  }
  const withoutActive =
    target.id === fromGroup.id ? target.images.filter((image) => image.id !== activeId) : target.images;
  const overPos = withoutActive.findIndex((image) => image.id === overId);
  if (overPos === -1) {
    return null;
  }
  return { toGroupId: target.id, toIndex: overPos + (insertAfter ? 1 : 0) };
}

export interface DropRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface DropDragEvent {
  active: { id: string | number; rect: { current: { translated: DropRect | null } } };
  over: { id: string | number; rect: DropRect } | null;
}

export function dropTargetFromEvent(groups: ReferenceGroup[], event: DropDragEvent): DropTarget | null {
  const activeId = String(event.active.id);
  const overId = event.over ? String(event.over.id) : null;
  const activeRect = event.active.rect.current.translated;
  const overRect = event.over?.rect ?? null;
  const insertAfter =
    activeRect != null && overRect != null
      ? activeRect.left + activeRect.width / 2 > overRect.left + overRect.width / 2
      : false;
  return computeDropTarget(groups, activeId, overId, insertAfter);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/features/plan/dropTarget.test.ts`
Expected: PASS.

Run: `pnpm typecheck`
Expected: PASS (additive file; nothing else changed).

- [ ] **Step 5: Commit**

```bash
git add src/features/plan/dropTarget.ts src/features/plan/dropTarget.test.ts
git commit -m "feat(plan): add pure drop-target resolver for live drag preview

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: WYSIWYG live preview in `ReferenceImagesTab`; retire `resolveImageMove`

**Files:**
- Modify: `src/features/plan/ReferenceImagesTab.tsx`
- Modify: `src/features/plan/GroupImageGrid.tsx` (import `groupDroppableId` from `./dropTarget`)
- Delete: `src/features/plan/resolveImageMove.ts`, `src/features/plan/resolveImageMove.test.ts`
- Test: `src/features/plan/ReferenceImagesTab.test.tsx` (verify existing assertions still pass)

**Interfaces:**
- Consumes: `dropTargetFromEvent` (Task 1), `moveImage` (`../../domain/plan/plan`), `MoveImageParams`/`ProjectPlan`/`ReferenceGroup` types, `GroupImageGrid`.
- Produces: `ReferenceImagesTab` renders from an optimistic `preview ?? groups`, previews via `moveImage` on `onDragOver`, and commits via `onMoveImage` on `onDragEnd`. `resolveImageMove`/`handleImageDragEnd` no longer exist.

- [ ] **Step 1: Switch `GroupImageGrid` to the new module**

In `src/features/plan/GroupImageGrid.tsx`, change the import:
```ts
import { groupDroppableId } from "./dropTarget";
```
(Everything else in that file stays the same.)

- [ ] **Step 2: Update `ReferenceImagesTab` imports**

In `src/features/plan/ReferenceImagesTab.tsx`:
- Change the `@dnd-kit/core` import to add `type DragOverEvent`:
```ts
import {
  closestCorners,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
```
- Change the models import to add `type ProjectPlan`:
```ts
import { MAX_COLUMNS, MIN_COLUMNS, type MoveImageParams, type ProjectPlan, type ReferenceGroup } from "../../domain/plan/models";
```
- Replace `import { handleImageDragEnd } from "./resolveImageMove";` with:
```ts
import { dropTargetFromEvent } from "./dropTarget";
```
- Add, next to the `GroupImageGrid` import:
```ts
import { moveImage } from "../../domain/plan/plan";
```

- [ ] **Step 3: Replace the drag state + handlers**

In `src/features/plan/ReferenceImagesTab.tsx`, replace this current block:
```tsx
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const activeImage = activeId
    ? groups.flatMap((group) => group.images).find((image) => image.id === activeId)
    : undefined;

  const onDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id));
  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    handleImageDragEnd(groups, event, onMoveImage);
  };
```
with:
```tsx
  const [activeId, setActiveId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ReferenceGroup[] | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const view = preview ?? groups;
  const activeImage = activeId
    ? groups.flatMap((group) => group.images).find((image) => image.id === activeId)
    : undefined;

  const planOf = (source: ReferenceGroup[]): ProjectPlan => ({ photographyPlan: "", referenceGroups: source });

  const paramsFor = (event: DragOverEvent | DragEndEvent): MoveImageParams | null => {
    const id = String(event.active.id);
    const from = groups.find((group) => group.images.some((image) => image.id === id));
    const target = dropTargetFromEvent(groups, event);
    if (!from || !target) {
      return null;
    }
    return { fromGroupId: from.id, imageId: id, toGroupId: target.toGroupId, toIndex: target.toIndex };
  };

  const onDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
    setPreview(groups);
  };
  const onDragOver = (event: DragOverEvent) => {
    const params = paramsFor(event);
    setPreview(params ? moveImage(planOf(groups), params).referenceGroups : groups);
  };
  const onDragEnd = (event: DragEndEvent) => {
    const params = paramsFor(event);
    setActiveId(null);
    setPreview(null);
    if (params) {
      onMoveImage(params);
    }
  };
  const onDragCancel = () => {
    setActiveId(null);
    setPreview(null);
  };
```

- [ ] **Step 4: Wire `onDragOver`/`onDragCancel` and render from `view`**

In the `DndContext`, add `onDragOver` and use the new `onDragCancel`:
```tsx
      <DndContext
        collisionDetection={closestCorners}
        onDragCancel={onDragCancel}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDragStart={onDragStart}
        sensors={sensors}
      >
```
Change the groups map from `{groups.map((group) => (` to `{view.map((group) => (`. (Everything inside the map — the `<section>`, `key={group.id}` if present, `<GroupImageGrid group={group} ... />`, and the `DragOverlay` using `activeImage` — stays the same.)

- [ ] **Step 5: Delete the retired module and its test**

Run:
```bash
git rm src/features/plan/resolveImageMove.ts src/features/plan/resolveImageMove.test.ts
```

- [ ] **Step 6: Verify**

Run: `pnpm vitest run src/features/plan/ReferenceImagesTab.test.tsx src/features/plan/GroupImageGrid.test.tsx`
Expected: PASS (existing open/add/remove + sortable-grid assertions still pass — the mock-free gallery renders the same tiles from `view`, which equals `groups` when not dragging).

Run: `pnpm typecheck` — Expected: PASS (no references to `resolveImageMove` remain; confirm with `git grep -n "resolveImageMove\|handleImageDragEnd" -- src` returning nothing).

Run: `pnpm test` (full suite) — Expected: all pass.

Run: `pnpm lint` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(plan): preview the post-drop layout live while dragging images

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: E2E — real drag commits a move

**Files:**
- Modify: `e2e/plan.spec.ts`

**Interfaces:**
- Consumes: the seeded browser "Editorial Demo" project (auto-opens with the "Lookbook" group), the live `ReferenceImagesTab`, and the `SaveStatus` (`data-testid="save-status"`).
- Produces: an e2e test that performs a real pointer drag of one image and asserts the move committed (the plan becomes dirty) with no error.

- [ ] **Step 1: Read the current e2e + save-status labels**

Read `e2e/plan.spec.ts` (existing tests use `page.goto("/")`; no `beforeEach`) and `src/features/plan/SaveStatus.tsx` (labels: `All changes saved` / `Unsaved changes` / `Saving…`). The gallery auto-opens with group "Lookbook" containing at least two reference images (buttons "Open reference image 1", "Open reference image 2").

- [ ] **Step 2: Add the drag e2e test**

Add to `e2e/plan.spec.ts` (follow the file's existing style):
```ts
test("reorders a reference image by dragging and commits the move", async ({ page }) => {
  await page.goto("/");

  const group = page.getByRole("group", { name: "Reference group: Lookbook" });
  const first = group.getByRole("button", { name: "Open reference image 1" });
  const second = group.getByRole("button", { name: "Open reference image 2" });

  const from = await first.boundingBox();
  const to = await second.boundingBox();
  if (!from || !to) throw new Error("reference tiles not visible");

  // dnd-kit PointerSensor needs movement > 6px and intermediate moves to start a drag.
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2, { steps: 3 });
  await page.mouse.move(to.x + to.width * 0.75, to.y + to.height / 2, { steps: 6 });
  await page.mouse.up();

  // A committed move flips the plan to unsaved (auto-save handles persistence).
  await expect(page.getByTestId("save-status")).toHaveText("Unsaved changes", { timeout: 3000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
});
```

- [ ] **Step 3: Run the e2e suite**

Run: `pnpm test:e2e`
Expected: PASS (all existing tests + the new drag test). If the drag does not reliably flip the status to "Unsaved changes" after a genuine effort tuning the mouse steps (dnd-kit + Playwright timing), STOP and report DONE_WITH_CONCERNS with the exact behavior observed — do not weaken the assertion to something that passes without a real move.

- [ ] **Step 4: Commit**

```bash
git add e2e/plan.spec.ts
git commit -m "test(e2e): cover committing a reference-image drag

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: Documentation, featurelist, and full validation

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/TESTING.md`
- Modify: `docs/design_docs/featurelist.json`

**Interfaces:**
- Consumes: nothing.
- Produces: docs describing the WYSIWYG live-reflow preview; featurelist updated per the repo convention.

- [ ] **Step 1: Update ARCHITECTURE.md**

In the image drag-and-drop description, note that dragging now previews the post-drop layout live: `ReferenceImagesTab` holds an optimistic `preview` computed by the domain `moveImage` reducer on each `onDragOver` (so the preview equals the committed result), renders from `preview ?? groups`, and commits the same params via `onMoveImage` on `onDragEnd` (revert on cancel/invalid). A pure `computeDropTarget`/`dropTargetFromEvent` (`src/features/plan/dropTarget.ts`) maps a dnd-kit event to `{ toGroupId, toIndex }` supporting front/middle/end, cross-group, and empty-group insertion. Note the v1 `resolveImageMove`/`handleImageDragEnd` helpers were replaced.

- [ ] **Step 2: Update TESTING.md**

Note: `dropTarget.test.ts` exhaustively covers the drop-target math (front/middle/end, cross-group, empty-group append, self/none → null, and `dropTargetFromEvent`'s pointer-center `insertAfter`); preview correctness follows from reusing the already-tested `moveImage` reducer; a Playwright e2e performs a real drag and asserts the move commits (plan becomes dirty). Real pointer drags remain non-simulable in jsdom, so component tests still assert render/click-open/add/remove only.

- [ ] **Step 3: Update featurelist.json**

Under the `基础方案编辑` feature in `docs/design_docs/featurelist.json`:
- Add a `feature_descriptions` entry:
  `"拖动参考样图时实时预览松手后的排版效果：其余图片让位显示插入位置（可插到组的最前、中间、结尾，也可拖入空的组），所见即所得；仅移动单张图并回填，不做换位"`.
- Add a `decisions` entry:
  `"Drag preview shows the post-drop layout live by reusing the moveImage reducer on an optimistic copy (preview === commit); a pure computeDropTarget/dropTargetFromEvent maps the dnd-kit event to {toGroupId,toIndex} for front/middle/end, cross-group, and empty-group insertion; v1 resolveImageMove/handleImageDragEnd removed."`.
- Add a `progress.completed` entry:
  `"Added WYSIWYG live-reflow preview for reference-image dragging (tiles reflow to the insertion point across groups incl. empty), reusing the moveImage reducer so the preview matches the committed move; drop-target math is pure and unit-tested with an e2e drag."`.
- Replace `progress.lastVerified` with the counts observed in Step 4.

- [ ] **Step 4: Run the full validation matrix**

Run each; confirm PASS; record counts for `lastVerified`:
```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm test:e2e
cargo test --manifest-path src-tauri\Cargo.toml
```
Expected: all PASS. Fix any failure before committing. (If `cargo` is missing, prepend `$env:USERPROFILE\.cargo\bin` to PATH for that command.)

- [ ] **Step 5: Validate featurelist.json parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('docs/design_docs/featurelist.json','utf8')); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 6: Commit**

```bash
git add docs/ARCHITECTURE.md docs/TESTING.md docs/design_docs/featurelist.json
git commit -m "docs(plan): document WYSIWYG drag drop-preview

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Self-Review Notes

- **Spec coverage:** live WYSIWYG reflow via optimistic `preview` + `moveImage` (Task 2); pure `computeDropTarget`/`dropTargetFromEvent` for front/middle/end/cross/empty (Task 1); reuse of `moveImage`/`PlanService.moveImage`/provider handler (unchanged); replacement of `resolveImageMove`/`handleImageDragEnd` (Task 2); e2e real drag (Task 3); docs + featurelist + validation (Task 4). Non-goals (swap, group reorder, multi-select, keyboard drag) respected.
- **Type consistency:** `DropTarget = { toGroupId, toIndex }` (Task 1) is spread into `MoveImageParams` (Task 2); `computeDropTarget`/`dropTargetFromEvent`/`groupDroppableId` signatures match across tasks; `moveImage(plan, params)` and `MoveImageParams` reused from the domain unchanged.
- **`toIndex` semantics:** defined once as an index into the post-removal target list, consistent between `computeDropTarget` and `moveImage`; pinned by Task 1 tests (front=0, before/after over tile, cross-group, empty append).
- **WYSIWYG guarantee:** preview and commit both derive from the same `moveImage(planOf(groups), params)` params, so what is shown is what is saved.
- **Transient duplication:** `dropTarget.ts` and `resolveImageMove.ts` both define `groupDroppableId` after Task 1; Task 2 deletes `resolveImageMove.ts`, leaving one owner.
- **Testing reality:** jsdom can't drive dnd-kit pointer drags; the drop math is pure and fully unit-tested, and the e2e exercises a real drag committing a move.
