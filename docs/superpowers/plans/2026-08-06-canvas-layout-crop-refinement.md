# Canvas Layout, Crop, and Document Chrome Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship schema-v5 persisted rows, document/component names, non-destructive image cropping, PDF parity, and the clarified global canvas chrome.

**Architecture:** Keep the flat ordered component list and add `rowId`, then make the pure layout engine group consecutive components by persisted row. Add pure naming/crop/row helpers before parallel UI, DnD, PDF, and shell work; reserve `ProjectCanvasProvider.tsx` for a final integration task so parallel agents do not conflict.

**Tech Stack:** TypeScript 5.8, React 19, Tailwind 4, dnd-kit, Vitest/React Testing Library, Playwright, pdf-lib, Tauri 2, pnpm 10.15.0.

## Global Constraints

- Follow `AGENTS.md`: `domain` imports no React, browser, Tauri, or infrastructure APIs.
- Direct `@tauri-apps/api` imports remain confined to `src/infrastructure`.
- Use test-first red-green-refactor for every production behavior.
- Persist `schemaVersion: 5`; reject malformed/current or forward data instead of silently replacing it.
- New image groups use `showCaptions: true`; PDF renders every non-empty caption regardless of this screen-only flag.
- Image size is default `135`, minimum `67.5`, maximum `400` points.
- Crop values are normalized to `[0, 1]`; the full rectangle is represented by `undefined`.
- Width changes never change `rowId`; only a valid component drag can change rows.
- Component names are trimmed, non-empty, and unique across the project.
- Keep the source image unchanged; the lightbox always shows the uncropped source.
- Preserve keyboard undo/redo while removing visible toolbar buttons.
- Use existing dependencies only; do not add a cropping or PDF package.
- Parallel agents must start from the completed Task 1 commit and obey the file ownership in this plan.

## Dependency Graph and Parallel Ownership

```text
Task 1 shared contract
  +--> Task 2 row layout + DnD --------+
  +--> Task 3 title + naming UI -------+
  +--> Task 4 crop UI -----------------+--> Task 7 provider integration
  +--> Task 5 PDF parity --------------+
  +--> Task 6 global shell + toolbar --+
                                      +--> Task 8 acceptance
```

Tasks 2-6 run in parallel isolated worktrees. They must not edit
`src/features/plan/ProjectCanvasProvider.tsx`; Task 7 owns that file.

---

### Task 1: Schema v5 and Pure Contracts

**Files:**
- Create: `src/domain/plan/canvas/naming.ts`
- Create: `src/domain/plan/canvas/naming.test.ts`
- Create: `src/domain/plan/canvas/rows.ts`
- Create: `src/domain/plan/canvas/rows.test.ts`
- Create: `src/domain/plan/canvas/crop.ts`
- Create: `src/domain/plan/canvas/crop.test.ts`
- Modify: `src/domain/plan/canvas/models.ts`
- Modify: `src/domain/plan/canvas/models.test.ts`
- Modify: `src/domain/plan/canvas/geometry.ts`
- Modify: `src/domain/plan/canvas/geometry.test.ts`
- Modify: `src/domain/plan/canvas/migrate.ts`
- Modify: `src/domain/plan/canvas/migrate.test.ts`
- Modify: `src/domain/plan/canvas/plan.ts`
- Modify: `src/domain/plan/canvas/plan.test.ts`
- Modify: `src/domain/plan/canvas/service.ts`
- Modify: `src/domain/plan/canvas/service.test.ts`
- Modify: `src/infrastructure/plan/browserPlan.ts`
- Modify: `src/shared/i18n/locales/zh.ts`
- Modify typed v4 fixtures found by: `rg -l "schemaVersion:\s*4" src e2e`

**Interfaces:**
- Produces:

```ts
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProjectPlan {
  schemaVersion: 5;
  title: string;
  components: PlanComponent[];
}

export interface PlanMigrationContext {
  projectName: string;
  makeId?: (prefix: string) => string;
}

export type RenameComponentResult =
  | { ok: true; plan: ProjectPlan }
  | { ok: false; reason: "empty" | "duplicate" };

export type SetPlanTitleResult =
  | { ok: true; plan: ProjectPlan }
  | { ok: false; reason: "empty" };

export type ComponentMoveTarget =
  | { kind: "row"; rowId: string; toIndex: number }
  | { kind: "new-row"; rowId: string; toRowIndex: number };

export function nextComponentName(plan: ProjectPlan, type: PlanComponent["type"]): string;
export function renameComponent(plan: ProjectPlan, id: string, name: string): RenameComponentResult;
export function setPlanTitle(plan: ProjectPlan, title: string): SetPlanTitleResult;
export function orderedRowIds(plan: ProjectPlan): string[];
export function availableWidthInRow(
  plan: ProjectPlan,
  rowId: string,
  excludingComponentId?: string,
): number;
export function moveComponentInRows(
  plan: ProjectPlan,
  params: { id: string; target: ComponentMoveTarget },
): ProjectPlan;
export function normalizeCrop(crop: CropRect): CropRect | undefined;
export function effectiveImageAspectRatio(image: ReferenceImage): number;
export function setImageCrop(
  plan: ProjectPlan,
  params: { componentId: string; imageId: string; crop: CropRect },
): ProjectPlan;
export function resetImageCrop(
  plan: ProjectPlan,
  params: { componentId: string; imageId: string },
): ProjectPlan;
export function migratePlan(raw: unknown, context: PlanMigrationContext): ProjectPlan;
```

- Changes `CanvasPlanService.loadPlan` to:

```ts
loadPlan(projectPath: string, projectName: string): Promise<CanvasPlanLoadResult>;
```

- Later tasks consume these signatures unchanged.

- [ ] **Step 1: Write failing schema, naming, row, and crop tests**

Add focused cases with exact v5 values:

```ts
const plan: ProjectPlan = {
  schemaVersion: 5,
  title: "Editorial",
  components: [
    { id: "p1", rowId: "row-1", name: "文案1", type: "plan", width: 0.5, html: "" },
    {
      id: "r1",
      rowId: "row-1",
      name: "图片组1",
      type: "reference",
      width: 0.4,
      description: "",
      showCaptions: true,
      imageHeight: 135,
      images: [{ id: "i1", file: "references/0001.png", aspectRatio: 2 }],
    },
  ],
};

expect(nextComponentName(plan, "plan")).toBe("文案2");
expect(renameComponent(plan, "p1", "图片组1")).toEqual({
  ok: false,
  reason: "duplicate",
});
expect(effectiveImageAspectRatio({
  id: "i1",
  file: "references/0001.png",
  aspectRatio: 2,
  crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
})).toBe(1);
```

Migration must assert:

```ts
const migrated = migratePlan(v4, {
  projectName: "Editorial",
  makeId: (prefix) => `${prefix}-${++counter}`,
});
expect(migrated).toMatchObject({
  schemaVersion: 5,
  title: "Editorial",
  components: [
    { name: "文案1", rowId: "row:plan-1" },
    { name: "Lookbook", rowId: "row:ref-1", showCaptions: false },
  ],
});
```

- [ ] **Step 2: Run the new tests and confirm red**

Run:

```powershell
pnpm test -- src/domain/plan/canvas/models.test.ts src/domain/plan/canvas/naming.test.ts src/domain/plan/canvas/rows.test.ts src/domain/plan/canvas/crop.test.ts src/domain/plan/canvas/migrate.test.ts
```

Expected: FAIL because schema v5 types and helper modules do not exist.

- [ ] **Step 3: Implement the v5 model and constants**

Set:

```ts
export const MIN_IMAGE_HEIGHT = 67.5;
export const DEFAULT_IMAGE_HEIGHT = 135;
export const MAX_IMAGE_HEIGHT = 400;
export const CURRENT_SCHEMA_VERSION = 5 as const;
export const DOCUMENT_TITLE_HEIGHT = 36;
```

Add `name` and `rowId` to `BaseComponent`, add optional `crop` to
`ReferenceImage`, remove `title` from `ReferenceComponent`, and add `title` to
`ProjectPlan`.

- [ ] **Step 4: Implement naming, row, and crop pure helpers**

Use trimmed comparison for uniqueness. Compute row gap as a width fraction:

```ts
const gapFraction = SPACING / contentSize(DEFAULT_PAGE_GEOMETRY).width;
const used =
  row.reduce((sum, component) => sum + component.width, 0) +
  Math.max(0, row.length - 1) * gapFraction;
return Math.max(0, 1 - used);
```

`normalizeCrop` returns `undefined` for `{ x: 0, y: 0, width: 1, height: 1 }`.
`moveComponentInRows` rejects unknown/full targets by returning the original
plan and keeps each row contiguous.

- [ ] **Step 5: Implement strict migration and service context**

Change recursive migration calls to carry one context object. Validate v5
title, names, row contiguity/capacity, and crop bounds. For v4 rows, replay the
old automatic-fit rule in original order. Derive each row ID from its first
normalized component ID (`row:${firstComponent.id}`) so repeated loads before
the first v5 save produce identical row membership. Keep `makeId` only for
legacy records that genuinely lack required logical IDs.

Call migration from the service as:

```ts
return {
  status: "loaded",
  plan: migratePlan(raw, { projectName, makeId: () => createId() }),
};
```

Update `ProjectCanvasProvider` only mechanically at this stage to pass
`projectName` to `loadPlan`; behavioral provider work remains Task 7.

- [ ] **Step 6: Update all typed plan fixtures to compile against v5**

For every result of `rg -l "schemaVersion:\s*4" src e2e`, change typed current
plans to v5 and add deterministic `title`, `name`, and `rowId`. Keep explicit v4
objects only inside migration tests where the input type is `unknown`.

Use:

```ts
const plan: ProjectPlan = {
  schemaVersion: 5,
  title: "Demo",
  components: [
    { id: "p", rowId: "row-p", name: "文案1", type: "plan", width: 1, html: "" },
  ],
};
```

- [ ] **Step 7: Add the shared UI copy contract**

Add all keys consumed by parallel tasks before their worktrees branch:

```ts
canvas: {
  documentTitle: "画布标题",
  documentTitleEmpty: "画布标题不能为空",
  componentName: "组件名称",
  nameError: {
    empty: "组件名称不能为空",
    duplicate: "组件名称不能重复",
  },
  insertPlan: "文案",
  insertReference: "图片组",
  typePlan: "文案",
  typeReference: "图片组",
},
reference: {
  imageSize: "图片尺寸",
  cropTop: "从上方裁剪图片",
  cropRight: "从右侧裁剪图片",
  cropBottom: "从下方裁剪图片",
  cropLeft: "从左侧裁剪图片",
  resetCrop: "恢复原图",
},
```

- [ ] **Step 8: Run focused tests and typecheck**

Run:

```powershell
pnpm test -- src/domain/plan/canvas/models.test.ts src/domain/plan/canvas/naming.test.ts src/domain/plan/canvas/rows.test.ts src/domain/plan/canvas/crop.test.ts src/domain/plan/canvas/migrate.test.ts src/domain/plan/canvas/plan.test.ts src/domain/plan/canvas/service.test.ts
pnpm typecheck
```

Expected: all selected tests pass and typecheck exits 0.

- [ ] **Step 9: Commit the shared contract**

```powershell
git add -- src/domain/plan/canvas src/infrastructure/plan/browserPlan.ts src/infrastructure/plan/tauriPlan.test.ts src/infrastructure/pdf/canvasPdfExporter.test.ts src/features/plan/ProjectCanvasProvider.tsx src/features/plan/ProjectCanvasProvider.test.tsx src/features/plan/canvas/PlanCanvas.tsx src/features/plan/canvas/imageDropTarget.test.ts src/app/App.test.tsx src/app/workspace/WorkspaceProvider.test.tsx src/shared/i18n/locales/zh.ts
git commit -m "feat(plan): add schema v5 canvas contracts" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Persisted Row Layout and Component DnD

**Parallel ownership:** Task 2 exclusively owns the files below.

**Files:**
- Modify: `src/domain/plan/canvas/engine.ts`
- Modify: `src/domain/plan/canvas/engine.test.ts`
- Modify: `src/domain/plan/canvas/dropTarget.ts`
- Modify: `src/domain/plan/canvas/dropTarget.test.ts`
- Create: `src/features/plan/canvas/RowDropZone.tsx`
- Create: `src/features/plan/canvas/RowDropZone.test.tsx`
- Modify: `src/features/plan/canvas/PlanCanvas.tsx`
- Modify: `src/features/plan/canvas/PlanCanvas.test.tsx`

**Interfaces:**
- Consumes `orderedRowIds`, `availableWidthInRow`, `moveComponentInRows`, and
  `ComponentMoveTarget` from Task 1.
- Adds `includeDocumentTitle?: boolean` to `LayoutOptions`; screen and PDF set it
  to `true`, and the engine reserves `DOCUMENT_TITLE_HEIGHT + SPACING` before
  the first logical row.
- Produces:

```ts
export type ComponentDropTarget =
  | { kind: "row"; rowId: string; toIndex: number }
  | { kind: "new-row"; toRowIndex: number }
  | { kind: "invalid"; reason: "capacity" | "missing" };

export function componentDropTarget(
  components: PlanComponent[],
  activeId: string,
  over: { type: "component" | "row-gap"; id: string; insertAfter: boolean } | null,
): ComponentDropTarget;
```

- `PlanCanvasProps.onMoveComponent` becomes:

```ts
onMoveComponent(id: string, target: ComponentMoveTarget): void;
```

- [ ] **Step 1: Write failing row layout and target tests**

Add a case where two components have different row IDs even though both fit:

```ts
const components = [
  plan({ id: "a", rowId: "row-a", width: 0.4 }),
  plan({ id: "b", rowId: "row-b", width: 0.4 }),
];
const [a, b] = layoutPlan(components).placements;
expect(b.rect.x).toBe(0);
expect(b.rect.y).toBeGreaterThan(a.rect.y);
```

Add target cases for same-row reorder, fitting cross-row move, full-row
rejection, and a row-gap target.

- [ ] **Step 2: Run focused tests and confirm red**

```powershell
pnpm test -- src/domain/plan/canvas/engine.test.ts src/domain/plan/canvas/dropTarget.test.ts src/features/plan/canvas/PlanCanvas.test.tsx
```

Expected: FAIL because layout still auto-compacts and drop targets are indices.

- [ ] **Step 3: Make the layout engine iterate logical rows**

Group consecutive components by `rowId`. Reset horizontal placement only at a
row boundary; never use free capacity from a previous row. Preserve current
fragmentation and advance to the greatest end position reached by any component
in the row.

- [ ] **Step 4: Add row-aware drop geometry**

Render `RowDropZone` between logical rows with dnd data:

```ts
{ type: "row-gap", beforeRowId }
```

For existing rows, derive capacity from Task 1. Return `kind: "invalid"` before
building an optimistic preview when the active width does not fit.

- [ ] **Step 5: Update PlanCanvas preview and commit**

Convert a valid `ComponentDropTarget` to the Task 1 reducer target. Generate a
new row ID only when committing/previewing a row-gap target:

```ts
const target: ComponentMoveTarget = drop.kind === "new-row"
  ? { kind: "new-row", rowId: `row-${crypto.randomUUID()}`, toRowIndex }
  : { kind: "row", rowId: drop.rowId, toIndex: drop.toIndex };
```

Use the same target for preview and `onDragEnd`. Invalid targets clear preview
and do not call `onMoveComponent`.

- [ ] **Step 6: Run row tests**

```powershell
pnpm test -- src/domain/plan/canvas/engine.test.ts src/domain/plan/canvas/dropTarget.test.ts src/features/plan/canvas/RowDropZone.test.tsx src/features/plan/canvas/PlanCanvas.test.tsx
```

Expected: all selected tests pass.

- [ ] **Step 7: Commit**

```powershell
git add src/domain/plan/canvas/engine* src/domain/plan/canvas/dropTarget* src/features/plan/canvas/PlanCanvas* src/features/plan/canvas/RowDropZone*
git commit -m "feat(canvas): persist manual component rows" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Document Title and Component Naming UI

**Parallel ownership:** Task 3 owns the files below; it does not wire provider
callbacks.

**Files:**
- Create: `src/features/plan/canvas/CanvasTitle.tsx`
- Create: `src/features/plan/canvas/CanvasTitle.test.tsx`
- Modify: `src/features/plan/canvas/ComponentFrame.tsx`
- Modify: `src/features/plan/canvas/ComponentFrame.test.tsx`
- Modify: `src/features/plan/canvas/ReferenceComponentView.tsx`
- Modify: `src/features/plan/canvas/ReferenceComponentView.test.tsx`
- Modify: `src/features/plan/canvas/InsertComponentMenu.tsx`
- Modify: `src/features/plan/canvas/InsertComponentMenu.test.tsx`

**Interfaces:**
- Consumes `RenameComponentResult` and v5 component `name`.
- Produces:

```ts
interface CanvasTitleProps {
  title: string;
  onCommit(title: string): SetPlanTitleResult;
}

// Added to ComponentFrameProps
onRename(id: string, name: string): RenameComponentResult;
```

- [ ] **Step 1: Write failing accessible UI tests**

Assert:

```ts
expect(screen.getByRole("textbox", { name: "画布标题" })).toHaveValue("Editorial");
expect(screen.getByRole("textbox", { name: "组件名称" })).toHaveValue("文案1");
expect(screen.queryByRole("textbox", { name: "分组标题" })).not.toBeInTheDocument();
expect(screen.getByRole("menuitem", { name: "文案" })).toBeVisible();
expect(screen.getByRole("menuitem", { name: "图片组" })).toBeVisible();
```

Add duplicate-name behavior: blur returns `{ ok:false, reason:"duplicate" }`
and renders `组件名称不能重复`.

- [ ] **Step 2: Run tests and confirm red**

```powershell
pnpm test -- src/features/plan/canvas/CanvasTitle.test.tsx src/features/plan/canvas/ComponentFrame.test.tsx src/features/plan/canvas/ReferenceComponentView.test.tsx src/features/plan/canvas/InsertComponentMenu.test.tsx
```

Expected: FAIL because title/name controls and copy do not exist.

- [ ] **Step 3: Implement CanvasTitle**

Use a single-line local draft input, `aria-label={t("canvas.documentTitle")}`,
and the first-page title typography. Commit on Enter/blur; an empty result keeps
the draft in edit mode and renders `画布标题不能为空`. Escape restores `title`.
Do not read project metadata in this component.

- [ ] **Step 4: Replace the top-bar type label with editable component name**

Keep drag listeners on the bar but stop pointer propagation from the input.
Commit on Enter/blur. On validation failure keep the draft and render an
associated `role="alert"` message. Escape restores `component.name`.

Use:

```ts
const result = onRename(id, draft);
if (result.ok) {
  setNameError(null);
} else {
  setNameError(t(`canvas.nameError.${result.reason}`));
}
```

- [ ] **Step 5: Remove reference title editing and use the shared terminology**

Delete `onSetTitle` from `ReferenceComponentView`. Render no title input in the
reference body. Consume Task 1's `文案` and `图片组` i18n values; retain internal
discriminants `"plan"` and `"reference"`.

- [ ] **Step 6: Add frame visual treatment**

Apply a visible dashed border in both themes and restrained body elevation:

```text
border border-dashed border-stone-400/80 dark:border-stone-500
shadow-sm dark:shadow-black/30
```

Derive padding/gaps from existing scaled `SPACING`/frame chrome values rather
than adding a second spacing constant.

- [ ] **Step 7: Run tests and commit**

```powershell
pnpm test -- src/features/plan/canvas/CanvasTitle.test.tsx src/features/plan/canvas/ComponentFrame.test.tsx src/features/plan/canvas/ReferenceComponentView.test.tsx src/features/plan/canvas/InsertComponentMenu.test.tsx
git add src/features/plan/canvas
git commit -m "feat(canvas): add document and component names" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: Image Crop and Size UX

**Parallel ownership:** Task 4 owns the files below. Provider and
`ReferenceComponentView` wiring waits for Task 7.

**Files:**
- Create: `src/features/plan/ImageCropOverlay.tsx`
- Create: `src/features/plan/ImageCropOverlay.test.tsx`
- Modify: `src/features/plan/SortableImageTile.tsx`
- Modify: `src/features/plan/SortableImageTile.test.tsx`
- Modify: `src/features/plan/GroupImageGrid.tsx`
- Modify: `src/features/plan/GroupImageGrid.test.tsx`
- Modify: `src/features/plan/ReferenceImageLightbox.tsx`
- Modify: `src/features/plan/ReferenceImageLightbox.test.tsx`

**Interfaces:**
- Consumes `CropRect`, `normalizeCrop`, and `effectiveImageAspectRatio`.
- Produces:

```ts
interface ImageCropOverlayProps {
  crop: CropRect | undefined;
  sourceAspectRatio: number;
  viewportWidth: number;
  viewportHeight: number;
  onPreview(crop: CropRect): void;
  onCommit(crop: CropRect): void;
  onCancel(): void;
  onReset(): void;
}

// Added through SortableImageTile and GroupImageGrid
onSetCrop?(imageId: string, crop: CropRect): void;
onResetCrop?(imageId: string): void;
```

- [ ] **Step 1: Write failing crop interaction tests**

Cover right-edge and top-edge pointer drags, cancellation, one commit on pointer
up, and reset visibility:

```ts
fireEvent.pointerDown(screen.getByTestId("crop-handle-right"), {
  pointerId: 1,
  clientX: 100,
});
fireEvent.pointerMove(screen.getByTestId("crop-handle-right"), {
  pointerId: 1,
  clientX: 80,
});
fireEvent.pointerUp(screen.getByTestId("crop-handle-right"), {
  pointerId: 1,
  clientX: 80,
});
expect(onCommit).toHaveBeenCalledTimes(1);
expect(onCommit.mock.calls[0][0].width).toBeLessThan(1);
```

Assert tile click still calls `onOpen(image.file)` and crop pointer events do
not call open or dnd listeners.

- [ ] **Step 2: Run tests and confirm red**

```powershell
pnpm test -- src/features/plan/ImageCropOverlay.test.tsx src/features/plan/SortableImageTile.test.tsx src/features/plan/GroupImageGrid.test.tsx src/features/plan/ReferenceImageLightbox.test.tsx
```

Expected: FAIL because crop controls do not exist.

- [ ] **Step 3: Implement ImageCropOverlay**

Maintain only drag-session state locally. Convert client delta to normalized
source coordinates per edge, clamp through `normalizeCrop`, preview during
move, commit on pointer up, and call `onCancel` on pointer cancellation/lost
capture.

Render four focusable handles with accessible names and a `恢复原图` button only
when `crop` exists.

- [ ] **Step 4: Render cropped image content without changing the source**

Inside the tile viewport, size and offset the original image from the normalized
crop:

```ts
const crop = image.crop ?? { x: 0, y: 0, width: 1, height: 1 };
const style = {
  width: `${100 / crop.width}%`,
  height: `${100 / crop.height}%`,
  left: `${(-crop.x / crop.width) * 100}%`,
  top: `${(-crop.y / crop.height) * 100}%`,
};
```

Use absolute positioning and `object-fit: fill` inside the clipped viewport.
Keep the lightbox callback bound to `image.file`.

- [ ] **Step 5: Change lightbox visible close text and consume image-size copy**

Render `×` while retaining `aria-label="关闭图片"`. Consume Task 1's
`reference.imageSize` and crop labels. The numeric minimum already comes from
Task 1's model constant.

- [ ] **Step 6: Run tests and commit**

```powershell
pnpm test -- src/features/plan/ImageCropOverlay.test.tsx src/features/plan/SortableImageTile.test.tsx src/features/plan/GroupImageGrid.test.tsx src/features/plan/ReferenceImageLightbox.test.tsx
git add src/features/plan
git commit -m "feat(canvas): add non-destructive image cropping" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: PDF Title, Crop, and Caption Parity

**Parallel ownership:** Task 5 exclusively owns PDF exporter files.

**Files:**
- Modify: `src/infrastructure/pdf/canvasPdfExporter.ts`
- Modify: `src/infrastructure/pdf/canvasPdfExporter.test.ts`
- Modify: `src/domain/plan/canvas/pdf/exportDocument.ts`
- Modify: `src/domain/plan/canvas/pdf/exportDocument.test.ts`

**Interfaces:**
- Consumes v5 `title`, component `name`, image `crop`, and
  `effectiveImageAspectRatio`.
- Produces no new cross-package API.

- [ ] **Step 1: Write failing PDF behavior tests**

Spy on `PDFPage.drawText` and assert:

```ts
expect(drawnTexts).toEqual(expect.arrayContaining([
  "Editorial",
  "文案1",
  "图片组1",
  "拍摄说明",
]));
```

Create a reference with `showCaptions: false` and a non-empty caption; assert
the caption is still drawn. Spy on `PDFPage.pushOperators` for a cropped image
and assert clipping operators are emitted.

- [ ] **Step 2: Run PDF tests and confirm red**

```powershell
pnpm test -- src/domain/plan/canvas/pdf/exportDocument.test.ts src/infrastructure/pdf/canvasPdfExporter.test.ts
```

Expected: FAIL because titles/crop are absent and hidden captions are skipped.

- [ ] **Step 3: Add shared title geometry to export layout**

Reserve the first-page document title band exactly once and use component frame
chrome as the component-name band. Keep geometry in the domain export/layout
module, not in the pdf-lib adapter.

- [ ] **Step 4: Draw document and component names**

Draw `plan.title` in the first page band. Draw `component.name` in every first
component fragment; continuation fragments keep the existing continued-title
behavior without duplicating the base heading.

- [ ] **Step 5: Draw cropped images through a clipping path**

Use pdf-lib operators:

```ts
page.pushOperators(
  pushGraphicsState(),
  rectangle(slot.x, slot.y, slot.width, slot.height),
  clip(),
  endPath(),
);
page.drawImage(image, croppedDrawOptions);
page.pushOperators(popGraphicsState());
```

Calculate `croppedDrawOptions` from normalized source crop. The full source
scaled by `1 / crop.width` and `1 / crop.height` must fill the slot:

```ts
const width = slot.width / crop.width;
const height = slot.height / crop.height;
const x = slot.x - crop.x * width;
const y = slot.y - (1 - crop.y - crop.height) * height;
```

- [ ] **Step 6: Make caption export independent from screen visibility**

Replace the `ref.showCaptions` condition with:

```ts
const shouldExportCaption = Boolean(imageRecord.caption?.trim());
```

Ensure the export layout reserves a caption band under the same condition.

- [ ] **Step 7: Run tests and commit**

```powershell
pnpm test -- src/domain/plan/canvas/pdf/exportDocument.test.ts src/infrastructure/pdf/canvasPdfExporter.test.ts
git add src/domain/plan/canvas/pdf src/infrastructure/pdf/canvasPdfExporter*
git commit -m "feat(pdf): export canvas titles crops and captions" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 6: Global Settings and Canvas Toolbar

**Parallel ownership:** Task 6 owns AppShell and the new toolbar component.

**Files:**
- Modify: `src/app/layout/AppShell.tsx`
- Modify: `src/app/layout/AppShell.test.tsx`
- Create: `src/features/plan/canvas/CanvasToolbar.tsx`
- Create: `src/features/plan/canvas/CanvasToolbar.test.tsx`

**Interfaces:**
- Produces:

```ts
interface CanvasToolbarProps {
  disabled: boolean;
  exporting: boolean;
  saveState: SaveState;
  onInsert(type: "plan" | "reference"): void;
  onExport(): void;
}
```

- Task 7 replaces provider inline toolbar markup with this component.

- [ ] **Step 1: Write failing shell and toolbar tests**

In `AppShell.test.tsx` assert the header contains the `设置` button. In toolbar
tests assert `撤销`, `重做`, and `设置` are absent, while export is the final
action:

```ts
expect(screen.queryByRole("button", { name: "撤销" })).not.toBeInTheDocument();
expect(screen.queryByRole("button", { name: "重做" })).not.toBeInTheDocument();
expect(screen.queryByRole("button", { name: "设置" })).not.toBeInTheDocument();
expect(screen.getByRole("button", { name: "导出 PDF" })).toHaveClass("bg-amber-500");
```

- [ ] **Step 2: Run tests and confirm red**

```powershell
pnpm test -- src/app/layout/AppShell.test.tsx src/features/plan/canvas/CanvasToolbar.test.tsx
```

Expected: FAIL because global settings and extracted toolbar do not exist.

- [ ] **Step 3: Move SettingsButton to AppShell**

Import `SettingsButton` and render it with `ml-auto` in the outer workspace
header. Keep the header at the application composition level so it spans the
project rail, canvas, and assistant columns.

- [ ] **Step 4: Implement CanvasToolbar**

Compose `InsertComponentMenu`, `SaveStatus`, and a right-aligned export button.
Use one amber family:

```text
bg-amber-500 hover:bg-amber-400 text-stone-950
dark:bg-amber-400 dark:hover:bg-amber-300
```

Do not accept undo/redo/settings props.

- [ ] **Step 5: Run tests and commit**

```powershell
pnpm test -- src/app/layout/AppShell.test.tsx src/features/plan/canvas/CanvasToolbar.test.tsx
git add src/app/layout/AppShell* src/features/plan/canvas/CanvasToolbar*
git commit -m "feat(app): move settings to global workspace chrome" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 7: Provider and Cross-Package Integration

**Runs after Tasks 2-6 merge.**

**Files:**
- Modify: `src/features/plan/ProjectCanvasProvider.tsx`
- Modify: `src/features/plan/ProjectCanvasProvider.test.tsx`
- Modify: `src/features/plan/canvas/PlanCanvas.tsx` only for merged interface
  resolution
- Modify: `src/features/plan/canvas/ReferenceComponentView.tsx` only for crop
  callback wiring and image-size label
- Modify: `src/features/plan/canvas/ComponentFrame.tsx` only for merged callback
  wiring
- Modify: `src/app/App.test.tsx`
- Modify: `src/app/workspace/WorkspaceProvider.test.tsx`

**Interfaces:**
- Consumes all Task 1-6 interfaces.
- Produces a working v5 application flow with no new public API.

- [ ] **Step 1: Extend the provider mock test surface and write failing integration tests**

Expose callbacks from the mocked `PlanCanvas` and assert:

```ts
latestPlanCanvasProps.onCommitTitle("Campaign");
expect(screen.getByTestId("canvas-title")).toHaveTextContent("Campaign");

latestPlanCanvasProps.onRenameComponent("plan-1", "图片组1");
expect(screen.getByRole("alert")).toHaveTextContent("组件名称不能重复");

latestPlanCanvasProps.onSetImageCrop("ref-1", "i1", {
  x: 0.25, y: 0, width: 0.5, height: 1,
});
expect(screen.getByTestId("save-status")).toHaveTextContent("有未保存的更改");
```

Assert new references use `showCaptions: true`, `nextComponentName`, and a new
row ID.

- [ ] **Step 2: Run the provider tests and confirm red**

```powershell
pnpm test -- src/features/plan/ProjectCanvasProvider.test.tsx
```

Expected: FAIL because provider callbacks are not wired.

- [ ] **Step 3: Wire title, name, row, and crop reducers**

Use:

```ts
const handleRenameComponent = useCallback(
  (id: string, name: string) => {
    const result = renameComponent(planRef.current, id, name);
    if (result.ok) mutate(result.plan);
    return result;
  },
  [mutate],
);
```

Successful title and crop changes use `mutate`; an empty title returns
`{ ok:false, reason:"empty" }` without changing state. Crop drag commits one history entry.
`handleMoveComponent` receives `ComponentMoveTarget`. Width uses the Task 1
row-aware resize helper and never changes `rowId`.

- [ ] **Step 4: Insert v5 components**

Generate:

```ts
{
  id: crypto.randomUUID(),
  rowId: crypto.randomUUID(),
  name: nextComponentName(planRef.current, type),
  type,
  width: 1,
}
```

Reference additions include `description: ""`, `showCaptions: true`,
`imageHeight: DEFAULT_IMAGE_HEIGHT`, and `images: []`.

For a missing plan, initialize `title: projectName` and seed `文案1` /
`图片组1` in separate rows.

- [ ] **Step 5: Replace inline toolbar and place CanvasTitle**

Use `CanvasToolbar` and remove imports/markup for `SettingsButton`, undo, and
redo buttons. Keep history state/keyboard effects. Pass title into `PlanCanvas`
or its first-page surface and render `CanvasTitle` exactly once.

- [ ] **Step 6: Wire crop through PlanCanvas, ReferenceComponentView, and GroupImageGrid**

Pass `onSetImageCrop` and `onResetImageCrop` to image tiles. Maintain a local
crop preview in the image tile/overlay; persist only the pointer-up commit.
The lightbox still receives the file's original data URL.

- [ ] **Step 7: Run integration tests**

```powershell
pnpm test -- src/features/plan/ProjectCanvasProvider.test.tsx src/features/plan/canvas/PlanCanvas.test.tsx src/features/plan/canvas/ReferenceComponentView.test.tsx src/app/App.test.tsx src/app/workspace/WorkspaceProvider.test.tsx
pnpm typecheck
```

Expected: selected tests and typecheck pass.

- [ ] **Step 8: Commit**

```powershell
git add src/features/plan src/app
git commit -m "feat(plan): integrate rows names crops and global chrome" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 8: End-to-End Acceptance, Documentation, and Full Validation

**Files:**
- Modify: `e2e/canvas.spec.ts`
- Modify: `e2e/undo-redo.spec.ts`
- Modify: `e2e/theme.spec.ts`
- Modify: `docs/design_docs/featurelist.json`

**Interfaces:**
- Consumes the completed application.
- Produces acceptance coverage and final feature status.

- [ ] **Step 1: Replace obsolete toolbar history e2e assertions**

Keep the keyboard test and replace visible-button expectations:

```ts
await expect(page.getByRole("button", { name: "撤销" })).toHaveCount(0);
await expect(page.getByRole("button", { name: "重做" })).toHaveCount(0);
await page.keyboard.press("Control+z");
await expect(page.locator(FRAME)).toHaveCount(before);
```

Delete the toolbar-click undo/redo test because that UI is intentionally gone.

- [ ] **Step 2: Add row, name, title, and crop e2e cases**

Cover:

```text
1. Shrink a component and assert its data-row-id is unchanged.
2. Drag it to a fitting row, wait for autosave, reload, and assert new row ID.
3. Attempt a full-row drop and assert row ID/order remain unchanged.
4. Edit canvas title and component name, reload, and assert both persist.
5. Crop one edge, assert tile width changes, click reset, and assert width restores.
6. Click the tile and assert the lightbox source is still the full image.
```

Use stable `data-row-id`, `data-image-cropped`, and accessible labels rather than
CSS implementation details.

- [ ] **Step 3: Add caption/PDF and global settings acceptance**

Hide captions on screen, click Export PDF, wait for the action to return, and
assert no error alert. In `theme.spec.ts`, open `设置` from the outer header and
verify light/dark switching still applies to `document.documentElement`.

- [ ] **Step 4: Run targeted e2e**

```powershell
pnpm test:e2e -- e2e/canvas.spec.ts e2e/undo-redo.spec.ts e2e/theme.spec.ts
```

Expected: all selected Playwright tests pass.

- [ ] **Step 5: Update feature status**

Add one completed feature entry to `featurelist.json` containing:

```json
{
  "name": "Canvas Layout, Crop, and Document Chrome Refinement",
  "status": "completed",
  "feature_descriptions": [
    "Persisted manual component rows",
    "Editable canvas and component names",
    "Non-destructive four-edge image crop",
    "PDF title, crop, and always-caption parity",
    "Global settings and refined theme-aware canvas chrome"
  ],
  "decisions": [
    "Schema v5 stores title, name, rowId, and normalized crop metadata",
    "Width changes never change rows; valid drag is the only cross-row operation",
    "Source images remain unchanged and lightbox rendering is uncropped"
  ]
}
```

Record actual verification counts/results after the commands below.

- [ ] **Step 6: Run the complete validation matrix**

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:init
pnpm test:e2e
cargo test --manifest-path src-tauri\Cargo.toml
pnpm build
```

Expected: every command exits 0. If Rust cannot find the Microsoft linker, run
Cargo in one Developer Command Prompt process:

```powershell
& $env:ComSpec /c 'call "C:\Program Files\Microsoft Visual Studio\18\Enterprise\VC\Auxiliary\Build\vcvars64.bat" >nul && set "PATH=%USERPROFILE%\.cargo\bin;%PATH%" && cd /d C:\projects\Preshot && cargo test --manifest-path src-tauri\Cargo.toml'
```

- [ ] **Step 7: Commit acceptance work**

```powershell
git add e2e docs/design_docs/featurelist.json
git commit -m "test(canvas): verify schema v5 refinements" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Execution Notes

- Create isolated worktrees only after Task 1 is merged so all parallel workers
  receive the same v5 interfaces.
- Dispatch Tasks 2-6 concurrently with one agent per task and the exact ownership
  listed above.
- Require each agent to run its focused tests and commit before returning.
- Merge Tasks 2-6, resolve only interface-level conflicts, then run Task 7.
- Run a code-review agent after Task 7 and again after Task 8 before declaring
  completion.
