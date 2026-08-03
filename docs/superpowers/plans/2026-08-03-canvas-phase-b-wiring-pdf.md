# Canvas Component System — Phase B: Wiring + WYSIWYG PDF — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Phase A canvas domain core into the running app: decouple Rust persistence to opaque JSON, add a v2 plan service + adapters, build the A4 canvas UI (render, insert menu, component drag-reorder + resize, reference component view reusing the existing image grid + image DnD), and a true WYSIWYG PDF export driven by the shared layout engine; switch the workspace to the canvas and remove the old plan model/UI/PDF.

**Architecture:** Parallel scaffolding. The new v2 path (`src/domain/plan/canvas/*`, new `features/plan/canvas/*` components, a new `ProjectCanvasProvider`) is built ALONGSIDE the existing v1 plan code so every task keeps the suite green; the workspace is switched to the canvas provider late (Task B7), then the v1 code is deleted (Task B8).

**Tech Stack:** React 19 + TypeScript, @dnd-kit, BlockNote, pdf-lib + fontkit, Rust (Tauri, serde_json), Vitest, Playwright, Tailwind, pnpm.

## Global Constraints

- Package manager **pnpm** (`pnpm@10.15.0`); never add npm/yarn lock files.
- Layering (AGENTS.md): `domain` imports no React/Tauri/browser/infra; `@tauri-apps/api` only in `src/infrastructure`; Rust commands stay serializable, narrow, free of UI/business rules.
- The Phase A canvas core (`src/domain/plan/canvas/`: `models.ts`, `geometry.ts`, `engine.ts`, `plan.ts`, `migrate.ts`, `dropTarget.ts`) is DONE and must be reused as-is (do not re-implement its functions).
- All UI text via react-i18next (`useTranslation`/`t`), Chinese; add new keys to `src/shared/i18n/locales/zh.ts`. Brand "Preshot" stays literal. Error banners show the generic `errors.plan` message.
- Heights/geometry in A4 points; width fractions `{1,3/4,2/3,1/2,1/4,3/4}`; the on-screen A4 scales by `scale = availableWidth / A4.width`.
- **Parallel scaffolding:** do NOT modify or delete v1 plan files until Task B7/B8; every task ends with `pnpm typecheck`, `pnpm lint`, and `pnpm test` green (plus `pnpm test:e2e` for tasks that change e2e, and `cargo test --manifest-path src-tauri\Cargo.toml` for the Rust task).
- **Phase A review carry-overs (honor these):** `imageSlots` from `layoutPlan` are relative to the component rect origin and computed on the FULL allotment width — the canvas/PDF must render them in the un-inset allotment space (apply the `gutter/2` inset to the component's own content, not to the slots). Component drag uses the insertion-index (before/after) model from `componentDropTarget`; intra-reference image drag keeps its existing arrayMove feel.
- TDD per task; commit per task with the trailer `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.
- Validation: `pnpm exec vitest run <file>` (focused), `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `cargo test --manifest-path src-tauri\Cargo.toml`.

---

## File Structure

New:
- `src/domain/plan/canvas/ports.ts` — `CanvasPlanRepository` (raw JSON load/save).
- `src/domain/plan/canvas/service.ts` — `createCanvasPlanService` (load via migrate, save v2, image ops, component-aware import/remove).
- `src/domain/plan/canvas/pdf/exportDocument.ts` — pure: `buildCanvasLayout(plan, geometry)` returning placements + page count for the PDF (reuses `layoutPlan`).
- `src/infrastructure/pdf/canvasPdfExporter.ts` — pdf-lib exporter consuming the layout (reuses the existing tokenizer + containSize + frame).
- `src/features/plan/canvas/` — `PlanCanvas.tsx`, `CanvasPage.tsx`, `ComponentFrame.tsx`, `InsertComponentMenu.tsx`, `PlanTextComponentView.tsx`, `ReferenceComponentView.tsx`, `canvasDropGeometry.ts` (pointer→component insertion), and tests.
- `src/features/plan/ProjectCanvasProvider.tsx` — the v2 provider (state, preview, auto-save, image load, export, lightbox).
- `e2e/canvas.spec.ts` — canvas e2e.

Modified:
- `src-tauri/src/workspace.rs`, `src-tauri/src/plan.rs` — opaque-JSON plan (B1).
- `src/infrastructure/plan/tauriPlan.ts`, `browserPlan.ts` — add raw load/save + v2 seed (B1/B2).
- `src/app/plan/planDependencies.ts` — provide the canvas deps (B5).
- `src/app/layout/Workspace.tsx` — render `ProjectCanvasProvider` (B7).
- `src/shared/i18n/locales/zh.ts` — new keys (B3–B6).
- `docs/design_docs/featurelist.json` (B8).

Deleted in B8 (v1): `ProjectPlanProvider.tsx`, `PlanPanel.tsx`, `PhotographyPlanTab.tsx`, `ReferenceImagesTab.tsx`, `dropTarget.ts` (features), `domain/plan/models.ts`, `domain/plan/plan.ts`, `domain/plan/service.ts`, `domain/plan/pdf/document.ts`+`export.ts`, `infrastructure/pdf/pdfLibExporter.ts`, and their tests (reference-image grid/tile/lightbox are RETAINED and reused).

---

## Task B1: Rust opaque-JSON plan + adapter null-guard

**Files:**
- Modify: `src-tauri/src/workspace.rs` (`ProjectManifest.plan`), `src-tauri/src/plan.rs` (commands + tests), `src/infrastructure/plan/tauriPlan.ts` (`loadPlan` null-guard)
- Test: `src-tauri/src/plan.rs` (#[cfg(test)]), `src/infrastructure/plan/tauriPlan.test.ts`

**Interfaces:**
- Produces: `read_project_plan(project_path) -> serde_json::Value`, `save_project_plan(project_path, plan: serde_json::Value) -> ProjectManifest`. The `.preshot` `plan` field is now opaque JSON. The v1 TS app is untouched otherwise (still reads/writes v1-shaped JSON through the opaque field).

- [ ] **Step 1: Update the Rust manifest + commands (write tests first)**

In `src-tauri/src/plan.rs`, replace the typed round-trip tests with opaque-JSON tests. Add to the `#[cfg(test)] mod tests`:
```rust
#[test]
fn save_then_read_round_trips_opaque_plan_json() {
    let parent = project();
    let project_path = parent.path().join("Shoot");
    let plan = serde_json::json!({
        "schemaVersion": 2,
        "components": [
            { "id": "a", "type": "plan", "widthFraction": "1", "height": 200, "html": "<p>hi</p>" }
        ]
    });
    let manifest = save_project_plan_in(&project_path, plan.clone()).unwrap();
    assert_eq!(manifest.plan.as_ref().unwrap(), &plan);
    assert_eq!(read_project_plan_in(&project_path).unwrap(), plan);
}

#[test]
fn read_plan_defaults_to_null_when_absent() {
    let parent = project();
    assert!(read_project_plan_in(&parent.path().join("Shoot")).unwrap().is_null());
}
```
Run: `cargo test --manifest-path src-tauri\Cargo.toml plan::` — Expected: FAIL to compile (types still typed).

- [ ] **Step 2: Implement the opaque plan**

In `src-tauri/src/workspace.rs`: change the manifest field (line ~37) from `pub plan: Option<ProjectPlan>,` to `pub plan: Option<serde_json::Value>,`. Remove the now-unused `ProjectPlan`, `ReferenceGroup`, `ReferenceImage` structs (lines ~40–66) and any `use` of them, unless other modules use them (they do not — `plan.rs` will switch to `Value`). Keep the `deserialize_cover_image` and other fields untouched.

In `src-tauri/src/plan.rs`: change the imports (drop `ProjectPlan` from the `workspace` use), and:
```rust
pub fn save_project_plan_in(
    project_path: &Path,
    plan: serde_json::Value,
) -> Result<ProjectManifest, CommandError> {
    let project_path = canonicalize_directory(project_path, "project_not_found", "project_not_directory")?;
    let mut manifest = read_manifest(&project_path)?;
    manifest.plan = Some(plan);
    manifest.updated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    write_manifest_atomically(&project_path, &manifest)?;
    Ok(manifest)
}

pub fn read_project_plan_in(project_path: &Path) -> Result<serde_json::Value, CommandError> {
    let project_path = canonicalize_directory(project_path, "project_not_found", "project_not_directory")?;
    Ok(read_manifest(&project_path)?.plan.unwrap_or(serde_json::Value::Null))
}

#[tauri::command]
pub fn save_project_plan(project_path: String, plan: serde_json::Value) -> Result<ProjectManifest, CommandError> {
    save_project_plan_in(Path::new(&project_path), plan)
}

#[tauri::command]
pub fn read_project_plan(project_path: String) -> Result<serde_json::Value, CommandError> {
    read_project_plan_in(Path::new(&project_path))
}
```
Delete the old typed round-trip tests (`save_then_read_round_trips_plan_and_bumps_updated_at`, `read_plan_preserves_photography_plan_from_manifest`, `read_plan_defaults_to_empty_groups`) and the `use crate::workspace::{ReferenceGroup, ReferenceImage};` in the test module. Keep the image tests.
Run: `cargo test --manifest-path src-tauri\Cargo.toml` — Expected: PASS (all, including the 2 new plan tests).

- [ ] **Step 3: Keep the v1 TS adapter green (null-guard)**

The Rust default is now `null`. In `src/infrastructure/plan/tauriPlan.ts`, make `loadPlan` tolerate it. Change the body of `loadPlan` to:
```ts
    async loadPlan(projectPath) {
      try {
        const raw = await invokeCommand("read_project_plan", { projectPath });
        return validatePlan(raw ?? { photographyPlan: "", referenceGroups: [] });
      } catch (error) {
        throw new Error(`Unable to read the project plan: ${detail(error)}`, { cause: error });
      }
    },
```
Add a test in `src/infrastructure/plan/tauriPlan.test.ts` asserting that a `null` invoke result loads as the empty v1 plan (`{ photographyPlan: "", referenceGroups: [] }`). If the existing tests stub `read_project_plan` returning a v1 object, they keep passing.
Run: `pnpm exec vitest run src/infrastructure/plan/tauriPlan.test.ts` — Expected: PASS.

- [ ] **Step 4: Full validation**

Run: `pnpm typecheck` (clean), `pnpm lint` (clean), `pnpm test` (all pass), `cargo test --manifest-path src-tauri\Cargo.toml` (all pass).

- [ ] **Step 5: Commit**

```powershell
cd C:\projects\Preshot; git add src-tauri/src/workspace.rs src-tauri/src/plan.rs src/infrastructure/plan/tauriPlan.ts src/infrastructure/plan/tauriPlan.test.ts
git commit -m "feat(canvas): store the project plan as opaque JSON in Rust" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task B2: v2 plan service + adapters (raw JSON)

**Files:**
- Create: `src/domain/plan/canvas/ports.ts`, `src/domain/plan/canvas/service.ts`, `src/domain/plan/canvas/service.test.ts`
- Modify: `src/infrastructure/plan/tauriPlan.ts` (add raw methods), `src/infrastructure/plan/browserPlan.ts` (add raw methods + v2 seed)
- Test: `src/infrastructure/plan/browserPlan.test.ts` (if it asserts seed)

**Interfaces:**
- Consumes: `migratePlan`, reducers (`addComponent`, `removeComponent`, `addReferenceImage`, `removeReferenceImage`), model types (Phase A); the existing `ReferenceImageStore` port (`src/domain/plan/ports.ts`, reused unchanged — image ops are shape-agnostic).
- Produces:
  - `CanvasPlanRepository { loadRawPlan(projectPath: string): Promise<unknown>; saveRawPlan(projectPath: string, plan: ProjectPlan): Promise<void> }` in `canvas/ports.ts`.
  - `CanvasPlanService` in `canvas/service.ts` with: `loadPlan(projectPath): Promise<ProjectPlan>` (= `migratePlan(await loadRawPlan(...))`), `savePlan(projectPath, plan): Promise<void>`, `loadImage(projectPath, file): Promise<string>`, `importImage(projectPath, plan, componentId, sourcePath): Promise<{ plan; image; dataUrl }>` (imageStore.importImage → `addReferenceImage` → saveRawPlan), `removeImage(projectPath, plan, componentId, imageId): Promise<ProjectPlan>` (remove via reducer → save → delete file), `removeComponent(projectPath, plan, componentId): Promise<ProjectPlan>` (remove via reducer → save → delete that component's image files if it was a reference). Mirror the enqueue/contextualError pattern of the existing `src/domain/plan/service.ts`.

- [ ] **Step 1: Write the failing service test**

Create `src/domain/plan/canvas/service.test.ts` with an in-memory `CanvasPlanRepository` + `ReferenceImageStore` fake, asserting: `loadPlan` migrates a v1 raw object to v2 components; `loadPlan` of `null` → `EMPTY_PLAN`; `savePlan` writes the v2 plan (round-trips via the fake); `importImage` appends an image to the named reference component and persists; `removeImage` removes it and calls the store's `removeImage`; `removeComponent` drops the component and removes its images' files.
```ts
import { describe, expect, it, vi } from "vitest";
import { createCanvasPlanService } from "./service";
import { EMPTY_PLAN, type ProjectPlan, type ReferenceComponent } from "./models";

function fakes(initialRaw: unknown) {
  let raw = initialRaw;
  const repository = {
    loadRawPlan: vi.fn(async () => raw),
    saveRawPlan: vi.fn(async (_p: string, plan: ProjectPlan) => { raw = plan; }),
  };
  const removed: string[] = [];
  const imageStore = {
    importImage: vi.fn(async () => ({ file: "references/0009.png", dataUrl: "data:image/png;base64,AA" })),
    loadImage: vi.fn(async () => "data:image/png;base64,AA"),
    removeImage: vi.fn(async (_p: string, file: string) => { removed.push(file); }),
  };
  return { repository, imageStore, removed };
}

const refPlan: ProjectPlan = {
  schemaVersion: 2,
  components: [{ id: "r", type: "reference", widthFraction: "1", height: 300, title: "T", description: "", columnsPerRow: 3, showCaptions: false, images: [{ id: "i1", file: "references/0001.png" }] }],
};

describe("canvas plan service", () => {
  it("migrates a v1 raw plan on load", async () => {
    const { repository, imageStore } = fakes({ photographyPlan: "<p>x</p>", referenceGroups: [] });
    const service = createCanvasPlanService({ repository, imageStore, createId: () => "id", logger: silentLogger() });
    const plan = await service.loadPlan("C:/p");
    expect(plan.schemaVersion).toBe(2);
    expect(plan.components[0]).toMatchObject({ type: "plan" });
  });

  it("returns EMPTY_PLAN for a null raw plan", async () => {
    const { repository, imageStore } = fakes(null);
    const service = createCanvasPlanService({ repository, imageStore, createId: () => "id", logger: silentLogger() });
    expect(await service.loadPlan("C:/p")).toEqual(EMPTY_PLAN);
  });

  it("imports an image into a reference component and persists", async () => {
    const { repository, imageStore } = fakes(refPlan);
    const service = createCanvasPlanService({ repository, imageStore, createId: () => "i2", logger: silentLogger() });
    const { plan } = await service.importImage("C:/p", refPlan, "r", "C:/src.png");
    expect((plan.components[0] as ReferenceComponent).images).toHaveLength(2);
    expect(repository.saveRawPlan).toHaveBeenCalled();
  });

  it("removes an image and deletes its file", async () => {
    const { repository, imageStore, removed } = fakes(refPlan);
    const service = createCanvasPlanService({ repository, imageStore, createId: () => "x", logger: silentLogger() });
    await service.removeImage("C:/p", refPlan, "r", "i1");
    expect(removed).toContain("references/0001.png");
    expect(repository.saveRawPlan).toHaveBeenCalled();
  });
});

function silentLogger() {
  return { debug() {}, info() {}, warn() {}, error() {} };
}
```
Run: `pnpm exec vitest run src/domain/plan/canvas/service.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 2: Implement the ports + service**

Create `src/domain/plan/canvas/ports.ts`:
```ts
import type { ProjectPlan } from "./models";

export interface CanvasPlanRepository {
  loadRawPlan(projectPath: string): Promise<unknown>;
  saveRawPlan(projectPath: string, plan: ProjectPlan): Promise<void>;
}
```
Create `src/domain/plan/canvas/service.ts` mirroring `src/domain/plan/service.ts`'s enqueue + contextualError structure, using `migratePlan` on load, the reducers for mutations, and `ReferenceImageStore` for files. Include `loadPlan`, `savePlan`, `loadImage`, `importImage`, `removeImage`, `removeComponent`. Use `type { ReferenceImageStore } from "../ports"`, `type { WorkspaceLogger } from "../../workspace/ports"`. Provide the `CanvasPlanService` interface type. (Component reducers other than image/remove — add/move/resize/update — are applied in the provider directly on state and persisted via `savePlan`, so the service does not need to wrap them.)

- [ ] **Step 3: Implement the raw adapters**

In `src/infrastructure/plan/tauriPlan.ts`, add to the returned object (it already implements `ReferenceImageStore`):
```ts
    async loadRawPlan(projectPath) {
      try {
        return (await invokeCommand("read_project_plan", { projectPath })) ?? null;
      } catch (error) {
        throw new Error(`Unable to read the project plan: ${detail(error)}`, { cause: error });
      }
    },
    async saveRawPlan(projectPath, plan) {
      try {
        await invokeCommand("save_project_plan", { projectPath, plan });
      } catch (error) {
        throw new Error(`Unable to save the project plan: ${detail(error)}`, { cause: error });
      }
    },
```
and widen the return type to `PlanRepository & ReferenceImageStore & CanvasPlanRepository`.
In `src/infrastructure/plan/browserPlan.ts`, add an in-memory v2 raw store (seeded with a Chinese v2 sample: one plan component with an `<h2>日落大片…` html and one reference component titled "造型参考" with 2 seed images), exposing `loadRawPlan`/`saveRawPlan`, and export `createBrowserCanvasPlanDependencies()` returning `{ service: createCanvasPlanService(...), picker }`. Keep the existing v1 browser deps untouched (parallel).

- [ ] **Step 4: Full validation + commit**

Run: `pnpm exec vitest run src/domain/plan/canvas/service.test.ts` (PASS), `pnpm typecheck`, `pnpm lint`, `pnpm test` (all pass).
```powershell
cd C:\projects\Preshot; git add src/domain/plan/canvas/ports.ts src/domain/plan/canvas/service.ts src/domain/plan/canvas/service.test.ts src/infrastructure/plan/tauriPlan.ts src/infrastructure/plan/browserPlan.ts src/infrastructure/plan/browserPlan.test.ts
git commit -m "feat(canvas): add v2 plan service and raw-JSON adapters" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task B3: canvas rendering + reference/plan component views

**Files:**
- Create: `src/features/plan/canvas/PlanCanvas.tsx`, `CanvasPage.tsx`, `ComponentFrame.tsx`, `PlanTextComponentView.tsx`, `ReferenceComponentView.tsx`, and tests.
- Modify: `src/shared/i18n/locales/zh.ts` (canvas chrome keys).

**Interfaces:**
- Consumes: `layoutPlan`, `contentSize`, `DEFAULT_PAGE_GEOMETRY`, `A4`, `GUTTER`, model types (Phase A); the existing `RichTextEditor`, `GroupImageGrid` (reused for the reference grid), `SortableImageTile`, `ReferenceImageLightbox`.
- Produces: `PlanCanvas` (given `components`, `scale`, `imageSrc`, and callbacks) renders A4 pages with absolutely-positioned components from `layoutPlan`; `ComponentFrame` renders the top bar (drag handle + delete) + resize handles around content; `PlanTextComponentView`/`ReferenceComponentView` render each type. Read-only-ish this task (rendering + content edit callbacks); drag/resize interaction is Task B4.

- [ ] **Step 1: Write component tests (render + content)**

Create `src/features/plan/canvas/PlanCanvas.test.tsx` asserting: given two components (a plan + a reference with 2 images), the canvas renders one A4 page region (`role="region"` / a `data-testid="canvas-page"`) containing both components; the plan component shows its editor (`role="group"` with the plan aria) and the reference shows its title and image tiles (`打开参考图 1`); a component's delete button (`移除组件`) calls `onRemoveComponent` with the id. Use the existing test render pattern (i18n is initialized in setup). Mock nothing beyond what existing plan tests mock.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/features/plan/canvas/PlanCanvas.test.tsx` — Expected: FAIL (modules not found).

- [ ] **Step 3: Implement the views**

- `CanvasPage.tsx`: a positioned A4 surface (`width: A4.width*scale`, `height: A4.height*scale`, white, margin guide) that absolutely positions its children.
- `ComponentFrame.tsx`: wraps a component at `{ left: (margin + rect.x)*scale, top: (margin + rect.y)*scale, width: rect.width*scale, height: rect.height*scale }`; renders a top bar with a drag handle (`aria-label={t("canvas.moveComponent")}`, `data-drag-handle`) and a delete button (`aria-label={t("canvas.removeComponent")}`), the content inset by `GUTTER/2 * scale`, and (inert this task) resize-handle elements (`data-resize="width|height|both"`).
- `PlanTextComponentView.tsx`: `<RichTextEditor ariaLabel={t("plan.photographyPlan")} html={component.html} onChange={(html) => onChangeHtml(component.id, html)} />`.
- `ReferenceComponentView.tsx`: title input (`aria-label={t("reference.groupTitleAria")}`), columns select, optional description editor, and the existing `GroupImageGrid` bound to the component's images (reuse it; it already renders tiles + the add button + image DnD). Pass `imageSrc` and the add/remove/open callbacks. NOTE: `GroupImageGrid`/`SortableImageTile` currently key off `group.id`; pass the component id where a group id is expected (a reference component is structurally a group: `{ id, images, columnsPerRow }`). Adapt the minimal props.
- `PlanCanvas.tsx`: compute `layoutPlan(components)`, group placements by `pageIndex`, render a `CanvasPage` per page containing a `ComponentFrame` per placement (choosing the view by `component.type`). Slots for reference images: the `imageSlots` are available from the placement but this task renders the reference grid with normal CSS flow inside the frame (the engine slots are used by the PDF and by an optional absolute-grid later); keep the on-screen grid as the existing `GroupImageGrid` for interactivity.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run src/features/plan/canvas/PlanCanvas.test.tsx` — Expected: PASS.

- [ ] **Step 5: Full validation + commit**

Run: `pnpm typecheck`, `pnpm lint`, `pnpm test` (all pass).
```powershell
cd C:\projects\Preshot; git add src/features/plan/canvas src/shared/i18n/locales/zh.ts
git commit -m "feat(canvas): render A4 canvas pages with plan and reference components" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task B4: component drag-reorder + resize (WYSIWYG preview)

**Files:**
- Create: `src/features/plan/canvas/canvasDropGeometry.ts` (+ test), `src/features/plan/canvas/useComponentResize.ts` (+ test)
- Modify: `PlanCanvas.tsx`, `ComponentFrame.tsx`
- Test: `src/features/plan/canvas/canvasDropGeometry.test.ts`, `useComponentResize.test.ts`

**Interfaces:**
- Consumes: `componentDropTarget`, `moveComponent`, `resizeComponent`, `snapWidthFraction`, `fractionValue`, `contentSize`, `WIDTH_FRACTIONS` (Phase A); `@dnd-kit/core`.
- Produces:
  - `canvasDropGeometry.ts`: pure `insertAfterFromRects(activeRect, overRect): boolean` (component drag is vertical/flow — pointer past the over component's vertical midpoint) used with `componentDropTarget`.
  - `useComponentResize.ts`: a pure helper `resizeFromDrag(component, edge, dxPoints, dyPoints, contentWidth): { widthFraction?, height? }` — width edge → `snapWidthFraction((component.currentWidthPx + dx)/contentWidth)`; height edge → `component.height + dy` (points). Unit-tested.
  - `PlanCanvas` wires a `DndContext` (component-level) with an optimistic `preview` (`moveComponent` on a copy) reflowing live; commit on drop; revert on cancel/no-change. `ComponentFrame` resize handles drive `resizeComponent` with a live preview.

- [ ] **Step 1–4 (TDD):** Write pure tests for `insertAfterFromRects` and `resizeFromDrag` (RED), implement (GREEN); then wire the `DndContext`/handlers in `PlanCanvas`/`ComponentFrame` (the drag/resize commit paths are covered by the e2e in Task B7, since jsdom cannot drive real dnd-kit pointer drags). Keep the existing image-level DnD working inside reference components (nested draggable `data.type: "component" | "image"`). Run `pnpm exec vitest run src/features/plan/canvas/canvasDropGeometry.test.ts src/features/plan/canvas/useComponentResize.test.ts` (PASS), then `pnpm typecheck`, `pnpm lint`, `pnpm test`.

- [ ] **Step 5: Commit**

```powershell
cd C:\projects\Preshot; git add src/features/plan/canvas
git commit -m "feat(canvas): component drag-reorder and resize with live preview" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task B5: ProjectCanvasProvider + insert menu + dependencies

**Files:**
- Create: `src/features/plan/ProjectCanvasProvider.tsx`, `src/features/plan/canvas/InsertComponentMenu.tsx`, and tests.
- Modify: `src/app/plan/planDependencies.ts` (provide canvas deps alongside v1).

**Interfaces:**
- Consumes: `CanvasPlanService`, all reducers, `layoutPlan`; the PDF exporter (Task B6 — until then, the export button can be present but Task B6 wires the real export; to keep B5 self-contained, wire export to a `CanvasPdfExporter` port and have planDependencies supply it — if B6 is not yet done, supply a stub that throws a generic error, but sequence B6 before B7 so export works before the switch).
- Produces: `ProjectCanvasProvider` — mirrors `ProjectPlanProvider` (state `plan: ProjectPlan(v2)`, `imageSrc`, `preview`, `saveState`, `error`, `lightbox`, `exporting`; 5s change-detected auto-save via `service.savePlan`; image loading on load; handlers: `addComponent(type)` [seed plan template or empty reference], `removeComponent`, `moveComponent`, `resizeComponent`, `updateHtml`, reference sub-ops, `addImage`/`removeImage`/`setImageCaption`, `openImage`, `exportPdf`). Renders `PlanCanvas` inside a header bar (Export PDF + `InsertComponentMenu` + SaveStatus) and the `ReferenceImageLightbox`.
- `InsertComponentMenu`: a dropdown button (`t("canvas.insert")`) with items `t("canvas.insertPlan")` / `t("canvas.insertReference")` → `onInsert("plan"|"reference")`.

- [ ] **TDD:** component test for the provider using the browser canvas deps (or a fake service): asserts it loads and renders the seeded components, the insert menu adds a component (SaveStatus → unsaved), and a content edit marks unsaved. Run focused test (RED→GREEN), then `pnpm typecheck`, `pnpm lint`, `pnpm test`. Commit `feat(canvas): add ProjectCanvasProvider and insert-component menu`.

---

## Task B6: WYSIWYG PDF export (canvas layout)

**Files:**
- Create: `src/domain/plan/canvas/pdf/exportDocument.ts` (+ test), `src/infrastructure/pdf/canvasPdfExporter.ts` (+ test)
- Modify: `src/app/plan/planDependencies.ts` (use the canvas exporter)

**Interfaces:**
- Consumes: `layoutPlan`, `slotCaptionSplit`, `containSize`, `A4`, `MARGIN`, `GUTTER`, model types (Phase A); the existing pdf-lib tokenizer/renderer helpers in `pdfLibExporter.ts` (extract the reusable `parseHtmlToBlocks` token rendering into a shared helper, or import the existing `htmlToBlocks` + re-use a rich-text-in-rect renderer).
- Produces:
  - `buildCanvasLayout(plan, geometry?)`: pure — returns `{ pageCount, placements }` (delegates to `layoutPlan`) for the exporter to consume (thin, but unit-tested for page/rect mapping).
  - `CanvasPdfExporter` implementing `export(plan: ProjectPlan, images): Promise<Uint8Array>`: for each page draw each placement in A4 points — plan components render their HTML (reusing the tokenizer) clipped to the rect (inset by `GUTTER/2`); reference components draw the title, optional description, and each image into its `imageSlot` (contain-fit + white padding + light-gray frame via `containSize`/frame; caption text in the `slotCaptionSplit` band when `showCaptions`). Fonts: bundled Noto Sans SC.

- [ ] **TDD:** a pure test for `buildCanvasLayout` (multi-page + reference slots), and an exporter test that renders a small plan and asserts a valid PDF byte stream + expected page count (reuse existing pdf test patterns; assert `%PDF` header and that `PDFDocument.load` yields `pageCount` pages). Wire `planDependencies` to the `CanvasPdfExporter`. Run focused tests (RED→GREEN), `pnpm typecheck`, `pnpm lint`, `pnpm test`. Commit `feat(canvas): WYSIWYG PDF export from the shared layout engine`.

---

## Task B7: switch the workspace to the canvas + e2e

**Files:**
- Modify: `src/app/layout/Workspace.tsx` (render `ProjectCanvasProvider`), `src/app/plan/planDependencies.ts` (default to canvas deps).
- Create: `e2e/canvas.spec.ts`
- Modify: `e2e/plan.spec.ts` (retarget or replace with canvas equivalents), `e2e/layout.spec.ts` (selectors), `e2e/workspace.spec.ts` (unaffected if launcher unchanged).

**Interfaces:** `Workspace` now renders `ProjectCanvasProvider` with the canvas `PlanDependencies`.

- [ ] **Steps:** Point `Workspace.tsx` at `ProjectCanvasProvider`; update `planDependencies` to return the canvas service/exporter for prod + memory. Write `e2e/canvas.spec.ts`: insert a plan + a reference component; drag-reorder two components by the top handle (assert order via SaveStatus → 有未保存的更改 and DOM order); resize a component's width (assert it changed); add an image + type a caption; overflow to a second A4 page (assert two `canvas-page` regions); export PDF (assert the Export button cycles). Update `plan.spec.ts` drag/lightbox tests to the canvas structure (or delete the now-obsolete ones and rely on `canvas.spec.ts`). Run `pnpm test:e2e` (all pass, stable across a repeat run for drag tests), then `pnpm typecheck`, `pnpm lint`, `pnpm test`. Commit `feat(canvas): switch the workspace to the A4 canvas`.

---

## Task B8: remove the v1 plan model, UI, and PDF

**Files:**
- Delete: `src/features/plan/ProjectPlanProvider.tsx`(+test), `PlanPanel.tsx`(+test), `PhotographyPlanTab.tsx`, `ReferenceImagesTab.tsx`(+test), `dropTarget.ts`(+test); `src/domain/plan/models.ts`, `plan.ts`(+test), `service.ts`(+test); `src/domain/plan/pdf/document.ts`(+test), `export.ts`(+test), `geometry.ts`(+test if superseded); `src/infrastructure/pdf/pdfLibExporter.ts`(+test); the v1 bits of `tauriPlan.ts`/`browserPlan.ts` (the `PlanRepository.loadPlan`/`savePlan` + `validatePlan` + v1 browser deps) once nothing imports them.
- Keep/relocate: `GroupImageGrid`, `SortableImageTile`, `ReferenceImageLightbox` (reused by the canvas — move under `features/plan/canvas/` if cleaner), the shared PDF tokenizer (`htmlToBlocks`, font assets, save targets), `src/domain/plan/ports.ts`'s `ReferenceImageStore`/`PlanImagePicker`.
- Modify: `docs/design_docs/featurelist.json`.

**Interfaces:** After deletion, the only plan model is v2 (`canvas/models.ts`); nothing imports the v1 types.

- [ ] **Steps:** Delete the v1 files whose only importers were other v1 files (work leaf-first; `pnpm typecheck` after each batch to find stragglers). Remove now-dead exports from `tauriPlan`/`browserPlan`. Update `docs/design_docs/featurelist.json` with the canvas component system entry + a `lastVerified` block; validate JSON. Run the FULL matrix: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `cargo test --manifest-path src-tauri\Cargo.toml`, `pnpm build`. Commit `refactor(canvas): remove the v1 plan model, UI, and PDF`.

---

## Self-Review Notes

- **Spec coverage (Phase B portion):** Rust opaque JSON (B1) ✓; v2 service + adapters + migration-on-load (B2) ✓; A4 canvas render + component views reusing the image grid (B3) ✓; component drag-reorder + resize with preview (B4) ✓; provider + insert menu + auto-save + export wiring (B5) ✓; WYSIWYG PDF from the shared engine incl. caption bands (B6) ✓; switch + e2e (B7) ✓; delete v1 + featurelist (B8) ✓. Deferred to Phase C: per-image caption editing UI + toggle wiring, and the photography-plan default template content.
- **Green-at-every-task:** parallel scaffolding keeps v1 alive until B7/B8; each task lists its validation (incl. `cargo test` for B1, `test:e2e` for B7/B8).
- **Phase A carry-overs honored:** slots rendered in the un-inset allotment space (B3/B6 notes); component-drag insertion-index model (B4); `setImageCaption` ref-stability already fixed in Phase A.
- **Type consistency:** `CanvasPlanRepository`/`CanvasPlanService`, `ProjectCanvasProvider`, and the canvas views all consume the v2 `ProjectPlan`/`PlanComponent`; the reused `ReferenceImageStore`/`PlanImagePicker` ports are shape-agnostic.

## Next Phase (separate plan, after Phase B ships)

- **Phase C — Content features:** per-image caption editing UI in `ReferenceComponentView` (the `showCaptions` toggle in the reference top bar + an editable caption box ~1/3 the tile height bound to `image.caption`), caption text rendered in the PDF caption bands (already computed by the engine), and the photography-plan default template (an i18n content key seeded by `addComponent("plan")`): `拍摄时间：/拍摄地点：/道具和服装：/器材：`. Plus e2e + featurelist.
