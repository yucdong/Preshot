# Adaptive Component Layout and Live Drag Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fixed-height canvas cards with content-driven A4 layout, proportional non-cropped reference-image flow, page-aware continuation fragments, and live animated component/image drag placeholders.

**Architecture:** Persist only structural content and width in schema v4; derive all component heights through a pure adaptive domain layout plus runtime BlockNote measurements. Reference rows and PDF pagination use the same pure layout, while a continuous paged canvas and dnd-kit `useSortable`/`DragOverlay` provide one coordinate system and live reflow animation.

**Tech Stack:** React 19, TypeScript 5.8, BlockNote 0.52, dnd-kit core 6.3/sortable 10, Tailwind v4, Vitest 4 + Testing Library, Playwright 1.55, pdf-lib 1.17.

## Global Constraints

- Use pnpm 10.15.0; do not create npm or Yarn lock files.
- Preserve the dependency flow `React UI -> domain use case -> domain port -> infrastructure adapter`.
- `src/domain` must not import React, browser APIs, Tauri, or infrastructure.
- Component height is fully automatic; v4 persists `width` but not `height`.
- New reference image height is 135pt. v3→v4 migrates each existing `imageHeight` once via `clampImageHeight(old * 0.75)`.
- Images use their original aspect ratio and are never cropped.
- Component bodies must not have internal scrollbars.
- A reference group splits only between complete image rows across A4 pages.
- One photography-plan component remains one BlockNote editor/undo stack even when visually spanning pages.
- Drag preview updates only in memory; drop commits one structural mutation so undo/redo records one entry.
- Respect `prefers-reduced-motion`.
- Update `docs/design_docs/featurelist.json` when implementation is complete.
- Every commit includes:
  `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

## File Structure

- **Modify** `src/domain/plan/canvas/models.ts` — schema v4, remove persisted component height, 135pt default.
- **Modify** `src/domain/plan/canvas/migrate.ts` — normalize v4 and migrate v1/v2/v3 to v4 exactly once.
- **Modify** `src/domain/plan/canvas/plan.ts` — width-only `resizeComponent`.
- **Create** `src/domain/plan/canvas/referenceLayout.ts` — pure proportional image rows, add-button flow, captions, row pagination.
- **Rewrite** `src/domain/plan/canvas/engine.ts` — measured plan heights, reference fragments, global page-coordinate placements.
- **Create** `src/features/plan/canvas/PagedCanvasSurface.tsx` — continuous logical coordinates with A4 sheet backgrounds.
- **Create** `src/features/plan/canvas/useNaturalHeight.ts` — shared ResizeObserver px→point measurement for plan and description editors.
- **Create** `src/features/plan/canvas/usePlanContentMeasurement.ts` — BlockNote page-break spacers layered on natural-height measurement.
- **Modify** `ComponentFrame.tsx`, `PlanTextComponentView.tsx`, `ReferenceComponentView.tsx`, `GroupImageGrid.tsx`, `SortableImageTile.tsx`, `PlanCanvas.tsx` — auto-sized rendering and sortable animation.
- **Modify** `ProjectCanvasProvider.tsx` — runtime measurement map, width-only resize, schema-v4 component creation.
- **Modify** PDF layout/export files — consume the same reference fragments and aspect rows.
- **Create/modify tests** beside each unit plus `e2e/adaptive-layout.spec.ts`.

---

### Task 1: Schema v4 and width-only component model

**Files:**
- Modify: `src/domain/plan/canvas/models.ts`
- Modify: `src/domain/plan/canvas/migrate.ts`
- Modify: `src/domain/plan/canvas/plan.ts`
- Test: `src/domain/plan/canvas/models.test.ts`
- Test: `src/domain/plan/canvas/migrate.test.ts`
- Test: `src/domain/plan/canvas/plan.test.ts`
- Modify compile fixtures containing `schemaVersion: 3` or component `height` under `src/**/*.test.{ts,tsx}`.

**Interfaces:**
- Produces `CURRENT_SCHEMA_VERSION = 4`.
- Produces `BaseComponent { id: string; width: number }`.
- Produces `DEFAULT_IMAGE_HEIGHT = 135`.
- Produces `resizeComponent(plan, { id, width }): ProjectPlan` (no height parameter).
- All later tasks consume v4 `ProjectPlan`.

- [ ] **Step 1: Write failing migration/model tests**

Add these focused cases to `migrate.test.ts`:

```ts
it("migrates v3 to v4 by dropping component height and reducing image height once", () => {
  const v3 = {
    schemaVersion: 3,
    components: [
      { id: "p", type: "plan", width: 1, height: 220, html: "<p>x</p>" },
      {
        id: "r",
        type: "reference",
        width: 1,
        height: 320,
        title: "T",
        description: "",
        imageHeight: 180,
        showCaptions: false,
        images: [{ id: "i", file: "a.png", aspectRatio: 4 / 3 }],
      },
    ],
  };

  const migrated = migratePlan(v3);

  expect(migrated.schemaVersion).toBe(4);
  expect(migrated.components[0]).not.toHaveProperty("height");
  expect(migrated.components[1]).not.toHaveProperty("height");
  expect((migrated.components[1] as ReferenceComponent).imageHeight).toBe(135);
});

it("does not reduce v4 image height a second time", () => {
  const v4 = {
    schemaVersion: 4,
    components: [{
      id: "r", type: "reference", width: 1, title: "T", description: "",
      imageHeight: 135, showCaptions: false, images: [],
    }],
  };
  expect((migratePlan(v4).components[0] as ReferenceComponent).imageHeight).toBe(135);
});
```

Update the forward-compatibility case to use `schemaVersion: 5`.

Add to `plan.test.ts`:

```ts
it("resizes width without introducing a persisted height", () => {
  const next = resizeComponent(planWith([{ id: "p", type: "plan", width: 1, html: "" }]), {
    id: "p",
    width: 0.5,
  });
  expect(next.components[0]).toEqual({ id: "p", type: "plan", width: 0.5, html: "" });
  expect(next.components[0]).not.toHaveProperty("height");
});
```

- [ ] **Step 2: Run the focused tests and confirm red**

Run:

```powershell
pnpm exec vitest run src/domain/plan/canvas/models.test.ts src/domain/plan/canvas/migrate.test.ts src/domain/plan/canvas/plan.test.ts
```

Expected: FAIL because schema is 3, height is required, and the default image height is 180.

- [ ] **Step 3: Implement the v4 model and migration**

In `models.ts`:

```ts
export const DEFAULT_IMAGE_HEIGHT = 135;
export const CURRENT_SCHEMA_VERSION = 4 as const;

export interface BaseComponent {
  id: string;
  width: number;
}

export interface ProjectPlan {
  schemaVersion: 4;
  components: PlanComponent[];
}

export const EMPTY_PLAN: ProjectPlan = { schemaVersion: 4, components: [] };
```

In `migrate.ts`, normalize v4 without applying `0.75`, and make v3 migration explicit:

```ts
function migrateV3Component(raw: unknown, makeId: IdFactory): PlanComponent | null {
  const normalized = normalizeComponentFields(raw, makeId);
  if (!normalized) return null;
  if (normalized.type === "reference") {
    return {
      ...normalized,
      imageHeight: clampImageHeight(normalized.imageHeight * 0.75),
    };
  }
  return normalized;
}

if (raw.schemaVersion === 4 && Array.isArray(raw.components)) {
  return {
    schemaVersion: 4,
    components: raw.components
      .map((value) => normalizeV4Component(value, makeId))
      .filter((value): value is PlanComponent => value !== null),
  };
}

if (raw.schemaVersion === 3 && Array.isArray(raw.components)) {
  return {
    schemaVersion: 4,
    components: raw.components
      .map((value) => migrateV3Component(value, makeId))
      .filter((value): value is PlanComponent => value !== null),
  };
}
```

Change v2/v1 chained migration to return v4 directly with the new 135pt default.

In `plan.ts`:

```ts
export function resizeComponent(
  plan: ProjectPlan,
  params: { id: string; width: number },
): ProjectPlan {
  return mapComponent(plan, params.id, (component) => {
    const width = clampWidth(params.width);
    return width === component.width ? component : { ...component, width };
  });
}
```

Update all v4 fixtures and component constructors in production/tests; remove
`height` from them rather than type-casting around the model.

- [ ] **Step 4: Run tests and typecheck**

```powershell
pnpm exec vitest run src/domain/plan/canvas/models.test.ts src/domain/plan/canvas/migrate.test.ts src/domain/plan/canvas/plan.test.ts
pnpm typecheck
```

Expected: all focused tests pass; typecheck clean.

- [ ] **Step 5: Commit**

```powershell
git add src
git commit -m "feat(canvas): migrate plans to schema v4 automatic component heights`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Pure proportional image rows and reference pagination

**Files:**
- Create: `src/domain/plan/canvas/referenceLayout.ts`
- Create: `src/domain/plan/canvas/referenceLayout.test.ts`
- Modify: `src/domain/plan/canvas/geometry.ts` (reuse/replace `packAspectRow` only if callers remain).

**Interfaces:**

```ts
export const COMPONENT_INSET = 12;
export const REFERENCE_HEADER_HEIGHT = 54;
export const REFERENCE_CONTINUATION_HEADER_HEIGHT = 24;
export const REFERENCE_DESCRIPTION_HEIGHT = 44;
export const IMAGE_GAP = 12;
export const ADD_TILE = { width: 120, height: 90 } as const;

export interface ReferenceFlowItem {
  kind: "image" | "add";
  id: string;
  aspectRatio: number;
}

export interface ReferenceFlowSlot extends Rect {
  kind: "image" | "add";
  id: string;
  imageHeight: number;
  captionHeight: number;
}

export interface ReferenceRow {
  y: number;
  height: number;
  slots: ReferenceFlowSlot[];
}

export interface ReferenceFragmentLayout {
  fragmentIndex: number;
  kind: "first" | "continuation";
  height: number;
  rows: ReferenceRow[];
}

export function normalizeAspectRatio(value: number): number;
export function packReferenceRows(input: {
  images: ReferenceImage[];
  imageHeight: number;
  showCaptions: boolean;
  innerWidth: number;
}): ReferenceRow[];
export function paginateReferenceRows(input: {
  rows: ReferenceRow[];
  firstAvailableHeight: number;
  continuationAvailableHeight: number;
}): ReferenceFragmentLayout[];
```

- [ ] **Step 1: Write failing pure tests**

Create tests covering exact ratios and pagination:

```ts
it("uses H * ratio for landscape and portrait widths", () => {
  const rows = packReferenceRows({
    images: [
      { id: "wide", file: "w.png", aspectRatio: 4 / 3 },
      { id: "tall", file: "t.png", aspectRatio: 2 / 3 },
    ],
    imageHeight: 135,
    showCaptions: false,
    innerWidth: 500,
  });
  expect(rows[0].slots[0]).toMatchObject({ width: 180, imageHeight: 135 });
  expect(rows[0].slots[1]).toMatchObject({ width: 90, imageHeight: 135 });
});

it("puts captions below images and adds one third of image height", () => {
  const [row] = packReferenceRows({
    images: [{ id: "i", file: "i.png", aspectRatio: 1 }],
    imageHeight: 135,
    showCaptions: true,
    innerWidth: 500,
  });
  expect(row.slots[0].captionHeight).toBe(45);
  expect(row.slots[0].height).toBe(180);
});

it("falls back invalid ratios to one", () => {
  expect(normalizeAspectRatio(Number.NaN)).toBe(1);
  expect(normalizeAspectRatio(0)).toBe(1);
  expect(normalizeAspectRatio(-1)).toBe(1);
});

it("splits only between complete rows", () => {
  const fragments = paginateReferenceRows({
    rows: [
      { y: 0, height: 100, slots: [] },
      { y: 112, height: 100, slots: [] },
      { y: 224, height: 100, slots: [] },
    ],
    firstAvailableHeight: 210,
    continuationAvailableHeight: 220,
  });
  expect(fragments.map((f) => f.rows.length)).toEqual([1, 2]);
});
```

Also test add-button wrapping and a single 5:1 image scaling to the inner width.

- [ ] **Step 2: Run red**

```powershell
pnpm exec vitest run src/domain/plan/canvas/referenceLayout.test.ts
```

Expected: FAIL because module/exports do not exist.

- [ ] **Step 3: Implement the pure row packer**

Core width calculation:

```ts
export function normalizeAspectRatio(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function imageSlot(image: ReferenceImage, requestedHeight: number, innerWidth: number, captions: boolean): ReferenceFlowSlot {
  const ratio = normalizeAspectRatio(image.aspectRatio);
  const scale = Math.min(1, innerWidth / (requestedHeight * ratio));
  const imageHeight = requestedHeight * scale;
  const width = imageHeight * ratio;
  const captionHeight = captions ? imageHeight / 3 : 0;
  return {
    kind: "image",
    id: image.id,
    x: 0,
    y: 0,
    width,
    height: imageHeight + captionHeight,
    imageHeight,
    captionHeight,
  };
}
```

Pack slots left-to-right, add `IMAGE_GAP`, wrap when the next right edge exceeds
`innerWidth`, and append `{ kind: "add", id: "__add__" }` as the final flow item.
`paginateReferenceRows` must always place at least one row in an empty fragment
after proportionally shrinking a row that exceeds the available page height.

- [ ] **Step 4: Run green**

```powershell
pnpm exec vitest run src/domain/plan/canvas/referenceLayout.test.ts src/domain/plan/canvas/geometry.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add src/domain/plan/canvas
git commit -m "feat(canvas): add proportional reference row packing and pagination`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Adaptive A4 layout and component fragments

**Files:**
- Modify: `src/domain/plan/canvas/engine.ts`
- Modify: `src/domain/plan/canvas/engine.test.ts`
- Modify: `src/domain/plan/canvas/pdf/exportDocument.ts`
- Modify: `src/domain/plan/canvas/pdf/exportDocument.test.ts`

**Interfaces:**

```ts
export interface LayoutMeasurements {
  planHeights: ReadonlyMap<string, number>;
  referenceDescriptionHeights: ReadonlyMap<string, number>;
}

export interface ComponentFragmentPlacement {
  fragmentId: string;
  componentId: string;
  fragmentIndex: number;
  pageIndex: number;
  kind: "whole" | "first" | "continuation";
  rect: Rect;
  imageSlots?: ReferenceFlowSlot[];
}

export interface LayoutResult {
  pageCount: number;
  placements: ComponentFragmentPlacement[];
}

export function layoutPlan(
  components: PlanComponent[],
  geometry?: PageGeometry,
  measurements?: LayoutMeasurements,
): LayoutResult;
```

- [ ] **Step 1: Replace fixed-height engine tests with adaptive cases**

```ts
it("uses the measured plan height", () => {
  const result = layoutPlan(
    [{ id: "p", type: "plan", width: 1, html: "" }],
    DEFAULT_PAGE_GEOMETRY,
    { planHeights: new Map([["p", 123]]), referenceDescriptionHeights: new Map() },
  );
  expect(result.placements[0].rect.height).toBe(123);
});

it("emits multiple fragments for a reference group whose rows cross pages", () => {
  const result = layoutPlan([referenceWithTwelveImages()], narrowGeometry);
  const fragments = result.placements.filter((p) => p.componentId === "ref");
  expect(fragments.length).toBeGreaterThan(1);
  expect(fragments[0].kind).toBe("first");
  expect(fragments[1].kind).toBe("continuation");
  expect(new Set(fragments.map((f) => f.pageIndex)).size).toBe(fragments.length);
});
```

Retain side-by-side width wrapping and page-cap tests, but remove assertions
against persisted component height.

- [ ] **Step 2: Run red**

```powershell
pnpm exec vitest run src/domain/plan/canvas/engine.test.ts src/domain/plan/canvas/pdf/exportDocument.test.ts
```

Expected: fixed-height layout fails the new cases.

- [ ] **Step 3: Implement adaptive placements**

Use these rules:

```ts
const FALLBACK_PLAN_HEIGHT = 56;

function planHeight(id: string, measurements: LayoutMeasurements): number {
  const value = measurements.planHeights.get(id);
  return Number.isFinite(value) && (value ?? 0) > 0 ? value! : FALLBACK_PLAN_HEIGHT;
}
```

For reference components, call `packReferenceRows`, derive the first and
continuation available page heights after headers/insets, and call
`paginateReferenceRows`. Emit stable fragment ids:

```ts
const fragmentId = `${component.id}::${fragmentIndex}`;
```

Logical row packing still uses component width. Components that fit on one row
share `y`; the row height is the maximum natural whole/first-fragment height.
Continuation fragments start in page content origin on subsequent pages.

- [ ] **Step 4: Run green**

```powershell
pnpm exec vitest run src/domain/plan/canvas/engine.test.ts src/domain/plan/canvas/pdf/exportDocument.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add src/domain/plan/canvas
git commit -m "feat(canvas): derive adaptive A4 placements and reference fragments`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: Continuous paged canvas and width-only frames

**Files:**
- Create: `src/features/plan/canvas/PagedCanvasSurface.tsx`
- Create: `src/features/plan/canvas/PagedCanvasSurface.test.tsx`
- Modify: `src/features/plan/canvas/CanvasPage.tsx` (remove after callers migrate, or retain as a thin sheet-background helper only).
- Modify: `src/features/plan/canvas/ComponentFrame.tsx`
- Modify: `src/features/plan/canvas/PlanCanvas.tsx`
- Modify: `src/features/plan/canvas/PlanCanvas.test.tsx`
- Modify: `src/features/plan/canvas/useComponentResize.ts`
- Modify: `src/features/plan/canvas/useComponentResize.test.ts`

**Interfaces:**

```ts
export const PAGE_SCREEN_GAP = 16;
export function pageTopPx(pageIndex: number, scale: number): number;

interface PagedCanvasSurfaceProps {
  pageCount: number;
  scale: number;
  children: React.ReactNode;
}
```

`ComponentFrame.onResize` becomes `(id: string, params: { width: number })`.

- [ ] **Step 1: Write failing surface/frame tests**

```tsx
it("renders A4 sheet backgrounds in one continuous positioning surface", () => {
  render(<PagedCanvasSurface pageCount={2} scale={1}><div /></PagedCanvasSurface>);
  expect(screen.getAllByTestId("canvas-page-background")).toHaveLength(2);
  expect(screen.getByTestId("paged-canvas-surface")).toHaveStyle({
    height: `${A4.height * 2 + PAGE_SCREEN_GAP}px`,
  });
});

it("keeps only left and right width resize handles", () => {
  renderCanvas();
  expect(document.querySelector('[data-resize-handle="left"]')).toBeInTheDocument();
  expect(document.querySelector('[data-resize-handle="width"]')).toBeInTheDocument();
  expect(document.querySelector('[data-resize-handle="top"]')).toBeNull();
  expect(document.querySelector('[data-resize-handle="height"]')).toBeNull();
  expect(document.querySelector('[data-resize-handle="both"]')).toBeNull();
});
```

- [ ] **Step 2: Run red**

```powershell
pnpm exec vitest run src/features/plan/canvas/PagedCanvasSurface.test.tsx src/features/plan/canvas/PlanCanvas.test.tsx src/features/plan/canvas/useComponentResize.test.ts
```

- [ ] **Step 3: Implement one global positioning surface**

```tsx
export function PagedCanvasSurface({ pageCount, scale, children }: PagedCanvasSurfaceProps) {
  const pageHeight = A4.height * scale;
  return (
    <div
      className="relative"
      data-testid="paged-canvas-surface"
      style={{ width: A4.width * scale, height: pageCount * pageHeight + (pageCount - 1) * PAGE_SCREEN_GAP }}
    >
      {Array.from({ length: pageCount }, (_, index) => (
        <div
          className="absolute left-0 bg-white shadow-sm dark:bg-stone-900"
          data-testid="canvas-page-background"
          key={index}
          style={{ top: pageTopPx(index, scale), width: A4.width * scale, height: pageHeight }}
        />
      ))}
      {children}
    </div>
  );
}
```

Convert placement page coordinates to global screen Y with one helper. Render
one `ComponentFrame` per placement fragment. Frame height is
`placement.rect.height * scale`, but it is derived, not user-controlled.

Simplify `resizeFromDrag` to return only `width`, and delete vertical pointer
handlers/state from `ComponentFrame`.

- [ ] **Step 4: Run green**

```powershell
pnpm exec vitest run src/features/plan/canvas/PagedCanvasSurface.test.tsx src/features/plan/canvas/PlanCanvas.test.tsx src/features/plan/canvas/useComponentResize.test.ts
pnpm typecheck
```

- [ ] **Step 5: Commit**

```powershell
git add src/features/plan/canvas
git commit -m "feat(canvas): render adaptive fragments on a continuous A4 surface`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: Natural BlockNote height and block-aware page spacers

**Files:**
- Create: `src/features/plan/canvas/useNaturalHeight.ts`
- Create: `src/features/plan/canvas/useNaturalHeight.test.tsx`
- Create: `src/features/plan/canvas/usePlanContentMeasurement.ts`
- Create: `src/features/plan/canvas/usePlanContentMeasurement.test.tsx`
- Modify: `src/features/plan/canvas/PlanTextComponentView.tsx`
- Modify: `src/features/plan/RichTextEditor.tsx`
- Modify: `src/features/plan/ProjectCanvasProvider.tsx`
- Modify: `src/features/plan/ProjectCanvasProvider.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**

```ts
export function useNaturalHeight(input: {
  id: string;
  scale: number;
  onHeight(id: string, heightPoints: number): void;
}): React.RefObject<HTMLDivElement | null>;

export interface PlanMeasurement {
  heightPoints: number;
  pageBreakBeforeBlockIds: string[];
}

export function usePlanContentMeasurement(input: {
  componentId: string;
  scale: number;
  contentHeightPoints: number;
  onMeasure(id: string, measurement: PlanMeasurement): void;
}): { rootRef: React.RefObject<HTMLDivElement | null> };
```

`PlanCanvas` receives:

```ts
measurements: LayoutMeasurements;
onMeasurePlan(id: string, measurement: PlanMeasurement): void;
onMeasureReferenceDescription(id: string, heightPoints: number): void;
```

- [ ] **Step 1: Write failing observer tests**

Mock `ResizeObserver` and block rectangles:

```tsx
it("reports natural height in A4 points and ignores sub-one-point jitter", () => {
  const onMeasure = vi.fn();
  render(<NaturalHeightHarness scale={0.5} onHeight={onMeasure} />);
  resizeObserverCallback([{ target: root, contentRect: { height: 100 } }]);
  expect(onMeasure).toHaveBeenCalledWith("p", 200);
  resizeObserverCallback([{ target: root, contentRect: { height: 100.2 } }]);
  expect(onMeasure).toHaveBeenCalledTimes(1);
});

it("marks the first whole block that would cross a page boundary", () => {
  setBlockRects([{ id: "a", top: 0, bottom: 200 }, { id: "b", top: 200, bottom: 430 }]);
  const result = calculatePlanPageBreaks(blocks, 400);
  expect(result).toEqual(["b"]);
});
```

- [ ] **Step 2: Run red**

```powershell
pnpm exec vitest run src/features/plan/canvas/useNaturalHeight.test.tsx src/features/plan/canvas/usePlanContentMeasurement.test.tsx src/features/plan/ProjectCanvasProvider.test.tsx
```

- [ ] **Step 3: Implement measurement and runtime spacers**

Expose a wrapper ref from `RichTextEditor`, and mark top-level BlockNote blocks
with stable runtime ids based on their DOM order. Apply page spacing using a CSS
custom property, never by changing editor HTML:

```css
.bn-page-break-before {
  margin-top: var(--bn-page-break-space);
  position: relative;
}
.bn-page-break-before::before {
  content: "";
  position: absolute;
  top: calc(-1 * var(--bn-page-break-space));
  left: 0;
  right: 0;
  border-top: 1px dashed rgb(214 211 209);
}
```

In provider state:

```ts
const [planMeasurements, setPlanMeasurements] = useState<ReadonlyMap<string, PlanMeasurement>>(new Map());
const [referenceDescriptionHeights, setReferenceDescriptionHeights] =
  useState<ReadonlyMap<string, number>>(new Map());

const handleMeasurePlan = useCallback((id: string, next: PlanMeasurement) => {
  setPlanMeasurements((current) => {
    const previous = current.get(id);
    if (previous && Math.abs(previous.heightPoints - next.heightPoints) < 1 &&
        arraysEqual(previous.pageBreakBeforeBlockIds, next.pageBreakBeforeBlockIds)) return current;
    return new Map(current).set(id, next);
  });
}, []);

const handleMeasureReferenceDescription = useCallback((id: string, heightPoints: number) => {
  if (!Number.isFinite(heightPoints) || heightPoints < 0) return;
  setReferenceDescriptionHeights((current) => {
    const previous = current.get(id);
    if (previous !== undefined && Math.abs(previous - heightPoints) < 1) return current;
    return new Map(current).set(id, heightPoints);
  });
}, []);
```

Reset measurements on `projectPath` change. Keep measurements outside
`ProjectPlan`, undo history, and persistence.

- [ ] **Step 4: Run green**

```powershell
pnpm exec vitest run src/features/plan/canvas/useNaturalHeight.test.tsx src/features/plan/canvas/usePlanContentMeasurement.test.tsx src/features/plan/ProjectCanvasProvider.test.tsx
pnpm typecheck
```

- [ ] **Step 5: Commit**

```powershell
git add src/features/plan src/styles.css
git commit -m "feat(canvas): grow plan cards from measured BlockNote content`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 6: Reference UI without scrollbars or crop

**Files:**
- Modify: `src/features/plan/canvas/ReferenceComponentView.tsx`
- Modify: `src/features/plan/canvas/ReferenceComponentView.test.tsx`
- Modify: `src/features/plan/GroupImageGrid.tsx`
- Modify: `src/features/plan/GroupImageGrid.test.tsx`
- Modify: `src/features/plan/SortableImageTile.tsx`
- Modify: `src/features/plan/SortableImageTile.test.tsx`
- Modify: `src/features/plan/ProjectCanvasProvider.tsx` (15pt image-height steps).

**Interfaces:**
- Consumes `ReferenceFlowSlot[]` from Task 2/3.
- `ReferenceComponentView` receives `fragmentKind`, `fragmentIndex`, and only the slots/images for that fragment.
- `ReferenceComponentView` receives `scale` and
  `onMeasureDescription(id: string, heightPoints: number)`; its first fragment
  wraps the description editor with `useNaturalHeight`, feeding the provider's
  `referenceDescriptionHeights` map from Task 5.
- Continuation fragments render title `t("reference.continuedTitle", { title })`.

- [ ] **Step 1: Write failing UI tests**

```tsx
it("does not render an internal scrolling region", () => {
  renderReference();
  expect(screen.getByTestId("reference-component-body")).not.toHaveClass("overflow-auto");
});

it("renders the image and caption as separate vertical regions", () => {
  renderTile({ slot: { kind: "image", id: "i", x: 0, y: 0, width: 180, height: 180, imageHeight: 135, captionHeight: 45 } });
  expect(screen.getByRole("img", { name: "参考图" })).toHaveClass("object-contain");
  expect(screen.getByTestId("image-region")).toHaveStyle({ height: "135px" });
  expect(screen.getByRole("textbox")).toHaveStyle({ height: "45px" });
});

it("renders a continuation title without editable controls", () => {
  renderReference({ fragmentKind: "continuation" });
  expect(screen.getByText("Lookbook（续）")).toBeVisible();
  expect(screen.queryByLabelText("分组标题")).toBeNull();
});
```

- [ ] **Step 2: Run red**

```powershell
pnpm exec vitest run src/features/plan/canvas/ReferenceComponentView.test.tsx src/features/plan/GroupImageGrid.test.tsx src/features/plan/SortableImageTile.test.tsx
```

- [ ] **Step 3: Implement natural reference rendering**

Remove:

```tsx
<div className="flex-1 overflow-auto">
```

Use:

```tsx
<div data-testid="reference-component-body">
  <GroupImageGrid ... />
</div>
```

In the tile:

```tsx
<div data-testid="image-region" style={{ height: slot.imageHeight * scale }}>
  <img className="h-full w-full object-contain" ... />
</div>
{slot.captionHeight > 0 ? (
  <textarea style={{ height: slot.captionHeight * scale }} ... />
) : null}
```

Use the shared `COMPONENT_INSET` for title, description, grid, and plan editor.
Change +/- handlers to 15pt. Add i18n `reference.continuedTitle`.

- [ ] **Step 4: Run green**

```powershell
pnpm exec vitest run src/features/plan/canvas/ReferenceComponentView.test.tsx src/features/plan/GroupImageGrid.test.tsx src/features/plan/SortableImageTile.test.tsx
pnpm typecheck
```

- [ ] **Step 5: Commit**

```powershell
git add src/features/plan src/shared/i18n/locales/zh.ts
git commit -m "feat(reference): auto-grow proportional image rows without cropping`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 7: Live component and image sortable animation

**Files:**
- Modify: `src/features/plan/canvas/ComponentFrame.tsx`
- Modify: `src/features/plan/canvas/PlanCanvas.tsx`
- Create: `src/features/plan/canvas/DragOverlayPreview.tsx`
- Create: `src/features/plan/canvas/DragOverlayPreview.test.tsx`
- Create: `src/shared/hooks/usePrefersReducedMotion.ts`
- Create: `src/shared/hooks/usePrefersReducedMotion.test.ts`
- Modify: `src/features/plan/SortableImageTile.tsx`
- Modify: `src/features/plan/canvas/PlanCanvas.test.tsx`
- Modify: `src/features/plan/canvas/canvasDropGeometry.ts` and tests if global-page Y changes require it.

**Interfaces:**
- `ComponentFrame` uses `useSortable({ id, data: { type: "component" } })`.
- `PlanCanvas` owns `activeDrag: { type: "component" | "image"; id: string } | null`.
- Preview order remains `PlanComponent[] | null`; persistence callbacks remain unchanged.
- Produces `usePrefersReducedMotion(): boolean`, backed by
  `window.matchMedia("(prefers-reduced-motion: reduce)")`.

- [ ] **Step 1: Write failing animation tests**

Mock dnd-kit hooks and assert:

```tsx
it("keeps a same-size placeholder and renders a DragOverlay during component drag", () => {
  renderCanvasWithActiveDrag("plan1");
  expect(screen.getByTestId("component-placeholder-plan1")).toBeVisible();
  expect(screen.getByTestId("drag-overlay-preview")).toHaveTextContent("摄影计划");
});

it("uses a 180ms delayed pointer activation", () => {
  renderCanvas();
  expect(useSensor).toHaveBeenCalledWith(PointerSensor, {
    activationConstraint: { delay: 180, tolerance: 6 },
  });
});

it("disables translation for reduced motion", () => {
  mockMatchMediaReducedMotion(true);
  renderFrame();
  expect(frameStyle.transition).toBeUndefined();
});
```

- [ ] **Step 2: Run red**

```powershell
pnpm exec vitest run src/features/plan/canvas/PlanCanvas.test.tsx src/features/plan/canvas/DragOverlayPreview.test.tsx src/features/plan/SortableImageTile.test.tsx src/shared/hooks/usePrefersReducedMotion.test.ts
```

- [ ] **Step 3: Implement sortable frames and overlay**

Use:

```ts
const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
);
```

In sortable options:

```ts
const prefersReducedMotion = usePrefersReducedMotion();
animateLayoutChanges: (args) =>
  prefersReducedMotion ? false : defaultAnimateLayoutChanges(args),
transition: prefersReducedMotion ? null : { duration: 200, easing: "ease-out" },
```

Render `DragOverlay` inside the existing `DndContext`. For a multi-page
component, `DragOverlayPreview` shows the type/title and image/text count in a
max-height compact card; it does not clone BlockNote.

Keep preview layout in `onDragOver`, but render the active original at its
original placement with dashed border/transparent content. Render all other
components from preview placements so they animate toward the target.

Use the same placeholder contract for images. Captions are inside the sortable
tile root and move with the image.

- [ ] **Step 4: Run green**

```powershell
pnpm exec vitest run src/features/plan/canvas/PlanCanvas.test.tsx src/features/plan/canvas/DragOverlayPreview.test.tsx src/features/plan/SortableImageTile.test.tsx src/features/plan/canvas/imageDropTarget.test.ts src/shared/hooks/usePrefersReducedMotion.test.ts
pnpm typecheck
```

- [ ] **Step 5: Commit**

```powershell
git add src/features/plan src/shared/hooks
git commit -m "feat(canvas): add live sortable placeholders and drag overlays`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 8: PDF parity with adaptive reference fragments

**Files:**
- Modify: `src/domain/plan/canvas/pdf/exportDocument.ts`
- Modify: `src/domain/plan/canvas/pdf/exportDocument.test.ts`
- Modify: `src/infrastructure/pdf/canvasPdfExporter.ts`
- Modify: `src/infrastructure/pdf/canvasPdfExporter.test.ts`
- Modify: `src/infrastructure/pdf/slotPageRect.ts` and tests if fragment-local coordinates change.

**Interfaces:**
- PDF uses `buildCanvasLayout(components, geometry, pdfMeasurements)`.
- Reference placements expose fragment-local image slots plus stable image ids; exporter does not assume slot index equals `ref.images[index]`.

- [ ] **Step 1: Write failing PDF layout tests**

```ts
it("exports a landscape image at 4:3 without cropping", async () => {
  const result = await exportFixture(referencePlan([{ id: "i", aspectRatio: 4 / 3 }]));
  expect(result.drawImage).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ width: 180, height: 135 }),
  );
});

it("draws continuation rows on their fragment pages", async () => {
  const result = await exportFixture(referencePlan(manyImages()));
  expect(result.pdfPagesUsed.size).toBeGreaterThan(1);
  expect(result.drawnImageIds).toEqual(manyImages().map((image) => image.id));
});
```

- [ ] **Step 2: Run red**

```powershell
pnpm exec vitest run src/domain/plan/canvas/pdf/exportDocument.test.ts src/infrastructure/pdf/canvasPdfExporter.test.ts src/infrastructure/pdf/slotPageRect.test.ts
```

- [ ] **Step 3: Reuse reference slots/fragments**

Resolve images by slot id:

```ts
const imageById = new Map(ref.images.map((image) => [image.id, image]));
for (const slot of placement.imageSlots ?? []) {
  if (slot.kind !== "image") continue;
  const reference = imageById.get(slot.id);
  if (!reference) continue;
  // embed/draw into slot.imageHeight and slot.width; caption below
}
```

Do not call `object-cover`-equivalent PDF logic. Since slot ratio already equals
the image ratio, draw exact slot dimensions; retain `containSize` as a safety
guard for malformed source metadata.

Draw continuation heading on `kind === "continuation"`. Rich-text PDF continues
through `parseHtmlToBlocks` and its own pagination; it does not use browser
measurements.

- [ ] **Step 4: Run green**

```powershell
pnpm exec vitest run src/domain/plan/canvas/pdf/exportDocument.test.ts src/infrastructure/pdf/canvasPdfExporter.test.ts src/infrastructure/pdf/slotPageRect.test.ts
pnpm typecheck
```

- [ ] **Step 5: Commit**

```powershell
git add src/domain/plan/canvas/pdf src/infrastructure/pdf
git commit -m "feat(pdf): match adaptive reference image flow and pagination`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 9: Integration E2E, featurelist, and complete matrix

**Files:**
- Create: `e2e/adaptive-layout.spec.ts`
- Modify: `docs/design_docs/featurelist.json`
- Modify any focused tests exposed by the complete suite, only when failures are caused by schema v4/adaptive layout.

**Interfaces:** No new production interfaces. This task verifies the complete feature.

- [ ] **Step 1: Add E2E acceptance tests**

Use real selectors already present in `e2e/canvas.spec.ts`:

```ts
test("plan card grows with text and has no large fixed-height blank area", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改");
  const frame = page.locator('[data-component-frame="true"]').filter({ hasText: "摄影计划" }).first();
  const before = await frame.boundingBox();
  const editor = frame.locator(".bn-editor");
  await editor.click();
  await page.keyboard.type("\n第一行\n第二行\n第三行\n第四行");
  await expect.poll(async () => (await frame.boundingBox())?.height ?? 0).toBeGreaterThan(before?.height ?? 0);
});

test("reference images wrap and grow without an internal scrollbar", async ({ page }) => {
  await page.goto("/");
  const reference = page.locator('[data-component-frame="true"]').filter({ hasText: "参考图组" }).first();
  await expect(reference.locator('[data-testid="reference-component-body"]')).not.toHaveCSS("overflow-y", "auto");
  const landscape = reference.locator('[data-image-id]').first();
  const portrait = reference.locator('[data-image-id]').nth(1);
  expect((await landscape.boundingBox())!.width).toBeGreaterThan((await portrait.boundingBox())!.width);
});

test("component drag shows live placeholder and commits one final order", async ({ page }) => {
  await page.goto("/");
  const handle = page.locator("[data-component-frame-topbar]").first();
  await handle.hover();
  await page.mouse.down();
  await page.waitForTimeout(200);
  await page.mouse.move(400, 600, { steps: 10 });
  await expect(page.locator('[data-drag-placeholder="component"]')).toBeVisible();
  await expect(page.getByTestId("drag-overlay-preview")).toBeVisible();
  await page.mouse.up();
});
```

Use the memory adapter's existing seeded image set; do not add filesystem
fixtures to Playwright.

- [ ] **Step 2: Run the focused E2E**

```powershell
pnpm exec playwright test e2e/adaptive-layout.spec.ts
```

Expected: all new tests pass.

- [ ] **Step 3: Update featurelist**

Add or extend the Canvas feature with:

- `schemaVersion 4` and removal of persisted component height;
- v3 image height migration to 75%;
- content-driven plan/reference height;
- proportional non-cropped reference flow and caption region;
- row-boundary reference pagination and one-editor plan page spacers;
- live component/image placeholders, overlay, reduced-motion behavior;
- actual final test counts and date `2026-08-05`.

Validate:

```powershell
node -e "JSON.parse(require('fs').readFileSync('docs/design_docs/featurelist.json','utf8')); console.log('valid')"
```

- [ ] **Step 4: Run the complete validation matrix**

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
cargo test --manifest-path src-tauri\Cargo.toml
pnpm build
```

Expected: all pass. The known pre-existing `ThemeProvider.tsx`
`react-refresh/only-export-components` warning is acceptable only if unchanged;
no new warnings.

- [ ] **Step 5: Commit**

```powershell
git add e2e docs/design_docs/featurelist.json
git commit -m "test(canvas): verify adaptive layout drag preview and update featurelist`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Self-Review

### Spec coverage

- Automatic component height / width-only resizing: Tasks 1, 3, 4.
- Aligned compact insets / text growth: Tasks 4, 5, 6.
- 75% migration and retained control: Tasks 1 and 6.
- Proportional full images, dynamic wrapping, no internal scrollbar: Tasks 2 and 6.
- Reference row pagination: Tasks 2, 3, 6, 8.
- One BlockNote editor with page-break spacers: Tasks 4 and 5.
- Live component/image placeholder, overlay, animation, reduced motion: Task 7.
- PDF parity: Task 8.
- E2E, featurelist, full validation: Task 9.

### Placeholder scan

The plan contains no unresolved placeholder markers. Every task names exact
files, interfaces, tests, commands, and commit messages.

### Type consistency

- All production and test plans use `schemaVersion: 4`.
- `ReferenceFlowSlot`, `ReferenceRow`, `ReferenceFragmentLayout`, and
  `ComponentFragmentPlacement` have one definition and are reused by UI/PDF.
- Component resize accepts width only end-to-end.
- Runtime `PlanMeasurement` stays outside persisted `ProjectPlan` and history.
- Placements identify images by id, avoiding fragment-local index mismatches.
