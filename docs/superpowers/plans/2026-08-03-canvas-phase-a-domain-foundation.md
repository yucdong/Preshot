# Canvas Component System — Phase A: Domain Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, exhaustively-tested computational core of the A4 canvas component system — the v2 component model, shared A4 geometry, the flow/pagination layout engine (incl. reference image slots + caption bands), the component reducers, the v1→v2 migration, and the component drop-target math.

**Architecture:** All new code lands under a new `src/domain/plan/canvas/` namespace (pure TypeScript, no React/Tauri/DOM), added **alongside** the existing plan model so the current app keeps compiling and every task ends with the full suite green. Later phases (B: wiring/UI/Rust/PDF; C: captions+template) consume and then promote this core.

**Tech Stack:** TypeScript, Vitest. No new dependencies.

## Global Constraints

- Package manager is **pnpm** (`pnpm@10.15.0`); never add npm/yarn lock files.
- All new domain code lives under `src/domain/plan/canvas/` and must not import React, Tauri, browser APIs, or `src/infrastructure` (domain purity per AGENTS.md).
- Do NOT modify the existing `src/domain/plan/models.ts`, `plan.ts`, `service.ts`, PDF code, providers, or Rust in this phase — Phase A is purely additive; the existing suite must stay green.
- Heights and all geometry are in **A4 points** (`A4 = { width: 595.28, height: 841.89 }`, margin 48). Width snaps to the fraction set `{1, 3/4, 2/3, 1/2, 1/3, 1/4}`.
- Flow layout: components ordered; wrap to next row when they don't fit; move wholly to the next page when the page is full; never split across pages; never overlap; never exceed the page; a component is clamped to at most one page's content height.
- Reducers/engine/migration are **pure and total**: no throws; clamp/guard invalid inputs; no-op returns the same reference.
- TDD per task: write the failing test first, watch it fail, implement, watch it pass, commit. Run the smallest relevant test while iterating and `pnpm test` (full suite) once before committing.
- Commit messages end with the trailer `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.
- Validation commands: `pnpm exec vitest run <file>` (focused), `pnpm test` (full), `pnpm typecheck`.

---

## File Structure (Phase A — all new, additive)

- `src/domain/plan/canvas/models.ts` — v2 types, constants, and pure helpers (`fractionValue`, `snapWidthFraction`, `clampColumns`, `clampHeight`).
- `src/domain/plan/canvas/geometry.ts` — shared A4 constants, `PageGeometry`, `Rect`, `contentSize`, `squareSlotGrid`, `containSize` (generalized to a `w×h` slot).
- `src/domain/plan/canvas/engine.ts` — `layoutPlan` (placement + pagination) and `referenceImageSlots` / `slotCaptionSplit`.
- `src/domain/plan/canvas/plan.ts` — pure reducers over `ProjectPlan`.
- `src/domain/plan/canvas/migrate.ts` — `migratePlan` (v2 normalize, v1→v2, empty/malformed → `EMPTY_PLAN`).
- `src/domain/plan/canvas/dropTarget.ts` — `componentDropTarget` (component reorder insertion index).
- Co-located `*.test.ts` for each.

---

## Task 1: v2 component model + pure helpers

**Files:**
- Create: `src/domain/plan/canvas/models.ts`
- Test: `src/domain/plan/canvas/models.test.ts`

**Interfaces:**
- Produces: `WidthFraction`, `WIDTH_FRACTIONS`, `fractionValue`, `snapWidthFraction`, `clampColumns`, `clampHeight`, `ReferenceImage`, `PlanTextComponent`, `ReferenceComponent`, `PlanComponent`, `ProjectPlan`, `EMPTY_PLAN`, and constants `MIN_COLUMNS`, `MAX_COLUMNS`, `DEFAULT_COLUMNS`, `MIN_COMPONENT_HEIGHT`, `DEFAULT_PLAN_HEIGHT`, `DEFAULT_REFERENCE_HEIGHT`, `CURRENT_SCHEMA_VERSION`.

- [ ] **Step 1: Write the failing test**

Create `src/domain/plan/canvas/models.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  clampColumns,
  clampHeight,
  EMPTY_PLAN,
  fractionValue,
  MAX_COLUMNS,
  MIN_COLUMNS,
  MIN_COMPONENT_HEIGHT,
  snapWidthFraction,
  WIDTH_FRACTIONS,
} from "./models";

describe("canvas models", () => {
  it("exposes the six width fractions in descending order", () => {
    expect(WIDTH_FRACTIONS).toEqual(["1", "3/4", "2/3", "1/2", "1/3", "1/4"]);
  });

  it("parses a fraction string to its numeric value", () => {
    expect(fractionValue("1")).toBe(1);
    expect(fractionValue("1/2")).toBeCloseTo(0.5, 10);
    expect(fractionValue("2/3")).toBeCloseTo(2 / 3, 10);
  });

  it("snaps an arbitrary 0..1 ratio to the nearest allowed fraction", () => {
    expect(snapWidthFraction(0.95)).toBe("1");
    expect(snapWidthFraction(0.52)).toBe("1/2");
    expect(snapWidthFraction(0.3)).toBe("1/3");
    expect(snapWidthFraction(0.26)).toBe("1/4");
    expect(snapWidthFraction(-5)).toBe("1/4"); // clamps to the smallest
    expect(snapWidthFraction(5)).toBe("1"); // clamps to the largest
  });

  it("clamps columns into range and rounds", () => {
    expect(clampColumns(0)).toBe(MIN_COLUMNS);
    expect(clampColumns(99)).toBe(MAX_COLUMNS);
    expect(clampColumns(2.6)).toBe(3);
    expect(clampColumns(Number.NaN)).toBe(MIN_COLUMNS);
  });

  it("clamps height between the minimum and a supplied maximum", () => {
    expect(clampHeight(10, 500)).toBe(MIN_COMPONENT_HEIGHT);
    expect(clampHeight(900, 500)).toBe(500);
    expect(clampHeight(300, 500)).toBe(300);
    expect(clampHeight(Number.NaN, 500)).toBe(MIN_COMPONENT_HEIGHT);
  });

  it("provides an empty v2 plan", () => {
    expect(EMPTY_PLAN).toEqual({ schemaVersion: 2, components: [] });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/domain/plan/canvas/models.test.ts`
Expected: FAIL (module not found / exports undefined).

- [ ] **Step 3: Implement the model**

Create `src/domain/plan/canvas/models.ts`:
```ts
export type WidthFraction = "1" | "3/4" | "2/3" | "1/2" | "1/3" | "1/4";

export const WIDTH_FRACTIONS: WidthFraction[] = ["1", "3/4", "2/3", "1/2", "1/3", "1/4"];

export const MIN_COLUMNS = 1;
export const MAX_COLUMNS = 6;
export const DEFAULT_COLUMNS = 3;

export const MIN_COMPONENT_HEIGHT = 80; // points
export const DEFAULT_PLAN_HEIGHT = 220; // points
export const DEFAULT_REFERENCE_HEIGHT = 320; // points

export const CURRENT_SCHEMA_VERSION = 2 as const;

export function fractionValue(fraction: WidthFraction): number {
  const [num, den] = fraction.split("/");
  return den === undefined ? Number(num) : Number(num) / Number(den);
}

export function snapWidthFraction(ratio: number): WidthFraction {
  let best: WidthFraction = WIDTH_FRACTIONS[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const fraction of WIDTH_FRACTIONS) {
    const distance = Math.abs(fractionValue(fraction) - ratio);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = fraction;
    }
  }
  return best;
}

export function clampColumns(columns: number): number {
  if (!Number.isFinite(columns)) {
    return MIN_COLUMNS;
  }
  return Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, Math.round(columns)));
}

export function clampHeight(height: number, maxHeight: number): number {
  if (!Number.isFinite(height)) {
    return MIN_COMPONENT_HEIGHT;
  }
  return Math.max(MIN_COMPONENT_HEIGHT, Math.min(maxHeight, height));
}

export interface ReferenceImage {
  id: string;
  file: string;
  caption?: string;
}

export interface BaseComponent {
  id: string;
  widthFraction: WidthFraction;
  height: number; // A4 points
}

export interface PlanTextComponent extends BaseComponent {
  type: "plan";
  html: string;
}

export interface ReferenceComponent extends BaseComponent {
  type: "reference";
  title: string;
  description: string;
  columnsPerRow: number;
  showCaptions: boolean;
  images: ReferenceImage[];
}

export type PlanComponent = PlanTextComponent | ReferenceComponent;

export interface ProjectPlan {
  schemaVersion: 2;
  components: PlanComponent[];
}

export const EMPTY_PLAN: ProjectPlan = { schemaVersion: 2, components: [] };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/domain/plan/canvas/models.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the full suite is unaffected, then commit**

Run: `pnpm test` (Expected: all pass — additive change). Then:
```powershell
cd C:\projects\Preshot; git add src/domain/plan/canvas/models.ts src/domain/plan/canvas/models.test.ts
git commit -m "feat(canvas): add v2 component model and pure helpers`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 2: shared A4 geometry

**Files:**
- Create: `src/domain/plan/canvas/geometry.ts`
- Test: `src/domain/plan/canvas/geometry.test.ts`

**Interfaces:**
- Produces: `A4`, `MARGIN`, `GUTTER`, `ROW_GAP`, `PageGeometry`, `DEFAULT_PAGE_GEOMETRY`, `Rect`, `contentSize(geometry)`, `squareSlotGrid(contentWidth, columns, gap)`, `containSize(slotWidth, slotHeight, imageWidth, imageHeight)`.
- Note: this `containSize` is generalized to a rectangular slot (the existing `src/domain/plan/pdf/geometry.ts` one takes a single square `slotSize`; do not modify that file in this phase).

- [ ] **Step 1: Write the failing test**

Create `src/domain/plan/canvas/geometry.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  A4,
  containSize,
  contentSize,
  DEFAULT_PAGE_GEOMETRY,
  MARGIN,
  squareSlotGrid,
} from "./geometry";

describe("canvas geometry", () => {
  it("computes the content size inside the margins", () => {
    expect(contentSize(DEFAULT_PAGE_GEOMETRY)).toEqual({
      width: A4.width - 2 * MARGIN,
      height: A4.height - 2 * MARGIN,
    });
  });

  it("splits a row into equal square slots with gaps", () => {
    const grid = squareSlotGrid(500, 3, 10);
    expect(grid.slotSize).toBeCloseTo((500 - 2 * 10) / 3, 5);
    expect(grid.xOffsets).toHaveLength(3);
    expect(grid.xOffsets[0]).toBe(0);
    expect(grid.xOffsets[1]).toBeCloseTo(grid.slotSize + 10, 5);
  });

  it("contain-fits and centers an image within a rectangular slot", () => {
    // wide slot, square image -> limited by height
    expect(containSize(200, 100, 100, 100)).toEqual({ width: 100, height: 100, offsetX: 50, offsetY: 0 });
    // tall slot, landscape image -> limited by width
    expect(containSize(100, 200, 200, 100)).toEqual({ width: 100, height: 50, offsetX: 0, offsetY: 75 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/domain/plan/canvas/geometry.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the geometry**

Create `src/domain/plan/canvas/geometry.ts`:
```ts
export const A4 = { width: 595.28, height: 841.89 } as const;
export const MARGIN = 48;
export const GUTTER = 12;
export const ROW_GAP = 12;

export interface PageGeometry {
  page: { width: number; height: number };
  margin: number;
  gutter: number;
  rowGap: number;
}

export const DEFAULT_PAGE_GEOMETRY: PageGeometry = {
  page: { width: A4.width, height: A4.height },
  margin: MARGIN,
  gutter: GUTTER,
  rowGap: ROW_GAP,
};

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function contentSize(geometry: PageGeometry): { width: number; height: number } {
  return {
    width: geometry.page.width - 2 * geometry.margin,
    height: geometry.page.height - 2 * geometry.margin,
  };
}

export function squareSlotGrid(
  contentWidth: number,
  columns: number,
  gap: number,
): { slotSize: number; xOffsets: number[] } {
  const safeColumns = Math.max(1, Math.floor(columns));
  const slotSize = (contentWidth - gap * (safeColumns - 1)) / safeColumns;
  const xOffsets = Array.from({ length: safeColumns }, (_unused, i) => i * (slotSize + gap));
  return { slotSize, xOffsets };
}

export function containSize(
  slotWidth: number,
  slotHeight: number,
  imageWidth: number,
  imageHeight: number,
): { width: number; height: number; offsetX: number; offsetY: number } {
  const scale = Math.min(slotWidth / imageWidth, slotHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return { width, height, offsetX: (slotWidth - width) / 2, offsetY: (slotHeight - height) / 2 };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/domain/plan/canvas/geometry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

Run: `pnpm test` (Expected: all pass). Then:
```powershell
cd C:\projects\Preshot; git add src/domain/plan/canvas/geometry.ts src/domain/plan/canvas/geometry.test.ts
git commit -m "feat(canvas): add shared A4 geometry helpers`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 3: layout engine — component placement + pagination

**Files:**
- Create: `src/domain/plan/canvas/engine.ts`
- Test: `src/domain/plan/canvas/engine.test.ts`

**Interfaces:**
- Consumes: `PlanComponent`, `fractionValue`, `clampHeight` (Task 1); `PageGeometry`, `DEFAULT_PAGE_GEOMETRY`, `Rect`, `contentSize` (Task 2).
- Produces: `Placement { componentId, pageIndex, rect, imageSlots? }`, `LayoutResult { pageCount, placements }`, `layoutPlan(components, geometry?)`. (This task leaves `imageSlots` undefined; Task 4 populates it.)

- [ ] **Step 1: Write the failing test**

Create `src/domain/plan/canvas/engine.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { contentSize, DEFAULT_PAGE_GEOMETRY } from "./geometry";
import { layoutPlan } from "./engine";
import type { PlanComponent, WidthFraction } from "./models";

const content = contentSize(DEFAULT_PAGE_GEOMETRY);

function plan(id: string, widthFraction: WidthFraction, height: number): PlanComponent {
  return { id, type: "plan", widthFraction, height, html: "" };
}

describe("layoutPlan placement", () => {
  it("places a single full-width component at the origin of page 0", () => {
    const { pageCount, placements } = layoutPlan([plan("a", "1", 100)]);
    expect(pageCount).toBe(1);
    expect(placements).toHaveLength(1);
    expect(placements[0]).toMatchObject({ componentId: "a", pageIndex: 0 });
    expect(placements[0].rect).toEqual({ x: 0, y: 0, width: content.width, height: 100 });
  });

  it("flows two half-width components side by side on one row", () => {
    const { placements } = layoutPlan([plan("a", "1/2", 100), plan("b", "1/2", 120)]);
    expect(placements[0].rect).toMatchObject({ x: 0, y: 0, width: content.width / 2 });
    expect(placements[1].rect).toMatchObject({ x: content.width / 2, y: 0, width: content.width / 2 });
  });

  it("wraps to the next row when the next component does not fit the row", () => {
    const third = content.width / 3;
    const [a, b, c] = layoutPlan([
      plan("a", "2/3", 100),
      plan("b", "1/2", 100),
      plan("c", "1/3", 100),
    ]).placements;
    expect(a.rect).toMatchObject({ x: 0, y: 0 });
    // b (1/2) does not fit next to a (2/3): 2/3 + 1/2 > 1 -> new row
    expect(b.rect.x).toBe(0);
    expect(b.rect.y).toBeCloseTo(100 + DEFAULT_PAGE_GEOMETRY.rowGap, 5);
    // c (1/3) fits next to b (1/2) on the same row
    expect(c.rect.y).toBeCloseTo(b.rect.y, 5);
    expect(c.rect.x).toBeCloseTo(content.width / 2, 5);
    expect(third).toBeGreaterThan(0);
  });

  it("moves a component wholly to the next page when the page is full", () => {
    const tall = content.height - 20; // nearly a full page
    const { pageCount, placements } = layoutPlan([plan("a", "1", tall), plan("b", "1", 100)]);
    expect(pageCount).toBe(2);
    expect(placements[0]).toMatchObject({ pageIndex: 0 });
    expect(placements[1]).toMatchObject({ pageIndex: 1 });
    expect(placements[1].rect).toEqual({ x: 0, y: 0, width: content.width, height: 100 });
  });

  it("clamps a component taller than a page to the page content height", () => {
    const { pageCount, placements } = layoutPlan([plan("a", "1", content.height + 500)]);
    expect(pageCount).toBe(1);
    expect(placements[0].rect.height).toBeCloseTo(content.height, 5);
  });

  it("returns one empty page for no components", () => {
    expect(layoutPlan([])).toEqual({ pageCount: 1, placements: [] });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/domain/plan/canvas/engine.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the placement engine**

Create `src/domain/plan/canvas/engine.ts`:
```ts
import { contentSize, DEFAULT_PAGE_GEOMETRY, type PageGeometry, type Rect } from "./geometry";
import { clampHeight, fractionValue, type PlanComponent } from "./models";

const EPS = 0.01;

export interface Placement {
  componentId: string;
  pageIndex: number;
  rect: Rect; // page-content-relative points (origin at the page's top-left margin)
  imageSlots?: Rect[];
}

export interface LayoutResult {
  pageCount: number;
  placements: Placement[];
}

export function layoutPlan(
  components: PlanComponent[],
  geometry: PageGeometry = DEFAULT_PAGE_GEOMETRY,
): LayoutResult {
  const content = contentSize(geometry);
  const placements: Placement[] = [];

  let pageIndex = 0;
  let x = 0;
  let y = 0;
  let rowHeight = 0;

  for (const component of components) {
    const width = fractionValue(component.widthFraction) * content.width;
    const height = clampHeight(component.height, content.height);

    // Wrap to a new row when the component does not fit the remaining row width.
    if (x + width > content.width + EPS) {
      x = 0;
      y += rowHeight + geometry.rowGap;
      rowHeight = 0;
    }

    // Move to a new page when the component does not fit the remaining page height.
    if (y + height > content.height + EPS) {
      pageIndex += 1;
      x = 0;
      y = 0;
      rowHeight = 0;
    }

    placements.push({ componentId: component.id, pageIndex, rect: { x, y, width, height } });

    x += width;
    rowHeight = Math.max(rowHeight, height);
  }

  return { pageCount: pageIndex + 1, placements };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/domain/plan/canvas/engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

Run: `pnpm test` (Expected: all pass). Then:
```powershell
cd C:\projects\Preshot; git add src/domain/plan/canvas/engine.ts src/domain/plan/canvas/engine.test.ts
git commit -m "feat(canvas): add flow + pagination layout engine`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 4: layout engine — reference image slots + caption split

**Files:**
- Modify: `src/domain/plan/canvas/engine.ts`
- Test: `src/domain/plan/canvas/engine.test.ts` (add a describe block)

**Interfaces:**
- Consumes: `ReferenceComponent` (Task 1); `squareSlotGrid`, `Rect`, `GUTTER` (Task 2).
- Produces: `TITLE_BAND`, `DESCRIPTION_BAND`, `referenceImageSlots(rect, component, geometry?)`, `slotCaptionSplit(slot, showCaptions)`; and `layoutPlan` now populates `placements[].imageSlots` for `type:"reference"` components.
- `referenceImageSlots` returns tile rects **relative to the component's `rect`** (i.e. `{x,y}` are offsets within the component). Image tiles are square (side = slot size); when `showCaptions`, each tile's height is `slotSize + captionBand` (captionBand = round(slotSize/3)). Slots are row-major for ALL images (callers clip to the rect).

- [ ] **Step 1: Write the failing test (append)**

Append to `src/domain/plan/canvas/engine.test.ts`:
```ts
import { referenceImageSlots, slotCaptionSplit, TITLE_BAND } from "./engine";
import type { ReferenceComponent } from "./models";

function reference(overrides: Partial<ReferenceComponent> = {}): ReferenceComponent {
  return {
    id: "r",
    type: "reference",
    widthFraction: "1",
    height: 300,
    title: "T",
    description: "",
    columnsPerRow: 3,
    showCaptions: false,
    images: [
      { id: "i1", file: "references/0001.png" },
      { id: "i2", file: "references/0002.png" },
      { id: "i3", file: "references/0003.png" },
      { id: "i4", file: "references/0004.png" },
    ],
    ...overrides,
  };
}

describe("reference image slots", () => {
  it("lays out square slots row-major below the title band", () => {
    const rect = { x: 0, y: 0, width: 300, height: 300 };
    const slots = referenceImageSlots(rect, reference());
    expect(slots).toHaveLength(4);
    // three columns on the first row, all at the same y (>= title band)
    expect(slots[0].y).toBeGreaterThanOrEqual(TITLE_BAND);
    expect(slots[0].y).toBe(slots[1].y);
    expect(slots[1].x).toBeGreaterThan(slots[0].x);
    expect(slots[0].width).toBeCloseTo(slots[0].height, 5); // square when captions off
    // fourth image wraps to the next row
    expect(slots[3].x).toBe(slots[0].x);
    expect(slots[3].y).toBeGreaterThan(slots[0].y);
  });

  it("adds a caption band to each tile when captions are on", () => {
    const rect = { x: 0, y: 0, width: 300, height: 400 };
    const slots = referenceImageSlots(rect, reference({ showCaptions: true }));
    const { image, caption } = slotCaptionSplit(slots[0], true);
    expect(caption.height).toBeCloseTo(slots[0].height - image.height, 5);
    expect(caption.height).toBeGreaterThan(0);
    expect(image.width).toBe(slots[0].width);
    expect(caption.y).toBeCloseTo(image.y + image.height, 5);
  });

  it("returns the whole slot as the image when captions are off", () => {
    const slot = { x: 1, y: 2, width: 10, height: 10 };
    expect(slotCaptionSplit(slot, false)).toEqual({ image: slot, caption: { x: 1, y: 12, width: 10, height: 0 } });
  });

  it("populates imageSlots on reference placements via layoutPlan", () => {
    const result = layoutPlan([reference()]);
    expect(result.placements[0].imageSlots).toBeDefined();
    expect(result.placements[0].imageSlots).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/domain/plan/canvas/engine.test.ts`
Expected: FAIL (`referenceImageSlots`/`slotCaptionSplit`/`TITLE_BAND` undefined; `imageSlots` undefined).

- [ ] **Step 3: Implement slots + caption split and wire into layoutPlan**

Edit `src/domain/plan/canvas/engine.ts` — add the imports, constants, and functions, and populate `imageSlots` in `layoutPlan`:
```ts
import { contentSize, DEFAULT_PAGE_GEOMETRY, squareSlotGrid, type PageGeometry, type Rect } from "./geometry";
import { clampHeight, fractionValue, type PlanComponent, type ReferenceComponent } from "./models";

export const TITLE_BAND = 24; // points reserved for the reference title
export const DESCRIPTION_BAND = 40; // points reserved when a description is present

export function slotCaptionSplit(
  slot: Rect,
  showCaptions: boolean,
): { image: Rect; caption: Rect } {
  if (!showCaptions) {
    return { image: slot, caption: { x: slot.x, y: slot.y + slot.height, width: slot.width, height: 0 } };
  }
  const captionHeight = Math.round(slot.height / 4); // tile = image + caption; caption ~1/3 of image
  const imageHeight = slot.height - captionHeight;
  return {
    image: { x: slot.x, y: slot.y, width: slot.width, height: imageHeight },
    caption: { x: slot.x, y: slot.y + imageHeight, width: slot.width, height: captionHeight },
  };
}

export function referenceImageSlots(
  rect: Rect,
  component: ReferenceComponent,
  geometry: PageGeometry = DEFAULT_PAGE_GEOMETRY,
): Rect[] {
  const top = TITLE_BAND + (component.description.trim() ? DESCRIPTION_BAND : 0);
  const innerWidth = rect.width;
  const { slotSize, xOffsets } = squareSlotGrid(innerWidth, component.columnsPerRow, geometry.gutter);
  // When captions are on the tile is 4/3 the slot so the image portion (tile minus
  // the round(height/4) caption band used by slotCaptionSplit) stays ~square.
  const tileHeight = component.showCaptions ? Math.round((slotSize * 4) / 3) : slotSize;
  return component.images.map((_image, index) => {
    const column = index % xOffsets.length;
    const row = Math.floor(index / xOffsets.length);
    return {
      x: rect.x + xOffsets[column],
      y: rect.y + top + row * (tileHeight + geometry.rowGap),
      width: slotSize,
      height: tileHeight,
    };
  });
}
```
In `layoutPlan`, after pushing the base placement, attach slots for reference components. Replace the `placements.push(...)` line with:
```ts
    const placement: Placement = {
      componentId: component.id,
      pageIndex,
      rect: { x, y, width, height },
    };
    if (component.type === "reference") {
      // slots are relative to the component rect's own origin (0,0-based within the component)
      placement.imageSlots = referenceImageSlots({ x: 0, y: 0, width, height }, component, geometry);
    }
    placements.push(placement);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/domain/plan/canvas/engine.test.ts`
Expected: PASS (all placement + slot tests).

- [ ] **Step 5: Commit**

Run: `pnpm test` (Expected: all pass). Then:
```powershell
cd C:\projects\Preshot; git add src/domain/plan/canvas/engine.ts src/domain/plan/canvas/engine.test.ts
git commit -m "feat(canvas): compute reference image slots and caption bands`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 5: component reducers

**Files:**
- Create: `src/domain/plan/canvas/plan.ts`
- Test: `src/domain/plan/canvas/plan.test.ts`

**Interfaces:**
- Consumes: model types + `clampColumns`, `clampHeight`, `snapWidthFraction` (Task 1); `contentSize`, `DEFAULT_PAGE_GEOMETRY` (Task 2, for the height clamp bound).
- Produces (all `(plan, ...) => ProjectPlan`, pure, no-op returns same ref): `addComponent`, `removeComponent`, `moveComponent({id,toIndex})`, `resizeComponent({id,widthFraction?,height?})`, `updatePlanHtml({id,html})`, `setReferenceTitle`, `setReferenceDescription`, `setReferenceColumns`, `toggleReferenceCaptions`, `addReferenceImage({componentId,image})`, `removeReferenceImage({componentId,imageId})`, `setImageCaption({componentId,imageId,caption})`, `moveImage({fromComponentId,imageId,toComponentId,toIndex})`. Plus `MoveImageParams` type.

- [ ] **Step 1: Write the failing test**

Create `src/domain/plan/canvas/plan.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { contentSize, DEFAULT_PAGE_GEOMETRY } from "./geometry";
import {
  addComponent,
  addReferenceImage,
  moveComponent,
  moveImage,
  removeComponent,
  resizeComponent,
  setImageCaption,
  toggleReferenceCaptions,
  updatePlanHtml,
} from "./plan";
import {
  EMPTY_PLAN,
  MIN_COMPONENT_HEIGHT,
  type PlanComponent,
  type ProjectPlan,
  type ReferenceComponent,
} from "./models";

const maxHeight = contentSize(DEFAULT_PAGE_GEOMETRY).height;

function planText(id: string): PlanComponent {
  return { id, type: "plan", widthFraction: "1", height: 200, html: `<p>${id}</p>` };
}
function reference(id: string, images: string[] = []): ReferenceComponent {
  return {
    id,
    type: "reference",
    widthFraction: "1",
    height: 300,
    title: id,
    description: "",
    columnsPerRow: 3,
    showCaptions: false,
    images: images.map((imageId) => ({ id: imageId, file: `references/${imageId}.png` })),
  };
}
function withComponents(components: PlanComponent[]): ProjectPlan {
  return { schemaVersion: 2, components };
}

describe("canvas reducers", () => {
  it("appends a component", () => {
    expect(addComponent(EMPTY_PLAN, planText("a")).components).toHaveLength(1);
  });

  it("removes a component by id and no-ops on unknown id", () => {
    const plan = withComponents([planText("a"), planText("b")]);
    expect(removeComponent(plan, "a").components.map((c) => c.id)).toEqual(["b"]);
    expect(removeComponent(plan, "zz")).toBe(plan);
  });

  it("reorders a component to a new index (post-removal index)", () => {
    const plan = withComponents([planText("a"), planText("b"), planText("c")]);
    // remove a -> [b,c]; insert a at index 2 -> [b,c,a]
    expect(moveComponent(plan, { id: "a", toIndex: 2 }).components.map((c) => c.id)).toEqual(["b", "c", "a"]);
  });

  it("no-ops moveComponent when the position is unchanged", () => {
    const plan = withComponents([planText("a"), planText("b")]);
    expect(moveComponent(plan, { id: "a", toIndex: 0 })).toBe(plan);
  });

  it("snaps width and clamps height on resize", () => {
    const plan = withComponents([planText("a")]);
    const resized = resizeComponent(plan, { id: "a", widthFraction: "1/2", height: 10 });
    expect(resized.components[0].widthFraction).toBe("1/2");
    expect(resized.components[0].height).toBe(MIN_COMPONENT_HEIGHT);
    expect(resizeComponent(plan, { id: "a", height: maxHeight + 999 }).components[0].height).toBeCloseTo(maxHeight, 5);
  });

  it("updates plan html", () => {
    const plan = withComponents([planText("a")]);
    expect((updatePlanHtml(plan, { id: "a", html: "<p>x</p>" }).components[0] as { html: string }).html).toBe("<p>x</p>");
  });

  it("adds and toggles captions on a reference component", () => {
    const plan = withComponents([reference("r", ["i1"])]);
    const withImage = addReferenceImage(plan, { componentId: "r", image: { id: "i2", file: "references/i2.png" } });
    expect((withImage.components[0] as ReferenceComponent).images).toHaveLength(2);
    expect((toggleReferenceCaptions(plan, "r").components[0] as ReferenceComponent).showCaptions).toBe(true);
  });

  it("sets a per-image caption", () => {
    const plan = withComponents([reference("r", ["i1"])]);
    const next = setImageCaption(plan, { componentId: "r", imageId: "i1", caption: "sunset" });
    expect((next.components[0] as ReferenceComponent).images[0].caption).toBe("sunset");
  });

  it("moves an image across reference components", () => {
    const plan = withComponents([reference("r1", ["i1", "i2"]), reference("r2", [])]);
    const next = moveImage(plan, { fromComponentId: "r1", imageId: "i1", toComponentId: "r2", toIndex: 0 });
    expect((next.components[0] as ReferenceComponent).images.map((i) => i.id)).toEqual(["i2"]);
    expect((next.components[1] as ReferenceComponent).images.map((i) => i.id)).toEqual(["i1"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/domain/plan/canvas/plan.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the reducers**

Create `src/domain/plan/canvas/plan.ts`:
```ts
import { contentSize, DEFAULT_PAGE_GEOMETRY } from "./geometry";
import {
  clampColumns,
  clampHeight,
  snapWidthFraction,
  type PlanComponent,
  type ProjectPlan,
  type ReferenceComponent,
  type ReferenceImage,
  type WidthFraction,
} from "./models";

export interface MoveImageParams {
  fromComponentId: string;
  imageId: string;
  toComponentId: string;
  toIndex: number;
}

const MAX_HEIGHT = contentSize(DEFAULT_PAGE_GEOMETRY).height;

function replace(plan: ProjectPlan, components: PlanComponent[]): ProjectPlan {
  return { ...plan, components };
}

function mapComponent(
  plan: ProjectPlan,
  id: string,
  transform: (component: PlanComponent) => PlanComponent,
): ProjectPlan {
  let changed = false;
  const components = plan.components.map((component) => {
    if (component.id !== id) {
      return component;
    }
    const next = transform(component);
    if (next !== component) {
      changed = true;
    }
    return next;
  });
  return changed ? replace(plan, components) : plan;
}

function mapReference(
  plan: ProjectPlan,
  id: string,
  transform: (component: ReferenceComponent) => ReferenceComponent,
): ProjectPlan {
  return mapComponent(plan, id, (component) =>
    component.type === "reference" ? transform(component) : component,
  );
}

export function addComponent(plan: ProjectPlan, component: PlanComponent): ProjectPlan {
  return replace(plan, [...plan.components, component]);
}

export function removeComponent(plan: ProjectPlan, id: string): ProjectPlan {
  const components = plan.components.filter((component) => component.id !== id);
  return components.length === plan.components.length ? plan : replace(plan, components);
}

export function moveComponent(plan: ProjectPlan, params: { id: string; toIndex: number }): ProjectPlan {
  const current = plan.components.findIndex((component) => component.id === params.id);
  if (current === -1) {
    return plan;
  }
  const without = plan.components.filter((component) => component.id !== params.id);
  const index = Math.max(0, Math.min(params.toIndex, without.length));
  const next = [...without.slice(0, index), plan.components[current], ...without.slice(index)];
  const unchanged = next.every((component, position) => component.id === plan.components[position].id);
  return unchanged ? plan : replace(plan, next);
}

export function resizeComponent(
  plan: ProjectPlan,
  params: { id: string; widthFraction?: WidthFraction; height?: number },
): ProjectPlan {
  return mapComponent(plan, params.id, (component) => {
    const widthFraction = params.widthFraction ?? component.widthFraction;
    const height = params.height === undefined ? component.height : clampHeight(params.height, MAX_HEIGHT);
    if (widthFraction === component.widthFraction && height === component.height) {
      return component;
    }
    return { ...component, widthFraction, height };
  });
}

export function updatePlanHtml(plan: ProjectPlan, params: { id: string; html: string }): ProjectPlan {
  return mapComponent(plan, params.id, (component) =>
    component.type === "plan" && component.html !== params.html
      ? { ...component, html: params.html }
      : component,
  );
}

export function setReferenceTitle(plan: ProjectPlan, id: string, title: string): ProjectPlan {
  return mapReference(plan, id, (component) =>
    component.title === title ? component : { ...component, title },
  );
}

export function setReferenceDescription(plan: ProjectPlan, id: string, description: string): ProjectPlan {
  return mapReference(plan, id, (component) =>
    component.description === description ? component : { ...component, description },
  );
}

export function setReferenceColumns(plan: ProjectPlan, id: string, columns: number): ProjectPlan {
  const clamped = clampColumns(columns);
  return mapReference(plan, id, (component) =>
    component.columnsPerRow === clamped ? component : { ...component, columnsPerRow: clamped },
  );
}

export function toggleReferenceCaptions(plan: ProjectPlan, id: string): ProjectPlan {
  return mapReference(plan, id, (component) => ({ ...component, showCaptions: !component.showCaptions }));
}

export function addReferenceImage(
  plan: ProjectPlan,
  params: { componentId: string; image: ReferenceImage },
): ProjectPlan {
  return mapReference(plan, params.componentId, (component) => ({
    ...component,
    images: [...component.images, params.image],
  }));
}

export function removeReferenceImage(
  plan: ProjectPlan,
  params: { componentId: string; imageId: string },
): ProjectPlan {
  return mapReference(plan, params.componentId, (component) => {
    const images = component.images.filter((image) => image.id !== params.imageId);
    return images.length === component.images.length ? component : { ...component, images };
  });
}

export function setImageCaption(
  plan: ProjectPlan,
  params: { componentId: string; imageId: string; caption: string },
): ProjectPlan {
  return mapReference(plan, params.componentId, (component) => ({
    ...component,
    images: component.images.map((image) =>
      image.id === params.imageId ? { ...image, caption: params.caption } : image,
    ),
  }));
}

export function moveImage(plan: ProjectPlan, params: MoveImageParams): ProjectPlan {
  const { fromComponentId, imageId, toComponentId, toIndex } = params;
  const source = plan.components.find(
    (component): component is ReferenceComponent =>
      component.type === "reference" && component.id === fromComponentId,
  );
  const target = plan.components.find(
    (component): component is ReferenceComponent =>
      component.type === "reference" && component.id === toComponentId,
  );
  if (!source || !target) {
    return plan;
  }
  const image = source.images.find((item) => item.id === imageId);
  if (!image) {
    return plan;
  }
  const sourceImages = source.images.filter((item) => item.id !== imageId);
  const base = fromComponentId === toComponentId ? sourceImages : target.images;
  const index = Math.max(0, Math.min(toIndex, base.length));
  const targetImages = [...base.slice(0, index), image, ...base.slice(index)];

  if (
    fromComponentId === toComponentId &&
    targetImages.length === source.images.length &&
    targetImages.every((item, position) => item.id === source.images[position].id)
  ) {
    return plan;
  }

  return replace(
    plan,
    plan.components.map((component) => {
      if (component.id === toComponentId && component.type === "reference") {
        return { ...component, images: targetImages };
      }
      if (component.id === fromComponentId && component.type === "reference") {
        return { ...component, images: sourceImages };
      }
      return component;
    }),
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/domain/plan/canvas/plan.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

Run: `pnpm test` (Expected: all pass). Then:
```powershell
cd C:\projects\Preshot; git add src/domain/plan/canvas/plan.ts src/domain/plan/canvas/plan.test.ts
git commit -m "feat(canvas): add pure component reducers`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 6: v1 → v2 migration

**Files:**
- Create: `src/domain/plan/canvas/migrate.ts`
- Test: `src/domain/plan/canvas/migrate.test.ts`

**Interfaces:**
- Consumes: model types + constants (`DEFAULT_PLAN_HEIGHT`, `DEFAULT_REFERENCE_HEIGHT`, `DEFAULT_COLUMNS`, `clampColumns`, `EMPTY_PLAN`, `CURRENT_SCHEMA_VERSION`).
- Produces: `migratePlan(raw: unknown): ProjectPlan` — total, never throws.
- Rules: a v2 shape (`schemaVersion === 2` and `components` is an array) is normalized (drop non-object/invalid-type components, default missing fields, clamp columns/height, coerce `widthFraction` via allow-list defaulting to `"1"`). A v1 shape (`photographyPlan` string and/or `referenceGroups` array) converts: non-empty `photographyPlan` → one full-width plan component first; each group → one full-width reference component (preserve title/description/columns/images, `caption` unset, `showCaptions:false`). Anything else → `EMPTY_PLAN`. IDs for generated components come from a provided `makeId` (default: a deterministic counter `plan-<n>` / `ref-<n>`), so callers can inject their own.

- [ ] **Step 1: Write the failing test**

Create `src/domain/plan/canvas/migrate.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { migratePlan } from "./migrate";
import { EMPTY_PLAN, type ReferenceComponent } from "./models";

describe("migratePlan", () => {
  it("passes a valid v2 plan through, normalizing fields", () => {
    const v2 = {
      schemaVersion: 2,
      components: [
        { id: "a", type: "plan", widthFraction: "1/2", height: 150, html: "<p>x</p>" },
        { id: "b", type: "reference", widthFraction: "1", height: 300, title: "T", description: "", columnsPerRow: 9, showCaptions: false, images: [{ id: "i", file: "references/0001.png" }] },
      ],
    };
    const migrated = migratePlan(v2);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.components).toHaveLength(2);
    expect((migrated.components[1] as ReferenceComponent).columnsPerRow).toBe(6); // clamped
  });

  it("drops invalid components in a v2 plan", () => {
    const migrated = migratePlan({
      schemaVersion: 2,
      components: [null, { id: "a", type: "plan", widthFraction: "1", height: 100, html: "" }, { type: "bogus" }],
    });
    expect(migrated.components).toHaveLength(1);
    expect(migrated.components[0].id).toBe("a");
  });

  it("converts a v1 plan (photographyPlan + referenceGroups) to v2 components", () => {
    const v1 = {
      photographyPlan: "<h2>Sunset</h2>",
      referenceGroups: [
        { id: "g1", title: "Lookbook", description: "mood", columnsPerRow: 3, images: [{ id: "i1", file: "references/0001.png" }] },
      ],
    };
    const migrated = migratePlan(v1);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.components[0]).toMatchObject({ type: "plan", widthFraction: "1", html: "<h2>Sunset</h2>" });
    expect(migrated.components[1]).toMatchObject({ type: "reference", title: "Lookbook", columnsPerRow: 3, showCaptions: false });
    expect((migrated.components[1] as ReferenceComponent).images[0].id).toBe("i1");
  });

  it("omits the plan component when the v1 photographyPlan is empty", () => {
    const migrated = migratePlan({ photographyPlan: "", referenceGroups: [] });
    expect(migrated.components).toHaveLength(0);
  });

  it("returns an empty plan for null / malformed input", () => {
    expect(migratePlan(null)).toEqual(EMPTY_PLAN);
    expect(migratePlan(42)).toEqual(EMPTY_PLAN);
    expect(migratePlan({ nonsense: true })).toEqual(EMPTY_PLAN);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/domain/plan/canvas/migrate.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the migration**

Create `src/domain/plan/canvas/migrate.ts`:
```ts
import { contentSize, DEFAULT_PAGE_GEOMETRY } from "./geometry";
import {
  clampColumns,
  clampHeight,
  DEFAULT_COLUMNS,
  DEFAULT_PLAN_HEIGHT,
  DEFAULT_REFERENCE_HEIGHT,
  EMPTY_PLAN,
  WIDTH_FRACTIONS,
  type PlanComponent,
  type ProjectPlan,
  type ReferenceImage,
  type WidthFraction,
} from "./models";

const MAX_HEIGHT = contentSize(DEFAULT_PAGE_GEOMETRY).height;

type IdFactory = (prefix: string) => string;

function defaultIdFactory(): IdFactory {
  let counter = 0;
  return (prefix) => `${prefix}-${(counter += 1)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asWidthFraction(value: unknown): WidthFraction {
  return WIDTH_FRACTIONS.includes(value as WidthFraction) ? (value as WidthFraction) : "1";
}

function asHeight(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? clampHeight(value, MAX_HEIGHT) : fallback;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeImages(value: unknown): ReferenceImage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const images: ReferenceImage[] = [];
  for (const raw of value) {
    if (isRecord(raw) && typeof raw.id === "string" && typeof raw.file === "string") {
      const image: ReferenceImage = { id: raw.id, file: raw.file };
      if (typeof raw.caption === "string") {
        image.caption = raw.caption;
      }
      images.push(image);
    }
  }
  return images;
}

function normalizeComponent(raw: unknown, makeId: IdFactory): PlanComponent | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = typeof raw.id === "string" && raw.id ? raw.id : makeId("cmp");
  if (raw.type === "plan") {
    return {
      id,
      type: "plan",
      widthFraction: asWidthFraction(raw.widthFraction),
      height: asHeight(raw.height, DEFAULT_PLAN_HEIGHT),
      html: asString(raw.html),
    };
  }
  if (raw.type === "reference") {
    return {
      id,
      type: "reference",
      widthFraction: asWidthFraction(raw.widthFraction),
      height: asHeight(raw.height, DEFAULT_REFERENCE_HEIGHT),
      title: asString(raw.title),
      description: asString(raw.description),
      columnsPerRow: clampColumns(typeof raw.columnsPerRow === "number" ? raw.columnsPerRow : DEFAULT_COLUMNS),
      showCaptions: raw.showCaptions === true,
      images: normalizeImages(raw.images),
    };
  }
  return null;
}

function migrateV1(raw: Record<string, unknown>, makeId: IdFactory): ProjectPlan {
  const components: PlanComponent[] = [];
  const photographyPlan = asString(raw.photographyPlan);
  if (photographyPlan.trim()) {
    components.push({
      id: makeId("plan"),
      type: "plan",
      widthFraction: "1",
      height: DEFAULT_PLAN_HEIGHT,
      html: photographyPlan,
    });
  }
  if (Array.isArray(raw.referenceGroups)) {
    for (const group of raw.referenceGroups) {
      if (!isRecord(group)) {
        continue;
      }
      components.push({
        id: typeof group.id === "string" && group.id ? group.id : makeId("ref"),
        type: "reference",
        widthFraction: "1",
        height: DEFAULT_REFERENCE_HEIGHT,
        title: asString(group.title),
        description: asString(group.description),
        columnsPerRow: clampColumns(typeof group.columnsPerRow === "number" ? group.columnsPerRow : DEFAULT_COLUMNS),
        showCaptions: false,
        images: normalizeImages(group.images),
      });
    }
  }
  return { schemaVersion: 2, components };
}

export function migratePlan(raw: unknown, makeId: IdFactory = defaultIdFactory()): ProjectPlan {
  if (!isRecord(raw)) {
    return EMPTY_PLAN;
  }
  if (raw.schemaVersion === 2 && Array.isArray(raw.components)) {
    const components = raw.components
      .map((component) => normalizeComponent(component, makeId))
      .filter((component): component is PlanComponent => component !== null);
    return { schemaVersion: 2, components };
  }
  if (typeof raw.photographyPlan === "string" || Array.isArray(raw.referenceGroups)) {
    return migrateV1(raw, makeId);
  }
  return EMPTY_PLAN;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/domain/plan/canvas/migrate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

Run: `pnpm test` (Expected: all pass). Then:
```powershell
cd C:\projects\Preshot; git add src/domain/plan/canvas/migrate.ts src/domain/plan/canvas/migrate.test.ts
git commit -m "feat(canvas): add v1 to v2 plan migration`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 7: component drop-target math

**Files:**
- Create: `src/domain/plan/canvas/dropTarget.ts`
- Test: `src/domain/plan/canvas/dropTarget.test.ts`

**Interfaces:**
- Consumes: `PlanComponent` (Task 1).
- Produces: `componentDropTarget(components, activeId, overId, insertAfter): number | null` — the post-removal insertion index for reordering `activeId` relative to `overId`. Mirrors the existing image `computeDropTarget` semantics: `overId === null` or `overId === activeId` → `null`; unknown `activeId`/`overId` → `null`; otherwise the index of `overId` among the components with `activeId` removed, plus `(insertAfter ? 1 : 0)`.

- [ ] **Step 1: Write the failing test**

Create `src/domain/plan/canvas/dropTarget.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { componentDropTarget } from "./dropTarget";
import type { PlanComponent } from "./models";

const components: PlanComponent[] = [
  { id: "a", type: "plan", widthFraction: "1", height: 100, html: "" },
  { id: "b", type: "plan", widthFraction: "1", height: 100, html: "" },
  { id: "c", type: "plan", widthFraction: "1", height: 100, html: "" },
];

describe("componentDropTarget", () => {
  it("returns null for no over, self-hover, or unknown ids", () => {
    expect(componentDropTarget(components, "a", null, false)).toBeNull();
    expect(componentDropTarget(components, "a", "a", false)).toBeNull();
    expect(componentDropTarget(components, "zz", "b", false)).toBeNull();
    expect(componentDropTarget(components, "a", "zz", false)).toBeNull();
  });

  it("computes the post-removal insertion index before/after the over component", () => {
    // remove a -> [b,c]; over c is index 1
    expect(componentDropTarget(components, "a", "c", false)).toBe(1);
    expect(componentDropTarget(components, "a", "c", true)).toBe(2);
    // remove c -> [a,b]; over a is index 0
    expect(componentDropTarget(components, "c", "a", false)).toBe(0);
    expect(componentDropTarget(components, "c", "a", true)).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/domain/plan/canvas/dropTarget.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the drop target**

Create `src/domain/plan/canvas/dropTarget.ts`:
```ts
import type { PlanComponent } from "./models";

export function componentDropTarget(
  components: PlanComponent[],
  activeId: string,
  overId: string | null,
  insertAfter: boolean,
): number | null {
  if (overId === null || overId === activeId) {
    return null;
  }
  if (!components.some((component) => component.id === activeId)) {
    return null;
  }
  const withoutActive = components.filter((component) => component.id !== activeId);
  const overIndex = withoutActive.findIndex((component) => component.id === overId);
  if (overIndex === -1) {
    return null;
  }
  return overIndex + (insertAfter ? 1 : 0);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/domain/plan/canvas/dropTarget.test.ts`
Expected: PASS.

- [ ] **Step 5: Final verification + commit**

Run: `pnpm typecheck` (Expected: clean) and `pnpm test` (Expected: all pass, including every new `canvas/*` test and the untouched existing suite). Then:
```powershell
cd C:\projects\Preshot; git add src/domain/plan/canvas/dropTarget.ts src/domain/plan/canvas/dropTarget.test.ts
git commit -m "feat(canvas): add component drop-target math`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Self-Review Notes

- **Spec coverage (Phase A portion):** v2 model incl. `caption`/`showCaptions` (Task 1) ✓; shared A4 geometry (Task 2) ✓; pure layout engine with flow/wrap/pagination/clamp (Task 3) + reference image slots + caption bands (Task 4) ✓; pure reducers incl. resize/move/reference sub-ops/`setImageCaption`/`moveImage` (Task 5) ✓; total v1→v2 migration (Task 6) ✓; component reorder drop-target (Task 7) ✓. Deferred to Phase B/C (not this plan): provider/canvas UI, insert menu, component DnD/resize interactions, reference component view + image-level DnD wiring, Rust opaque-JSON decoupling, infrastructure adapters, WYSIWYG PDF, default plan template, caption UI, e2e, featurelist.
- **Purity/additivity:** every file is new under `src/domain/plan/canvas/`; no existing file is modified, so the current app and its 208 tests stay green.
- **Type consistency:** `ProjectPlan`/`PlanComponent`/`ReferenceComponent`/`ReferenceImage`/`WidthFraction`/`MoveImageParams` names and signatures are identical across Tasks 1–7; `layoutPlan`, `referenceImageSlots`, `slotCaptionSplit`, `componentDropTarget`, and the reducer names match their consuming tests.
- **Heights/geometry:** points throughout; `MAX_HEIGHT` in `plan.ts` and `migrate.ts` is the A4 content height, both derived from `contentSize(DEFAULT_PAGE_GEOMETRY)` (`841.89 - 2*48 = 745.89`).

## Next Phases (separate plans, after Phase A ships)

- **Phase B — Wiring & WYSIWYG PDF:** promote `canvas/*` into the active model; Rust `plan` → opaque `serde_json::Value`; infra adapters call `migratePlan`; rewrite `ProjectPlanProvider` to components + optimistic preview + auto-save; `PlanCanvas` (A4 page stack from the engine, scaled); `InsertComponentMenu`; `ComponentFrame` (top-bar move + fractional/height resize) reusing the image drop-preview pattern; reference component view reusing the existing image grid + image-level DnD; WYSIWYG PDF export consuming `layoutPlan`; e2e; featurelist. Remove the old model/reducers/PDF section builder.
- **Phase C — Content features:** per-image caption editing UI + toggle; the photography-plan default template (i18n content key) seeded on insert; captions rendered in the PDF caption bands; e2e + featurelist.
