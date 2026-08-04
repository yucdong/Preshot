# Canvas / Component UX Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the A4 canvas a real layout tool — continuous-width components moved by their whole top bar and resized by dragging edges, unified tight spacing, reference images at natural aspect ratio with an adjustable height, batch image insert, confirmed deletes, populated new projects, and PDF-export-reveals-folder.

**Architecture:** Evolve the existing pure canvas domain (`src/domain/plan/canvas/`) from `schemaVersion 2` to `3`. The pure `layoutPlan` engine stays the single source of layout truth consumed by both the screen renderer and the PDF exporter (WYSIWYG preserved). New model fields land **additively** (optional) so the app stays green each task; a final cleanup task makes them required, removes the old fields, and bumps the schema version with a pure `migratePlan` v2→v3.

**Tech Stack:** React 19 + TypeScript, Tauri 2 (Rust), pnpm, Vitest (jsdom), Playwright e2e, dnd-kit, pdf-lib + @pdf-lib/fontkit, Tailwind, react-i18next (zh).

## Global Constraints

- Ordered-flow layout only (no free-form absolute positioning); position is derived and reflows on resize/reorder.
- All new UI strings are Chinese i18n keys in `src/shared/i18n/locales/zh.ts`, read via `useTranslation`. No hardcoded UI text.
- Pure metadata mutations use the client-side pattern: a reducer in `src/domain/plan/canvas/plan.ts` + `applyPlan` in `ProjectCanvasProvider` (5s auto-save). Only file-side-effect ops (image import/remove, component remove) go through `CanvasPlanService`.
- The screen renderer and the PDF exporter BOTH consume `layoutPlan(components, DEFAULT_PAGE_GEOMETRY)` output — never diverge the layout math.
- `SPACING = 24` (points) is the single spacing unit: page margin == inter-component horizontal gap == vertical row gap.
- Reference image display: per-component `imageHeight` (default `180`, clamp `[80, 400]`); each image renders at that height with its natural `aspectRatio` (`width/height`, `> 0`), row-packed left→right, wrapping when the row exceeds the content width; a single image wider than the content width scales down to fit.
- Continuous component `width`: fraction of content width in `(0, 1]`, default `1`, min `0.15`.
- `migratePlan` is pure, total, never throws; unknown/forward (`schemaVersion > 3`) → `EMPTY_PLAN`.
- jsdom cannot drive dnd-kit pointer drags; drop/resize math is unit-tested and real drags are Playwright e2e. Co-locate Vitest as `*.test.ts(x)`.
- Every task keeps the whole suite green (`pnpm typecheck`, `pnpm lint`, `pnpm test`) and lists its validation. Commit trailer:
  `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

## File Structure

- `src/domain/plan/canvas/geometry.ts` — `SPACING`, `DEFAULT_PAGE_GEOMETRY`, pure `packAspectRow` (add); `squareSlotGrid` (remove in cleanup).
- `src/domain/plan/canvas/models.ts` — v3 fields/constants (`width`, `imageHeight`, `aspectRatio`, clamps); remove `widthFraction`/`columnsPerRow`/fraction helpers in cleanup.
- `src/domain/plan/canvas/engine.ts` — continuous-width flow packing; aspect-ratio `referenceImageSlots`.
- `src/domain/plan/canvas/plan.ts` — `resizeComponent(width)`, `setImageHeight`, `addComponent` prepend, `addReferenceImages`, `setImageAspectRatio`; remove `setReferenceColumns` in cleanup.
- `src/domain/plan/canvas/migrate.ts` — v2→v3 (cleanup task).
- `src/domain/plan/ports.ts` — `PlanImagePicker.pickImageFiles`.
- `src/domain/plan/canvas/service.ts` + `ports.ts` — `importImages`; `PdfRevealTarget`.
- `src/infrastructure/plan/planDialog.ts`, `tauriPlan.ts`, `browserPlan.ts` — multi-picker + seeds.
- `src/infrastructure/pdf/` + `src-tauri/src/` — `reveal_path` command + adapter + capability.
- `src/features/plan/canvas/{ComponentFrame,ReferenceComponentView,PlanCanvas}.tsx`, `src/features/plan/{GroupImageGrid,SortableImageTile}.tsx`, `src/features/plan/ProjectCanvasProvider.tsx`, new `src/shared/ui/ConfirmDialog.tsx`.
- `src/infrastructure/pdf/canvasPdfExporter.ts` — consumes new slots.
- `e2e/canvas.spec.ts`, `docs/design_docs/featurelist.json`.

---

### Task 1: Geometry primitives — `SPACING` + `packAspectRow`

**Files:**
- Modify: `src/domain/plan/canvas/geometry.ts`
- Test: `src/domain/plan/canvas/geometry.test.ts`

**Interfaces:**
- Produces: `export const SPACING = 24;` and
  `export function packAspectRow(items: { aspectRatio: number }[], height: number, maxWidth: number, gap: number): { rects: Rect[]; totalHeight: number }`.

Additive only — keep `MARGIN`, `GUTTER`, `ROW_GAP`, `squareSlotGrid` untouched this task.

- [ ] **Step 1: Write failing tests** in `geometry.test.ts`:

```ts
import { packAspectRow, SPACING } from "./geometry";

it("packs a single row when items fit", () => {
  // two 2:1 items at height 100 => width 200 each; gap 10; maxWidth 500 => fit one row
  const { rects, totalHeight } = packAspectRow(
    [{ aspectRatio: 2 }, { aspectRatio: 2 }], 100, 500, 10);
  expect(rects.map((r) => Math.round(r.width))).toEqual([200, 200]);
  expect(rects[0]).toMatchObject({ x: 0, y: 0, height: 100 });
  expect(Math.round(rects[1].x)).toBe(210); // 200 + gap
  expect(rects[1].y).toBe(0);
  expect(totalHeight).toBe(100);
});

it("wraps to the next row when the next item overflows", () => {
  const { rects, totalHeight } = packAspectRow(
    [{ aspectRatio: 2 }, { aspectRatio: 2 }, { aspectRatio: 2 }], 100, 500, 10);
  expect(rects[2].x).toBe(0);          // wrapped
  expect(rects[2].y).toBe(110);        // height + gap
  expect(totalHeight).toBe(210);
});

it("scales an oversized single item down to maxWidth (height drops for that item)", () => {
  const { rects } = packAspectRow([{ aspectRatio: 5 }], 100, 300, 10);
  expect(Math.round(rects[0].width)).toBe(300);
  expect(Math.round(rects[0].height)).toBe(60); // 300 / 5
});

it("SPACING is 24", () => { expect(SPACING).toBe(24); });
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/domain/plan/canvas/geometry.test.ts` → FAIL (packAspectRow/SPACING not exported).
- [ ] **Step 3: Implement** in `geometry.ts`:

```ts
export const SPACING = 24;

export function packAspectRow(
  items: { aspectRatio: number }[],
  height: number,
  maxWidth: number,
  gap: number,
): { rects: Rect[]; totalHeight: number } {
  const rects: Rect[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const item of items) {
    const ratio = item.aspectRatio > 0 ? item.aspectRatio : 1;
    let w = height * ratio;
    let h = height;
    if (w > maxWidth) { w = maxWidth; h = maxWidth / ratio; } // oversized single item
    if (x > 0 && x + w > maxWidth + 0.01) { x = 0; y += rowHeight + gap; rowHeight = 0; }
    rects.push({ x, y, width: w, height: h });
    x += w + gap;
    rowHeight = Math.max(rowHeight, h);
  }
  return { rects, totalHeight: y + rowHeight };
}
```

- [ ] **Step 4: Run to verify pass** — same command → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(canvas): add SPACING and the pure packAspectRow helper"`.

---

### Task 2: Continuous component width (additive)

**Files:**
- Modify: `src/domain/plan/canvas/models.ts`, `src/domain/plan/canvas/engine.ts`, `src/domain/plan/canvas/plan.ts`, `src/features/plan/canvas/ComponentFrame.tsx`, `src/features/plan/canvas/PlanCanvas.tsx`, `src/features/plan/ProjectCanvasProvider.tsx`
- Test: `engine.test.ts`, `plan.test.ts`

**Interfaces:**
- Produces: `BaseComponent.width?: number` (optional this task); `DEFAULT_WIDTH = 1`, `MIN_WIDTH = 0.15`, `clampWidth(w): number`; `resizeComponent(plan, { id, width?, height? })`; engine flow uses `effectiveWidth(c) = c.width ?? fractionValue(c.widthFraction)`.
- Consumes: existing `widthFraction`, `fractionValue`.

- [ ] **Step 1: Write failing tests** in `plan.test.ts` (resize sets continuous width, clamped) and `engine.test.ts` (a component with `width: 0.5` lays out at half content width; two 0.4-width components share a row; two 0.6-width wrap):

```ts
// plan.test.ts
it("resizes to a continuous width, clamped to MIN_WIDTH", () => {
  const plan = { schemaVersion: 2, components: [{ id: "a", type: "plan", widthFraction: "1", height: 100, html: "" }] } as any;
  expect(resizeComponent(plan, { id: "a", width: 0.5 }).components[0].width).toBe(0.5);
  expect(resizeComponent(plan, { id: "a", width: 0.01 }).components[0].width).toBe(MIN_WIDTH);
});
// engine.test.ts
it("packs two sub-half-width components on one row and wraps wider ones", () => {
  const mk = (id: string, width: number) => ({ id, type: "plan", width, widthFraction: "1", height: 100, html: "" });
  const a = layoutPlan([mk("a", 0.4), mk("b", 0.4)] as any, DEFAULT_PAGE_GEOMETRY);
  expect(a.placements[0].rect.y).toBe(a.placements[1].rect.y); // same row
  const b = layoutPlan([mk("a", 0.6), mk("b", 0.6)] as any, DEFAULT_PAGE_GEOMETRY);
  expect(b.placements[1].rect.y).toBeGreaterThan(b.placements[0].rect.y); // wrapped
});
```

- [ ] **Step 2: Run → FAIL** (`width`/`clampWidth`/`resizeComponent width` absent).
- [ ] **Step 3: Implement:**
  - `models.ts`: add `width?: number` to `BaseComponent`; add `DEFAULT_WIDTH`, `MIN_WIDTH`, `clampWidth = (w) => Math.min(1, Math.max(MIN_WIDTH, w))`. Add a helper `effectiveWidth(c: BaseComponent): number { return c.width ?? fractionValue(c.widthFraction); }` (temporary bridge).
  - `engine.ts` `layoutPlan`: replace `fractionValue(component.widthFraction)` with `effectiveWidth(component)`; keep `gutter`/`rowGap` as-is (spacing task follows).
  - `plan.ts` `resizeComponent`: accept `{ id, width?, height? }`; set `width = clampWidth(params.width ?? current.width ?? effectiveWidth(current))`, `height` via existing clamp; no-op when unchanged (ref stability).
  - `ComponentFrame.tsx`: the width resize handle now emits a continuous width. Compute `nextWidth = clampWidth((displayWidthPx + dxPx) / (contentWidthPoints * scale))` and call `onResize(id, { width: nextWidth })`. Keep the height handle. (Remove the fraction-snap import usage.)
  - `PlanCanvas.tsx` / `ProjectCanvasProvider.tsx`: `handleResize` passes `{ width?, height? }` straight through to `resizeComponent`. `ComponentFrame` receives `widthPx = effectiveWidth(component) * contentWidthPoints * scale`.
- [ ] **Step 4: Run → PASS** (`plan.test.ts`, `engine.test.ts`, plus `pnpm typecheck`).
- [ ] **Step 5: Commit** — `git commit -m "feat(canvas): continuous component width (additive)"`.

---

### Task 3: Unified spacing (`SPACING` = margin = gaps)

**Files:** Modify `src/domain/plan/canvas/geometry.ts`; update `engine.test.ts`, `canvasPdfExporter.test.ts` assertions whose numeric layout values shift.

- [ ] **Step 1: Update `DEFAULT_PAGE_GEOMETRY`** to use `SPACING` for `margin`, `gutter`, `rowGap` (was 48/12/12). Keep `MARGIN`/`GUTTER`/`ROW_GAP` exports for now (removed in cleanup) but stop using them in `DEFAULT_PAGE_GEOMETRY`.
- [ ] **Step 2: Run** `npx vitest run src/domain/plan/canvas src/infrastructure/pdf` → observe which assertions fail on new content width (`595.28 - 48 = 547.28`) and inset math.
- [ ] **Step 3: Fix the affected test expectations** to the new spacing (recompute content width `547.28`, gaps `24`). Do NOT weaken assertions — recompute exact values.
- [ ] **Step 4: Run → PASS**; `pnpm typecheck`, `pnpm lint`.
- [ ] **Step 5: Commit** — `git commit -m "feat(canvas): unify spacing to SPACING (margin == gaps)"`.

---

### Task 4: Image dimension capture + multi-select insert (plumbing, additive)

**Files:**
- Modify: `src/domain/plan/canvas/models.ts` (`ReferenceImage.aspectRatio?`), `src/domain/plan/ports.ts` (`PlanImagePicker.pickImageFiles`), `src/domain/plan/canvas/service.ts` (`importImages`), `src/domain/plan/canvas/plan.ts` (`addReferenceImages`, `setImageAspectRatio`), `src/infrastructure/plan/planDialog.ts`, `src/infrastructure/plan/tauriPlan.ts`/`browserPlan.ts` (raw importImages), `src/features/plan/ProjectCanvasProvider.tsx`
- Test: `plan.test.ts`, `service.test.ts`

**Interfaces:**
- Produces: `ReferenceImage.aspectRatio?: number`; `PlanImagePicker.pickImageFiles(): Promise<string[]>`; `CanvasPlanService.importImages(projectPath, plan, componentId, sourcePaths: string[]): Promise<{ plan; images: {image: ReferenceImage; dataUrl: string}[] }>`; `addReferenceImages(plan, { componentId, images: ReferenceImage[] })`; `setImageAspectRatio(plan, { componentId, imageId, aspectRatio })` (no-op when unchanged, ref-stable).

- [ ] **Step 1: Write failing reducer tests** (`addReferenceImages` appends N images; `setImageAspectRatio` updates one and no-ops when equal) and a `service.test.ts` case that `importImages` calls the raw per-file import for each path and returns all results.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement:**
  - `models.ts`: add `aspectRatio?: number` to `ReferenceImage`.
  - `plan.ts`: `addReferenceImages` (batch append, mapReference), `setImageAspectRatio` (map the one image; return same ref when unchanged).
  - `ports.ts`: add `pickImageFiles(prompt?: string): Promise<string[]>` to `PlanImagePicker` (keep `pickImageFile`).
  - `planDialog.ts`: implement `pickImageFiles` via the Tauri open dialog with `multiple: true` (browser adapter returns a stub list in memory mode).
  - `service.ts`: `importImages` loops the existing raw `importImage` per path, assembling `{image, dataUrl}[]` (ids via `createId`), then `addReferenceImages`, persist once.
  - `tauriPlan.ts`/`browserPlan.ts`: no new raw method needed (reuse per-file import); ensure the browser seed images carry an `aspectRatio` (e.g. 1).
  - `ProjectCanvasProvider.tsx`: after import, for each new image measure the natural size of its data URL (`const img = new Image(); img.src = dataUrl; await decode`) → `aspectRatio = naturalWidth/naturalHeight` (fallback 1 on error) and store via `setImageAspectRatio`. Add an on-load backfill: for every reference image whose `aspectRatio` is undefined, after its src loads, measure and `setImageAspectRatio` (deferred save). Keep the existing single `handleAddImage` working (compose on `importImages` with one path).
- [ ] **Step 4: Run → PASS**; `pnpm typecheck`, `pnpm lint`.
- [ ] **Step 5: Commit** — `git commit -m "feat(canvas): capture image aspect ratio + multi-select import plumbing"`.

---

### Task 5: `imageHeight` + aspect-ratio `referenceImageSlots` (engine, additive)

**Files:**
- Modify: `src/domain/plan/canvas/models.ts` (`ReferenceComponent.imageHeight?`, `DEFAULT_IMAGE_HEIGHT`/`MIN`/`MAX`/`clampImageHeight`), `src/domain/plan/canvas/engine.ts` (`referenceImageSlots`), `src/domain/plan/canvas/plan.ts` (`setImageHeight`)
- Test: `engine.test.ts`, `plan.test.ts`, `canvasPdfExporter.test.ts`

**Interfaces:**
- Produces: `ReferenceComponent.imageHeight?: number`; `DEFAULT_IMAGE_HEIGHT = 180`, `MIN_IMAGE_HEIGHT = 80`, `MAX_IMAGE_HEIGHT = 400`, `clampImageHeight`; `setImageHeight(plan, id, imageHeight)`; `referenceImageSlots` now returns aspect-ratio-packed rects (using `packAspectRow`, `imageHeight ?? DEFAULT_IMAGE_HEIGHT`, `image.aspectRatio ?? 1`).

- [ ] **Step 1: Write failing tests** — engine: a reference component with a landscape (`aspectRatio 2`) and a portrait (`0.5`) image at `imageHeight 100` yields slot widths `~200` and `~50`, row-packed; captions on adds a caption band per image (`round(imageHeight/4)`), rows taller accordingly. plan: `setImageHeight` clamps to `[80,400]`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement:**
  - `models.ts`: add `imageHeight?` + constants + `clampImageHeight`.
  - `engine.ts` `referenceImageSlots`: compute `top = TITLE_BAND + (description ? DESCRIPTION_BAND : 0)`; `innerWidth = rect.width - geometry.gutter` (keep the Phase-D content-box fit); `ih = clampImageHeight(component.imageHeight ?? DEFAULT_IMAGE_HEIGHT)`; when `showCaptions`, run `packAspectRow` at `ih` and append a caption band `round(ih/4)` beneath each image (image rect height `ih`, caption rect below); else pack at `ih`. Offset every rect by `(0, top)`. Return image (and caption) rects relative to the component origin. Remove the `squareSlotGrid`/columns math.
  - `plan.ts`: `setImageHeight` (map component, clamp, ref-stable).
  - `canvasPdfExporter.test.ts`: update the reference-layout assertions to the aspect model.
- [ ] **Step 4: Run → PASS**; `pnpm typecheck`, `pnpm lint`. (Screen still uses the CSS grid until Task 6 — transient divergence is expected and covered next.)
- [ ] **Step 5: Commit** — `git commit -m "feat(canvas): aspect-ratio reference image slots + adjustable imageHeight"`.

---

### Task 6: Reference slot rendering on screen + height stepper + multi-insert UI

**Files:**
- Modify: `src/features/plan/GroupImageGrid.tsx`, `src/features/plan/SortableImageTile.tsx`, `src/features/plan/canvas/ReferenceComponentView.tsx`, `src/features/plan/canvas/PlanCanvas.tsx`, `src/features/plan/ProjectCanvasProvider.tsx`, `src/shared/i18n/locales/zh.ts`
- Test: `GroupImageGrid.test.tsx`, `ReferenceComponentView.test.tsx`

**Interfaces:**
- Consumes: engine `imageSlots` (Task 5), `setImageHeight`/`addReferenceImages` (Tasks 4-5), `pickImageFiles`.
- Produces: `ReferenceComponentView` prop `onSetImageHeight(id, h)`, `onAddImages(id)`; `GroupImageGrid` renders tiles absolutely at the component's `imageSlots`.

- [ ] **Step 1: Write failing component tests** — with a reference component and computed slots, `GroupImageGrid` positions each tile at its slot (assert inline `left/top/width/height` styles); the columns `<select>` is gone; an image-height stepper (`−`/`+`, i18n `reference.imageHeight`) calls `onSetImageHeight`; the add tile calls `onAddImages` (multi).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement:**
  - `GroupImageGrid.tsx`: accept `slots: Rect[]` (from the engine, scaled by `scale`) and position each `SortableImageTile` absolutely (`position:absolute; left/top/width/height` = slot × scale); the container height = packed `totalHeight × scale`; caption textarea renders in the caption band. Keep dnd-kit `SortableContext` + `imageDropTarget` reorder and `draggable={false}` on `<img>`; keep `data-image-id`.
  - `SortableImageTile.tsx`: drop the `aspect-square` fixed shape; fill its slot (`h-full w-full`), image `object-cover`.
  - `ReferenceComponentView.tsx`: remove the columns `<select>`; add the image-height stepper next to the title (`onSetImageHeight(component.id, clampImageHeight(current ± 20))`); compute the component's `imageSlots` from the engine (or receive them from `PlanCanvas`) and pass to `GroupImageGrid`; the `+` add tile calls `onAddImages`.
  - `PlanCanvas.tsx`: thread `onSetImageHeight`, `onAddImages`; pass each reference placement's `imageSlots` down to its `ReferenceComponentView` (the layout already computes them).
  - `ProjectCanvasProvider.tsx`: `handleSetImageHeight` (client-side `setImageHeight` + `applyPlan`); `handleAddImages` (multi-pick → `service.importImages` → measure aspect ratios → `applyPlan`); i18n keys `reference.imageHeight`, `reference.imageHeightAria`.
- [ ] **Step 4: Run → PASS** (touched component tests, `pnpm test`, typecheck, lint). Now screen packing == PDF packing.
- [ ] **Step 5: Commit** — `git commit -m "feat(canvas): render reference images by aspect slots + height stepper + multi-insert"`.

---

### Task 7: Move by top bar + type label + edge resize UX

**Files:** Modify `src/features/plan/canvas/ComponentFrame.tsx`, `src/shared/i18n/locales/zh.ts`; Test `ComponentFrame` rendering (`PlanCanvas.test.tsx` or a new `ComponentFrame.test.tsx`).

- [ ] **Step 1: Write failing test** — the frame renders a low-emphasis type label (i18n `canvas.typePlan` = "摄影计划" / `canvas.typeReference` = "参考图组") in the top bar; the top bar carries the drag listeners (`aria`/role) and `cursor-grab`; L/R/T/B/corner resize strips exist with `data-resize-handle` and resize cursors.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement:** make the ENTIRE top bar the draggable move handle (spread the existing `useDraggable` listeners on the bar, not just a `⋮⋮` icon; `cursor-grab`, hover title `canvas.moveHint` = "拖动以移动或交换位置"); render the type label (small, `text-xs text-stone-400`) via a `type`→i18n map; keep the delete ×; add left and top resize strips (mirroring the existing right/bottom/corner) so all four edges + corner resize; left/top strips adjust width/height from that edge. Keep the continuous-width resize from Task 2.
- [ ] **Step 4: Run → PASS**; typecheck, lint.
- [ ] **Step 5: Commit** — `git commit -m "feat(canvas): move by top bar, type labels, four-edge resize"`.

---

### Task 8: Delete confirmation dialog

**Files:** Create `src/shared/ui/ConfirmDialog.tsx` (+ test); Modify `src/features/plan/canvas/ComponentFrame.tsx`, `src/shared/i18n/locales/zh.ts`.

**Interfaces:** `ConfirmDialog({ open, title, confirmLabel, cancelLabel, onConfirm, onCancel })` — accessible modal (role="dialog", focus the confirm button, Esc = cancel).

- [ ] **Step 1: Write failing tests** — `ConfirmDialog` renders title + buttons when `open`, fires `onConfirm`/`onCancel`; in `ComponentFrame`, clicking × opens the dialog and only calls `onRemove` after confirm.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `ConfirmDialog` (Tailwind modal, i18n labels) and wire `ComponentFrame`'s × to open it (`canvas.deleteConfirmTitle` = "确定删除该组件？", `common.cancel` = "取消", `common.delete` = "删除").
- [ ] **Step 4: Run → PASS**; typecheck, lint.
- [ ] **Step 5: Commit** — `git commit -m "feat(canvas): confirm before deleting a component"`.

---

### Task 9: Insert at top + default components for new projects

**Files:** Modify `src/domain/plan/canvas/plan.ts` (`addComponent` prepend), `src/features/plan/ProjectCanvasProvider.tsx` (seed), `src/infrastructure/plan/browserPlan.ts` (memory seed if empty); Test `plan.test.ts`, provider test.

- [ ] **Step 1: Write failing tests** — `addComponent` inserts at index 0; loading an EMPTY plan seeds exactly `[plan(template), reference(empty)]` with the plan on top.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement:** `addComponent` prepends (`[component, ...plan.components]`); in the provider's load path, when the migrated plan has zero components, `applyPlan` a seeded `[plan, reference]` (plan seeded with `content.planTemplate`, reference with default title/`imageHeight`/`showCaptions:false`/empty images). Ensure `handleInsert` still prepends via the reducer.
- [ ] **Step 4: Run → PASS**; typecheck, lint.
- [ ] **Step 5: Commit** — `git commit -m "feat(canvas): insert components at top; seed new projects"`.

---

### Task 10: PDF export reveals the output folder

**Files:** Create Rust command in `src-tauri/src/` (e.g. `reveal.rs`) + register in `lib.rs` + capability in `src-tauri/capabilities/`; Create `src/infrastructure/pdf/revealPath.ts` (adapter) + `src/domain/plan/canvas/ports.ts` `PdfRevealTarget`; Modify `src/app/plan/planDependencies.ts`, `src/features/plan/ProjectCanvasProvider.tsx`; Test Rust unit + adapter test.

**Interfaces:** Rust `#[tauri::command] fn reveal_path(path: String) -> Result<(), String>` (Windows: `explorer /select,<path>`); `PdfRevealTarget.reveal(path: string): Promise<void>`.

- [ ] **Step 1: Write failing tests** — a Rust unit test that the command builds the expected `explorer` args for a path (extract an arg-builder `fn reveal_args(path) -> Vec<String>` and unit-test it); an adapter test that `revealPath` invokes the `reveal_path` command with the path.
- [ ] **Step 2: Run → FAIL** (`cargo test --manifest-path src-tauri\Cargo.toml`; vitest adapter).
- [ ] **Step 3: Implement** the command (+ arg-builder), register it, add the capability, implement the adapter, add `PdfRevealTarget` to the canvas deps (tauri = real, browser = no-op), and in the provider call `reveal.reveal(defaultPath)` after a successful `saver.save(...)` (non-fatal on error — log + generic banner, never lose the export).
- [ ] **Step 4: Run → PASS** (`cargo test`, vitest, typecheck, lint).
- [ ] **Step 5: Commit** — `git commit -m "feat(canvas): reveal the exported PDF folder after export"`.

---

### Task 11: v3 cleanup — remove legacy fields, require new ones, bump schema + migrate

**Files:** Modify `src/domain/plan/canvas/models.ts`, `geometry.ts`, `migrate.ts`, `plan.ts`, `engine.ts`, and every remaining consumer of the removed symbols; `src/infrastructure/plan/browserPlan.ts` (v3 seed). Test `migrate.test.ts` + fix any stragglers.

**Interfaces:** Final v3 model — `ProjectPlan.schemaVersion: 3`; `BaseComponent.width: number` (required); `ReferenceComponent.imageHeight: number` (required), no `columnsPerRow`; `ReferenceImage.aspectRatio: number` (required). Removed: `widthFraction`, `WidthFraction`, `WIDTH_FRACTIONS`, `fractionValue`, `snapWidthFraction`, `effectiveWidth`, `columnsPerRow`, `DEFAULT_COLUMNS`, `setReferenceColumns`, `squareSlotGrid`, `MARGIN`/`GUTTER`/`ROW_GAP` (replaced by `SPACING`).

- [ ] **Step 1: Write failing migration tests** in `migrate.test.ts` — v3 passthrough/normalize (clamp width/imageHeight, `aspectRatio > 0` else 1, drop invalid); v2→v3 (`widthFraction` string → number via a local `FRACTION_TO_NUMBER` table `{"1":1,"3/4":0.75,"2/3":0.667,"1/2":0.5,"1/3":0.333,"1/4":0.25}`; drop `columnsPerRow`; add `imageHeight = DEFAULT_IMAGE_HEIGHT`; images `aspectRatio = 1`); v1→v3 chain; forward `schemaVersion 4` → EMPTY.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement:** make `width`/`imageHeight`/`aspectRatio` required; set `ProjectPlan.schemaVersion` literal to `3`; `EMPTY_PLAN.schemaVersion = 3`; write `migratePlan` v2→v3 + v1→v2→v3; remove all listed legacy symbols and update every remaining reference (`effectiveWidth(c)` → `c.width`; seeds set `width`/`imageHeight`/`aspectRatio`; `handleInsert` seeds `width: 1`, reference seeds `imageHeight: DEFAULT_IMAGE_HEIGHT`). `pnpm typecheck` after each batch to find stragglers.
- [ ] **Step 4: Run → PASS** — `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- [ ] **Step 5: Commit** — `git commit -m "refactor(canvas): finalize schemaVersion 3, migrate v2->v3, drop legacy fields"`.

---

### Task 12: e2e, featurelist, and full-matrix validation

**Files:** Modify `e2e/canvas.spec.ts`, `docs/design_docs/featurelist.json`.

- [ ] **Step 1: Extend `e2e/canvas.spec.ts`** (mirror existing gesture patterns; `scrollIntoViewIfNeeded` before drags): (a) drag a component by its TOP BAR to reorder (committed order changes); (b) drag a component's right edge to resize width (bounding box narrows, save-status unsaved); (c) adjust a reference component's image height via the stepper (a tile's height changes); (d) insert a component → it appears at the TOP; (e) delete → confirm dialog → component count drops only after confirm; (f) reference images render at aspect ratio (a landscape tile is wider than a portrait tile); (g) export PDF still succeeds. Keep every existing canvas e2e green.
- [ ] **Step 2: Update `docs/design_docs/featurelist.json`** — a new/updated entry for the UX enhancements (continuous width, unified spacing, top-bar move, four-edge resize, delete-confirm, insert-at-top, aspect reference images + adjustable height, multi-insert, schemaVersion 3, PDF reveal); refresh `lastVerified`; validate JSON parses.
- [ ] **Step 3: Run the FULL matrix** — `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `cargo test --manifest-path src-tauri\Cargo.toml`, `pnpm build`. All green.
- [ ] **Step 4: Commit** — `git commit -m "test(canvas): e2e for UX enhancements; finalize featurelist"`.

---

## Self-Review

- **Spec coverage:** continuous width (T2), unified spacing (T3), image dims + multi-insert (T4/T6), imageHeight + aspect slots (T5/T6), slot rendering (T6), top-bar move + type label + four-edge resize (T7), delete confirm (T8), insert-at-top + default components (T9), PDF reveal (T10), schemaVersion 3 + migration (T11), e2e + featurelist (T12). All spec sections map to a task.
- **Green-at-every-task:** new fields are additive/optional through T2–T10; the required-fields + schema bump + legacy removal are isolated to T11 (with `pnpm typecheck` sweeps).
- **Type consistency:** `width`/`imageHeight`/`aspectRatio`, `clampWidth`/`clampImageHeight`, `packAspectRow`, `resizeComponent({width,height})`, `setImageHeight`, `addReferenceImages`, `setImageAspectRatio`, `importImages`, `pickImageFiles`, `PdfRevealTarget.reveal` are used consistently across tasks.
- **WYSIWYG:** screen + PDF both consume the engine `imageSlots`/rects (T5/T6); no divergent layout math.

## Deferred (other sub-projects, not in this plan)

Project storage model (`.preshotproj`, `~/.preshot`, naming, plan-JSON relocation), theming + Settings menu, undo/redo, Windows MSI installer.
