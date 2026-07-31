# Reference Image Drag-and-Drop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users drag reference image tiles to reorder them within a group or move them across groups, with reflow, and cancel when dropped on an invalid target.

**Architecture:** A pure `moveImage` plan reducer + non-persisting `PlanService.moveImage` use case hold all reorder logic. A pure `resolveImageMove(groups, activeId, overId)` helper (plus `handleImageDragEnd`) maps a dnd-kit drag-end to reducer params or `null` (cancel), so drop logic is unit-testable without simulating pointer drags. The UI wraps groups in a dnd-kit `DndContext`; each group is a droppable `SortableContext` of `SortableImageTile`s with a `DragOverlay`. The provider wires a `moveImage` handler exactly like `setColumns` (deferred to the 5s auto-save).

**Tech Stack:** React 19, TypeScript, Vite, Vitest + Testing Library (jsdom), `@dnd-kit/core` `@dnd-kit/sortable` `@dnd-kit/utilities`.

## Global Constraints

- Package manager: **pnpm** only (no npm/yarn lock files).
- `@dnd-kit/*` may be imported **only** under `src/features/plan`; `src/domain` imports no React and no dnd-kit.
- A move is **pure metadata** (the image `file` never changes): the provider handler follows the `setColumns` pattern — apply to memory only, **no immediate persist, no file I/O**; the existing 5-second auto-save flushes it.
- `moveImage` `toIndex` is the insertion index into the target group's image list **after the moved image is removed**; a drop that produces the same order returns the plan **unchanged** (same reference) so it does not mark the project dirty.
- Whole tile is draggable via a `PointerSensor` with `activationConstraint: { distance: 6 }` so a plain click still opens the lightbox; the × remove button calls `event.stopPropagation()` on `pointerDown`.
- Group droppable ids are prefixed `group:<groupId>` so they never collide with image ids.
- Dependency versions: `@dnd-kit/core@^6.3.1`, `@dnd-kit/sortable@^10.0.0`, `@dnd-kit/utilities` (latest, React 19-compatible — peers `react >=16.8.0`).
- Every commit message ends with the trailer exactly: `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

---

### Task 1: Domain `moveImage` reducer

**Files:**
- Modify: `src/domain/plan/models.ts`
- Modify: `src/domain/plan/plan.ts`
- Test: `src/domain/plan/plan.test.ts`

**Interfaces:**
- Consumes: `ProjectPlan`, `ReferenceGroup`, `ReferenceImage`, `findGroup` (existing in `plan.ts`).
- Produces: `MoveImageParams { fromGroupId: string; imageId: string; toGroupId: string; toIndex: number }` (exported from `models.ts`); `moveImage(plan: ProjectPlan, params: MoveImageParams): ProjectPlan` (exported from `plan.ts`).

- [ ] **Step 1: Add the `MoveImageParams` type**

Append to `src/domain/plan/models.ts` (after `ImportedImage`):
```ts
export interface MoveImageParams {
  fromGroupId: string;
  imageId: string;
  toGroupId: string;
  toIndex: number;
}
```

- [ ] **Step 2: Write the failing reducer tests**

Add to `src/domain/plan/plan.test.ts`. First ensure the imports at the top include `moveImage` and the types (merge into existing import lines):
```ts
import { addGroup, addImage, createGroup, moveImage, removeImage } from "./plan";
import type { ProjectPlan } from "./models";
```
Then add:
```ts
describe("moveImage", () => {
  const plan = (): ProjectPlan => ({
    photographyPlan: "",
    referenceGroups: [
      {
        id: "g1",
        title: "A",
        description: "",
        columnsPerRow: 3,
        images: [
          { id: "a", file: "references/a.png" },
          { id: "b", file: "references/b.png" },
          { id: "c", file: "references/c.png" },
        ],
      },
      {
        id: "g2",
        title: "B",
        description: "",
        columnsPerRow: 3,
        images: [{ id: "x", file: "references/x.png" }],
      },
    ],
  });

  const ids = (p: ProjectPlan, groupId: string) =>
    p.referenceGroups.find((g) => g.id === groupId)!.images.map((i) => i.id);

  it("reorders within a group forward (lands after the target slot)", () => {
    const next = moveImage(plan(), { fromGroupId: "g1", imageId: "a", toGroupId: "g1", toIndex: 2 });
    expect(ids(next, "g1")).toEqual(["b", "c", "a"]);
  });

  it("reorders within a group backward (lands at the target slot)", () => {
    const next = moveImage(plan(), { fromGroupId: "g1", imageId: "c", toGroupId: "g1", toIndex: 1 });
    expect(ids(next, "g1")).toEqual(["a", "c", "b"]);
  });

  it("moves an image across groups at a given index", () => {
    const next = moveImage(plan(), { fromGroupId: "g1", imageId: "b", toGroupId: "g2", toIndex: 0 });
    expect(ids(next, "g1")).toEqual(["a", "c"]);
    expect(ids(next, "g2")).toEqual(["b", "x"]);
  });

  it("appends when toIndex is beyond the end (clamped)", () => {
    const next = moveImage(plan(), { fromGroupId: "g1", imageId: "a", toGroupId: "g2", toIndex: 99 });
    expect(ids(next, "g2")).toEqual(["x", "a"]);
  });

  it("returns the same plan reference for an unknown image", () => {
    const p = plan();
    expect(moveImage(p, { fromGroupId: "g1", imageId: "zz", toGroupId: "g2", toIndex: 0 })).toBe(p);
  });

  it("returns the same plan reference for an unknown group", () => {
    const p = plan();
    expect(moveImage(p, { fromGroupId: "g1", imageId: "a", toGroupId: "nope", toIndex: 0 })).toBe(p);
  });

  it("returns the same plan reference for a no-op reorder", () => {
    const p = plan();
    expect(moveImage(p, { fromGroupId: "g1", imageId: "a", toGroupId: "g1", toIndex: 0 })).toBe(p);
  });

  it("does not mutate the input plan", () => {
    const p = plan();
    moveImage(p, { fromGroupId: "g1", imageId: "a", toGroupId: "g2", toIndex: 0 });
    expect(ids(p, "g1")).toEqual(["a", "b", "c"]);
    expect(ids(p, "g2")).toEqual(["x"]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run src/domain/plan/plan.test.ts`
Expected: FAIL — `moveImage` is not exported.

- [ ] **Step 4: Implement the reducer**

Append to `src/domain/plan/plan.ts`, and add `MoveImageParams` to the import from `./models`:
```ts
import {
  DEFAULT_COLUMNS,
  MAX_COLUMNS,
  MIN_COLUMNS,
  type MoveImageParams,
  type ProjectPlan,
  type ReferenceGroup,
  type ReferenceImage,
} from "./models";
```
```ts
export function moveImage(plan: ProjectPlan, params: MoveImageParams): ProjectPlan {
  const { fromGroupId, imageId, toGroupId, toIndex } = params;
  const source = findGroup(plan, fromGroupId);
  const target = findGroup(plan, toGroupId);
  if (!source || !target) {
    return plan;
  }
  const image = source.images.find((item) => item.id === imageId);
  if (!image) {
    return plan;
  }

  const sourceImages = source.images.filter((item) => item.id !== imageId);
  const base = fromGroupId === toGroupId ? sourceImages : target.images;
  const index = Math.max(0, Math.min(toIndex, base.length));
  const targetImages = [...base.slice(0, index), image, ...base.slice(index)];

  if (
    fromGroupId === toGroupId &&
    targetImages.length === source.images.length &&
    targetImages.every((item, position) => item.id === source.images[position].id)
  ) {
    return plan;
  }

  return {
    ...plan,
    referenceGroups: plan.referenceGroups.map((group) => {
      if (group.id === toGroupId) {
        return { ...group, images: targetImages };
      }
      if (group.id === fromGroupId) {
        return { ...group, images: sourceImages };
      }
      return group;
    }),
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run src/domain/plan/plan.test.ts`
Expected: PASS (all `moveImage` tests plus the pre-existing ones).

- [ ] **Step 6: Commit**

```bash
git add src/domain/plan/models.ts src/domain/plan/plan.ts src/domain/plan/plan.test.ts
git commit -m "feat(plan): add moveImage reducer for reordering reference images

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: `PlanService.moveImage` use case

**Files:**
- Modify: `src/domain/plan/service.ts`
- Test: `src/domain/plan/service.test.ts`
- Modify: `src/features/plan/ProjectPlanProvider.test.tsx`, `src/app/App.test.tsx`, `src/app/workspace/WorkspaceProvider.test.tsx` (service mocks)

**Interfaces:**
- Consumes: `moveImage` reducer (Task 1), `MoveImageParams`.
- Produces: `PlanService.moveImage(plan: ProjectPlan, params: MoveImageParams): Promise<ProjectPlan>` — non-persisting (resolves to the reducer output; does NOT call `repository.savePlan`).

- [ ] **Step 1: Write the failing service test**

Add to `src/infrastructure`/domain service test file `src/domain/plan/service.test.ts`. It uses a `deps()` helper returning `{ repository, imageStore, createId, logger }` and `createPlanService(d)`. Add `ProjectPlan` to the type import from `./models` (`import { EMPTY_PLAN } from "./models"` → `import { EMPTY_PLAN, type ProjectPlan } from "./models"`), then add this test inside the `describe("createPlanService", ...)` block:
```ts
it("moveImage resolves to the reordered plan without persisting", async () => {
  const d = deps();
  const service = createPlanService(d);
  const plan: ProjectPlan = {
    photographyPlan: "",
    referenceGroups: [
      { id: "g1", title: "A", description: "", columnsPerRow: 3, images: [
        { id: "a", file: "references/a.png" },
        { id: "b", file: "references/b.png" },
      ] },
    ],
  };
  const next = await service.moveImage(plan, { fromGroupId: "g1", imageId: "a", toGroupId: "g1", toIndex: 1 });
  expect(next.referenceGroups[0].images.map((image) => image.id)).toEqual(["b", "a"]);
  expect(d.repository.savePlan).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/domain/plan/service.test.ts`
Expected: FAIL — `service.moveImage` is not a function / not on the type.

- [ ] **Step 3: Add `moveImage` to the service**

In `src/domain/plan/service.ts`:
1. Extend the import from `./plan` to include the reducer aliased:
```ts
import {
  addGroup as addGroupToPlan,
  addImage as addImageToPlan,
  createGroup,
  deleteGroup as deleteGroupFromPlan,
  findGroup,
  moveImage as moveImageInPlan,
  removeImage as removeImageFromPlan,
  renameGroup as renameGroupInPlan,
  setColumns as setColumnsInPlan,
  setDescription as setDescriptionInPlan,
  setPhotographyPlan as setPhotographyPlanInPlan,
} from "./plan";
```
2. Extend the `./models` import to include `MoveImageParams`:
```ts
import { DEFAULT_COLUMNS, type MoveImageParams, type ProjectPlan, type ReferenceImage } from "./models";
```
3. Add to the `PlanService` interface (next to `setColumns`):
```ts
  moveImage(plan: ProjectPlan, params: MoveImageParams): Promise<ProjectPlan>;
```
4. Add to the returned object (next to `setColumns`):
```ts
    moveImage(plan, params) {
      return Promise.resolve(moveImageInPlan(plan, params));
    },
```

- [ ] **Step 4: Update the three `PlanService` mocks**

In each of these files, add `moveImage: vi.fn(),` immediately after the `setColumns: vi.fn(),` line:
- `src/features/plan/ProjectPlanProvider.test.tsx` (around line 36)
- `src/app/App.test.tsx` (around line 40)
- `src/app/workspace/WorkspaceProvider.test.tsx` (around line 56)

- [ ] **Step 5: Run the service test and typecheck**

Run: `pnpm vitest run src/domain/plan/service.test.ts`
Expected: PASS.

Run: `pnpm typecheck`
Expected: PASS (the mocks satisfy the extended `PlanService`).

- [ ] **Step 6: Commit**

```bash
git add src/domain/plan/service.ts src/domain/plan/service.test.ts src/features/plan/ProjectPlanProvider.test.tsx src/app/App.test.tsx src/app/workspace/WorkspaceProvider.test.tsx
git commit -m "feat(plan): add non-persisting moveImage use case

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Pure drop resolver

**Files:**
- Create: `src/features/plan/resolveImageMove.ts`
- Test: `src/features/plan/resolveImageMove.test.ts`

**Interfaces:**
- Consumes: `ReferenceGroup`, `MoveImageParams`.
- Produces:
  - `groupDroppableId(groupId: string): string` → `"group:<groupId>"`.
  - `resolveImageMove(groups: ReferenceGroup[], activeId: string, overId: string | null): MoveImageParams | null`.
  - `handleImageDragEnd(groups: ReferenceGroup[], event: { active: { id: string | number }; over: { id: string | number } | null }, onMoveImage: (params: MoveImageParams) => void): void`.

- [ ] **Step 1: Write the failing tests**

Create `src/features/plan/resolveImageMove.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import type { ReferenceGroup } from "../../domain/plan/models";
import { groupDroppableId, handleImageDragEnd, resolveImageMove } from "./resolveImageMove";

const groups: ReferenceGroup[] = [
  { id: "g1", title: "A", description: "", columnsPerRow: 3, images: [
    { id: "a", file: "a.png" }, { id: "b", file: "b.png" }, { id: "c", file: "c.png" },
  ] },
  { id: "g2", title: "B", description: "", columnsPerRow: 3, images: [{ id: "x", file: "x.png" }] },
];

describe("resolveImageMove", () => {
  it("returns null when over is null (invalid drop)", () => {
    expect(resolveImageMove(groups, "a", null)).toBeNull();
  });

  it("returns null when dropped on itself", () => {
    expect(resolveImageMove(groups, "a", "a")).toBeNull();
  });

  it("returns null for an unknown active image", () => {
    expect(resolveImageMove(groups, "zz", "b")).toBeNull();
  });

  it("resolves an image-over-image move within a group to the over index", () => {
    expect(resolveImageMove(groups, "a", "c")).toEqual({
      fromGroupId: "g1", imageId: "a", toGroupId: "g1", toIndex: 2,
    });
  });

  it("resolves a cross-group image-over-image move", () => {
    expect(resolveImageMove(groups, "a", "x")).toEqual({
      fromGroupId: "g1", imageId: "a", toGroupId: "g2", toIndex: 0,
    });
  });

  it("appends when dropped on a group container", () => {
    expect(resolveImageMove(groups, "a", groupDroppableId("g2"))).toEqual({
      fromGroupId: "g1", imageId: "a", toGroupId: "g2", toIndex: 1,
    });
  });

  it("returns null when dropped on an unknown group container", () => {
    expect(resolveImageMove(groups, "a", groupDroppableId("nope"))).toBeNull();
  });
});

describe("handleImageDragEnd", () => {
  it("calls onMoveImage with resolved params", () => {
    const onMoveImage = vi.fn();
    handleImageDragEnd(groups, { active: { id: "a" }, over: { id: "c" } }, onMoveImage);
    expect(onMoveImage).toHaveBeenCalledWith({ fromGroupId: "g1", imageId: "a", toGroupId: "g1", toIndex: 2 });
  });

  it("does not call onMoveImage for an invalid drop", () => {
    const onMoveImage = vi.fn();
    handleImageDragEnd(groups, { active: { id: "a" }, over: null }, onMoveImage);
    expect(onMoveImage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/features/plan/resolveImageMove.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the resolver**

Create `src/features/plan/resolveImageMove.ts`:
```ts
import type { MoveImageParams, ReferenceGroup } from "../../domain/plan/models";

const GROUP_PREFIX = "group:";

export function groupDroppableId(groupId: string): string {
  return `${GROUP_PREFIX}${groupId}`;
}

export function resolveImageMove(
  groups: ReferenceGroup[],
  activeId: string,
  overId: string | null,
): MoveImageParams | null {
  if (overId === null || overId === activeId) {
    return null;
  }

  const fromGroup = groups.find((group) => group.images.some((image) => image.id === activeId));
  if (!fromGroup) {
    return null;
  }

  let toGroupId: string;
  let toIndex: number;

  if (overId.startsWith(GROUP_PREFIX)) {
    toGroupId = overId.slice(GROUP_PREFIX.length);
    const target = groups.find((group) => group.id === toGroupId);
    if (!target) {
      return null;
    }
    toIndex = target.images.length;
  } else {
    const target = groups.find((group) => group.images.some((image) => image.id === overId));
    if (!target) {
      return null;
    }
    toGroupId = target.id;
    toIndex = target.images.findIndex((image) => image.id === overId);
  }

  if (fromGroup.id === toGroupId) {
    const fromIndex = fromGroup.images.findIndex((image) => image.id === activeId);
    if (fromIndex === toIndex) {
      return null;
    }
  }

  return { fromGroupId: fromGroup.id, imageId: activeId, toGroupId, toIndex };
}

export function handleImageDragEnd(
  groups: ReferenceGroup[],
  event: { active: { id: string | number }; over: { id: string | number } | null },
  onMoveImage: (params: MoveImageParams) => void,
): void {
  const params = resolveImageMove(
    groups,
    String(event.active.id),
    event.over ? String(event.over.id) : null,
  );
  if (params) {
    onMoveImage(params);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/features/plan/resolveImageMove.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/plan/resolveImageMove.ts src/features/plan/resolveImageMove.test.ts
git commit -m "feat(plan): add pure drop resolver for image drag-and-drop

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: Draggable tile + droppable group grid (install @dnd-kit)

**Files:**
- Modify: `package.json` (add deps)
- Create: `src/features/plan/SortableImageTile.tsx`
- Create: `src/features/plan/GroupImageGrid.tsx`
- Test: `src/features/plan/GroupImageGrid.test.tsx`

**Interfaces:**
- Consumes: `groupDroppableId` (Task 3), `ReferenceGroup`, `ReferenceImage`.
- Produces:
  - `SortableImageTile({ image, index, src, onOpen, onRemove })` where `image: ReferenceImage`, `index: number`, `src: string | undefined`, `onOpen(file: string): void`, `onRemove(imageId: string): void`.
  - `GroupImageGrid({ group, imageSrc, onAddImage, onRemoveImage, onOpenImage })` where `group: ReferenceGroup`, `imageSrc(file: string): string | undefined`, `onAddImage(groupId: string): void`, `onRemoveImage(groupId: string, imageId: string): void`, `onOpenImage(file: string): void`.

- [ ] **Step 1: Install @dnd-kit**

Run:
```bash
pnpm add @dnd-kit/core@^6.3.1 @dnd-kit/sortable@^10.0.0 @dnd-kit/utilities
```
Expected: `package.json` + `pnpm-lock.yaml` updated, exit 0.

- [ ] **Step 2: Create the sortable tile**

Create `src/features/plan/SortableImageTile.tsx`:
```tsx
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReferenceImage } from "../../domain/plan/models";

const squareButton =
  "group relative block aspect-square w-full overflow-hidden rounded-xl border border-black/10 bg-stone-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500";

interface SortableImageTileProps {
  image: ReferenceImage;
  index: number;
  src: string | undefined;
  onOpen(file: string): void;
  onRemove(imageId: string): void;
}

export function SortableImageTile({ image, index, src, onOpen, onRemove }: SortableImageTileProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: image.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  };

  return (
    <div className="relative" ref={setNodeRef} style={style}>
      <button
        aria-label={`Open reference image ${index + 1}`}
        className={squareButton}
        onClick={() => onOpen(image.file)}
        type="button"
        {...attributes}
        {...listeners}
      >
        {src ? (
          <img alt={`Reference image ${index + 1}`} className="h-full w-full object-cover" src={src} />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-xs text-stone-400">Loading…</span>
        )}
      </button>
      <button
        aria-label={`Remove reference image ${index + 1}`}
        className="absolute right-1 top-1 rounded-full bg-black/60 px-2 text-xs text-white"
        onClick={() => onRemove(image.id)}
        onPointerDown={(event) => event.stopPropagation()}
        type="button"
      >
        ×
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Write the failing group-grid test**

Create `src/features/plan/GroupImageGrid.test.tsx`:
```tsx
import { DndContext } from "@dnd-kit/core";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ReferenceGroup } from "../../domain/plan/models";
import { GroupImageGrid } from "./GroupImageGrid";

const group: ReferenceGroup = {
  id: "g1",
  title: "Lookbook",
  description: "",
  columnsPerRow: 3,
  images: [
    { id: "i1", file: "references/0001.png" },
    { id: "i2", file: "references/0002.png" },
  ],
};

function renderGrid(overrides: Partial<Parameters<typeof GroupImageGrid>[0]> = {}) {
  const props = {
    group,
    imageSrc: (file: string) => (file.startsWith("references/") ? "data:image/png;base64,AA" : undefined),
    onAddImage: vi.fn(),
    onRemoveImage: vi.fn(),
    onOpenImage: vi.fn(),
    ...overrides,
  };
  render(
    <DndContext>
      <GroupImageGrid {...props} />
    </DndContext>,
  );
  return props;
}

describe("GroupImageGrid", () => {
  it("renders each image as a sortable tile", () => {
    renderGrid();
    const open = screen.getByRole("button", { name: "Open reference image 1" });
    expect(open).toHaveAttribute("aria-roledescription", "sortable");
    expect(within(open).getByRole("img", { name: "Reference image 1" })).toBeVisible();
  });

  it("opens an image on plain click", async () => {
    const user = userEvent.setup();
    const props = renderGrid();
    await user.click(screen.getByRole("button", { name: "Open reference image 1" }));
    expect(props.onOpenImage).toHaveBeenCalledWith("references/0001.png");
  });

  it("removes and adds images through the tile and add button", async () => {
    const user = userEvent.setup();
    const props = renderGrid();
    await user.click(screen.getByRole("button", { name: "Remove reference image 2" }));
    expect(props.onRemoveImage).toHaveBeenCalledWith("g1", "i2");
    await user.click(screen.getByRole("button", { name: "Add reference image" }));
    expect(props.onAddImage).toHaveBeenCalledWith("g1");
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm vitest run src/features/plan/GroupImageGrid.test.tsx`
Expected: FAIL — `GroupImageGrid` does not exist.

- [ ] **Step 5: Create the droppable group grid**

Create `src/features/plan/GroupImageGrid.tsx`:
```tsx
import { useDroppable } from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext } from "@dnd-kit/sortable";
import type { ReferenceGroup } from "../../domain/plan/models";
import { groupDroppableId } from "./resolveImageMove";
import { SortableImageTile } from "./SortableImageTile";

interface GroupImageGridProps {
  group: ReferenceGroup;
  imageSrc(file: string): string | undefined;
  onAddImage(groupId: string): void;
  onRemoveImage(groupId: string, imageId: string): void;
  onOpenImage(file: string): void;
}

export function GroupImageGrid({ group, imageSrc, onAddImage, onRemoveImage, onOpenImage }: GroupImageGridProps) {
  const { setNodeRef } = useDroppable({ id: groupDroppableId(group.id) });

  return (
    <div
      className="mt-4 grid justify-start gap-3"
      ref={setNodeRef}
      style={{ gridTemplateColumns: `repeat(${group.columnsPerRow}, minmax(0, 160px))` }}
    >
      <SortableContext items={group.images.map((image) => image.id)} strategy={rectSortingStrategy}>
        {group.images.map((image, index) => (
          <SortableImageTile
            image={image}
            index={index}
            key={image.id}
            onOpen={onOpenImage}
            onRemove={(imageId) => onRemoveImage(group.id, imageId)}
            src={imageSrc(image.file)}
          />
        ))}
      </SortableContext>
      <button
        aria-label="Add reference image"
        className="flex aspect-square w-full items-center justify-center rounded-xl border-2 border-dashed border-stone-300 text-3xl text-stone-400 hover:border-amber-500 hover:text-amber-600"
        onClick={() => onAddImage(group.id)}
        type="button"
      >
        +
      </button>
    </div>
  );
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm vitest run src/features/plan/GroupImageGrid.test.tsx`
Expected: PASS (3 tests). If a dnd-kit mount error appears about a missing browser API, add the missing shim to `src/shared/testing/setup.ts` and re-run.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/features/plan/SortableImageTile.tsx src/features/plan/GroupImageGrid.tsx src/features/plan/GroupImageGrid.test.tsx
git commit -m "feat(plan): add sortable image tile and droppable group grid

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: Wire drag-and-drop into `ReferenceImagesTab`

**Files:**
- Modify: `src/features/plan/ReferenceImagesTab.tsx`
- Test: `src/features/plan/ReferenceImagesTab.test.tsx`

**Interfaces:**
- Consumes: `GroupImageGrid` (Task 4), `handleImageDragEnd` (Task 3), `MoveImageParams`.
- Produces: `ReferenceImagesTabProps.onMoveImage(params: MoveImageParams): void` (new required prop). The inline image grid is replaced by `<GroupImageGrid>`, wrapped in a `DndContext` with sensors and a `DragOverlay`.

- [ ] **Step 1: Add the failing wiring test**

In `src/features/plan/ReferenceImagesTab.test.tsx`, add `onMoveImage: vi.fn(),` to the `handlers()` object (so existing renders keep type-checking), then add:
```ts
it("renders images inside a sortable, droppable grid", () => {
  render(
    <ReferenceImagesTab
      groups={groups}
      imageSrc={(file) => (file === "references/0001.png" ? "data:image/png;base64,AA" : undefined)}
      {...handlers()}
    />,
  );
  expect(screen.getByRole("button", { name: "Open reference image 1" })).toHaveAttribute(
    "aria-roledescription",
    "sortable",
  );
});
```
(The drop→`onMoveImage` logic itself is covered by `resolveImageMove.test.ts` / `handleImageDragEnd`; jsdom cannot drive real dnd-kit pointer drags.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/features/plan/ReferenceImagesTab.test.tsx`
Expected: FAIL — tiles are not yet sortable (no `aria-roledescription`), and/or `onMoveImage` is not a prop.

- [ ] **Step 3: Add `onMoveImage` to the props interface**

In `src/features/plan/ReferenceImagesTab.tsx`, add the import of `MoveImageParams` and extend `ReferenceImagesTabProps`:
```ts
import { MAX_COLUMNS, MIN_COLUMNS, type MoveImageParams, type ReferenceGroup } from "../../domain/plan/models";
```
Add to `ReferenceImagesTabProps` (after `onOpenImage`):
```ts
  onMoveImage(params: MoveImageParams): void;
```

- [ ] **Step 4: Replace the inline grid with DnD wiring**

At the top of `src/features/plan/ReferenceImagesTab.tsx`, add imports:
```tsx
import { useState } from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { GroupImageGrid } from "./GroupImageGrid";
import { handleImageDragEnd } from "./resolveImageMove";
```
Remove the now-unused `squareButton` constant (it moved to `SortableImageTile`). Destructure `onMoveImage` from props. Inside the component body, before `return`:
```tsx
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
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
Wrap the mapped groups in a `DndContext`. Replace the block that maps `groups` (the `{groups.map((group) => ( ... ))}`) so it is surrounded by:
```tsx
      <DndContext
        collisionDetection={closestCenter}
        onDragCancel={() => setActiveId(null)}
        onDragEnd={onDragEnd}
        onDragStart={onDragStart}
        sensors={sensors}
      >
        {groups.map((group) => (
          /* ...existing <section> for the group... */
        ))}
        <DragOverlay>
          {activeImage ? (
            <div className="aspect-square w-40 overflow-hidden rounded-xl border border-black/10 bg-stone-200">
              {imageSrc(activeImage.file) ? (
                <img alt="" className="h-full w-full object-cover" src={imageSrc(activeImage.file)} />
              ) : null}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
```
Inside each group's `<section>`, replace the existing inline image-grid `<div className="mt-4 grid ...">...</div>` (the one mapping `group.images` and the trailing add button) with:
```tsx
          <GroupImageGrid
            group={group}
            imageSrc={imageSrc}
            onAddImage={onAddImage}
            onOpenImage={onOpenImage}
            onRemoveImage={onRemoveImage}
          />
```

- [ ] **Step 5: Run the focused test + typecheck**

Run: `pnpm vitest run src/features/plan/ReferenceImagesTab.test.tsx`
Expected: PASS (existing tests for open/add/remove still pass, plus the new sortable-grid test).

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/plan/ReferenceImagesTab.tsx src/features/plan/ReferenceImagesTab.test.tsx
git commit -m "feat(plan): drag-and-drop reference images across the gallery

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 6: Provider handler and prop pass-through

**Files:**
- Modify: `src/features/plan/ProjectPlanProvider.tsx`

**Interfaces:**
- Consumes: `PlanService.moveImage` (Task 2), `MoveImageParams`, `ReferenceImagesTabProps.onMoveImage` (Task 5).
- Produces: a `moveImage` handler passed as `onMoveImage` to `PlanPanel` (which spreads it into `ReferenceImagesTab`). Follows the deferred `setColumns` pattern.

- [ ] **Step 1: Add the handler**

In `src/features/plan/ProjectPlanProvider.tsx`, add the `MoveImageParams` import:
```ts
import { EMPTY_PLAN, type MoveImageParams, type ProjectPlan } from "../../domain/plan/models";
```
Add a `moveImage` handler immediately after the `setColumns` handler (mirroring it — deferred, no `persisting`, no `markSaved`):
```tsx
  const moveImage = useCallback(
    (params: MoveImageParams) => {
      void guard("Unable to reorder the reference image", async () => {
        const next = await service.moveImage(planRef.current, params);
        if (mountedRef.current) {
          applyPlan(next);
          setError(null);
        }
      });
    },
    [applyPlan, guard, service],
  );
```

- [ ] **Step 2: Pass it to `PlanPanel`**

In the `PlanPanel` JSX (in the same file), add the prop next to `onOpenImage`:
```tsx
        onMoveImage={moveImage}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (`PlanPanelProps` extends `ReferenceImagesTabProps`, so `onMoveImage` flows through the existing `...referenceProps` spread).

- [ ] **Step 4: Run the plan feature suites**

Run: `pnpm vitest run src/features/plan src/app/workspace/WorkspaceProvider.test.tsx src/app/App.test.tsx`
Expected: PASS (no regressions; the provider now supplies a real `onMoveImage`).

- [ ] **Step 5: Commit**

```bash
git add src/features/plan/ProjectPlanProvider.tsx
git commit -m "feat(plan): wire moveImage handler with deferred auto-save

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 7: Documentation, featurelist, and full validation

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/TESTING.md`
- Modify: `docs/design_docs/featurelist.json`

**Interfaces:**
- Consumes: nothing.
- Produces: docs describing image drag-and-drop; featurelist updated per the repo convention.

- [ ] **Step 1: Update ARCHITECTURE.md**

In the `PlanService`/`PlanPanel` boundary area, add that reference images can be reordered by drag-and-drop: a pure `moveImage(plan, { fromGroupId, imageId, toGroupId, toIndex })` reducer + a non-persisting `PlanService.moveImage` use case (deferred to the 5s auto-save; no file I/O), a pure `resolveImageMove(groups, activeId, overId)` helper that maps a dnd-kit drop to params or null (cancel on invalid drop), and a `@dnd-kit`-based `DndContext` in `ReferenceImagesTab` with `GroupImageGrid` (droppable per group) and `SortableImageTile`. Note `@dnd-kit` is confined to `src/features/plan`.

- [ ] **Step 2: Update TESTING.md**

Note the new coverage: `plan.test.ts` `moveImage` (within/cross-group, append, clamp, no-op, immutability); `resolveImageMove.test.ts` (drop resolution incl. invalid → null, cross-group, group-container append, `handleImageDragEnd`); `GroupImageGrid.test.tsx` (sortable tiles render; click-open/add/remove preserved). State that real pointer-drag interaction is not simulated in jsdom — drop logic is covered by the pure resolver, so no DnD e2e is added.

- [ ] **Step 3: Update featurelist.json**

Under the `基础方案编辑` feature in `docs/design_docs/featurelist.json`:
- Add a `feature_descriptions` entry (Chinese, matching the file's style):
  `"参考样图支持鼠标拖拽重新排序：可在组内调整顺序，也可拖到其它组；松开在非法位置则取消，移动后原组图片自动回填空位"`.
- Add a `decisions` entry:
  `"Add reference-image drag-and-drop with @dnd-kit (confined to src/features/plan): a pure moveImage reducer + non-persisting use case (deferred 5s auto-save, no file I/O) and a pure resolveImageMove helper; whole-tile drag with a pointer activation distance so clicks still open the lightbox; invalid drops cancel; drop logic is unit-tested (jsdom cannot drive real drags)."`.
- Add a `progress.completed` entry:
  `"Added drag-and-drop reordering of reference images within and across groups (dnd-kit) backed by a pure moveImage reducer/use case and a pure drop resolver, with deferred auto-save persistence."`.
- Replace `progress.lastVerified` with the counts observed in Step 4.

- [ ] **Step 4: Run the full validation matrix**

Run each and confirm PASS; record counts for featurelist `lastVerified`:
```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm test:e2e
cargo test --manifest-path src-tauri\Cargo.toml
```
Expected: all PASS. Fix any failure before committing.

- [ ] **Step 5: Validate featurelist.json parses**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('docs/design_docs/featurelist.json','utf8')); console.log('ok')"
```
Expected: prints `ok`.

- [ ] **Step 6: Commit**

```bash
git add docs/ARCHITECTURE.md docs/TESTING.md docs/design_docs/featurelist.json
git commit -m "docs(plan): document reference image drag-and-drop

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Self-Review Notes

- **Spec coverage:** within/cross-group move + reflow (Task 1); non-persisting/deferred use case (Task 2); cancel-on-invalid + append + no-op via the pure resolver (Task 3); whole-tile drag with activation distance + × stopPropagation + droppable groups (Tasks 4–5); provider deferred handler (Task 6); docs + featurelist + validation (Task 7). Non-goals (group reorder, multi-select, live cross-group preview) are respected — none implemented.
- **Type consistency:** `MoveImageParams { fromGroupId, imageId, toGroupId, toIndex }` is defined in Task 1 and used identically in Tasks 2–6; `moveImage(plan, params)`, `PlanService.moveImage(plan, params)`, `resolveImageMove(groups, activeId, overId)`, `handleImageDragEnd(groups, event, onMoveImage)`, `groupDroppableId(groupId)`, and the `GroupImageGrid`/`SortableImageTile` prop shapes match across tasks.
- **`toIndex` semantics:** defined once (insertion index into the target list after the moved image is removed) and the resolver's `toIndex` values (over-index for image targets, `target.images.length` for container targets) are consistent with the reducer's clamp — pinned by the Task 1 and Task 3 tests.
- **Testing reality:** jsdom cannot drive real dnd-kit pointer drags, so the drop brain (`resolveImageMove` + `handleImageDragEnd`) is pure and fully unit-tested; component tests assert the sortable/droppable structure and that click/add/remove still work.
