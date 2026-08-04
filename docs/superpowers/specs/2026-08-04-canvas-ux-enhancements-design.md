# Canvas / Component UX Enhancements — Design

Refinements to the shipped A4 canvas component system (Phases A–D) driven by
`docs/design_docs/requirement_prd_0804.md`. This is the **first sub-project** of
that PRD; the others are explicitly deferred (see Scope).

## Goal

Make the canvas feel like a real layout tool: components move by their whole top
bar (not a tiny icon), resize freely by dragging borders, sit tightly with a
single consistent spacing, and reference images display at their natural aspect
ratio at an adjustable height. New projects start populated, deletes are
confirmed, images import in batches, and exporting a PDF reveals its folder.

## Scope

**In scope (this spec):**
- Continuous component width via border drag; ordered-flow packing + reflow.
- Unified spacing (page margin == inter-component gap).
- Move a component by its whole top bar (with a low-emphasis type label) + hover
  affordance; resize by dragging L/R/T/B edges + corner.
- Delete confirmation dialog.
- Insert new components at the top.
- New projects seed one Plan + one Reference component.
- Reference images: adjustable per-component display height, natural aspect
  ratio, automatic row-packing/wrap (drop the columns control); capture image
  dimensions on import; multi-select batch insert.
- PDF export reveals the output folder in the OS file manager.
- Plan JSON schema bumped to `schemaVersion: 3` with a pure v2→v3 migration.

**Deferred to their own sub-projects (NOT built here):**
- Project storage model (`.preshotproj`, global `~/.preshot/`, `projects/`
  default, Chinese directory picker, name-collision `(2)/(3)` suffixes,
  relocating the plan JSON out of the manifest).
- Theming (dark/light) + a Settings menu.
- Undo/redo.
- Windows MSI installer.

## Decisions (from brainstorming)

- **Ordered-flow layout is kept** (auto-place L→R, wrap, paginate) so the PDF
  stays pixel-matched to the screen — not free-form absolute positioning.
- **Continuous width**: a component's width is a continuous fraction of the
  content width (drag L/R border), replacing the fixed `widthFraction` enum.
- **Unified spacing `S = 24pt`** for the page margin AND both inter-component
  gaps, so "component-to-edge" equals "component-to-component". (Tunable
  constant; today margin is 48 and gaps are 12.)
- **Reference images**: per-component `imageHeight` (default `180pt`,
  user-adjustable); each image keeps its natural aspect ratio at that height;
  images row-pack left→right and wrap; the columns control is removed.
- **Image dimensions** are captured on import (read from the loaded image's
  natural size on the frontend — no Rust image-decode dependency) and stored as
  `aspectRatio`; legacy images backfill it on first load.
- **Move** is by the whole top bar; **resize** is by the edges; **delete** is
  confirmed.

## Architecture & Data Flow

The pure domain core (`src/domain/plan/canvas/`) remains the single source of
layout truth consumed by BOTH the screen renderer and the PDF exporter, so
WYSIWYG is preserved. UI (`src/features/plan/`) dispatches pure reducers via the
existing client-side `applyPlan` path (5s auto-save); only file-side-effect ops
(image import/remove, component remove) go through `CanvasPlanService`.

```
React UI -> pure reducer (plan.ts) -> applyPlan (auto-save)
layoutPlan(components, geometry) -> screen renderer  \
                                  -> PDF exporter      } same engine => WYSIWYG
```

### Domain model (`src/domain/plan/canvas/models.ts`)

Bump to `schemaVersion: 3`.

```ts
export interface ProjectPlan { schemaVersion: 3; components: PlanComponent[] }

export interface BaseComponent {
  id: string;
  width: number;   // continuous fraction of content width, (0, 1]; default 1
  height: number;  // points
}
export interface PlanTextComponent extends BaseComponent { type: "plan"; html: string }
export interface ReferenceComponent extends BaseComponent {
  type: "reference";
  title: string;
  description: string;
  showCaptions: boolean;
  imageHeight: number;          // points; default DEFAULT_IMAGE_HEIGHT
  images: ReferenceImage[];
}
export interface ReferenceImage {
  id: string;
  file: string;
  caption?: string;
  aspectRatio: number;          // width / height, > 0; default 1 until backfilled
}
export type PlanComponent = PlanTextComponent | ReferenceComponent;
```

Removed: `widthFraction`, `WidthFraction`, `WIDTH_FRACTIONS`, `fractionValue`,
`snapWidthFraction`, `columnsPerRow`, `DEFAULT_COLUMNS`.
Added constants: `DEFAULT_WIDTH = 1`, `MIN_WIDTH = 0.15`,
`DEFAULT_IMAGE_HEIGHT = 180`, `MIN_IMAGE_HEIGHT = 80`, `MAX_IMAGE_HEIGHT = 400`,
`clampWidth`, `clampImageHeight`. Keep `DEFAULT_PLAN_HEIGHT = 220`,
`DEFAULT_REFERENCE_HEIGHT = 320`, `clampHeight`.

### Geometry (`src/domain/plan/canvas/geometry.ts`)

Introduce a single spacing unit and use it everywhere:

```ts
export const SPACING = 24;          // was MARGIN 48 / GUTTER 12 / ROW_GAP 12
export const DEFAULT_PAGE_GEOMETRY = {
  page: { width: A4.width, height: A4.height },
  margin: SPACING, gutter: SPACING, rowGap: SPACING,
};
```
`contentSize` and `Rect`/`containSize` are unchanged. `squareSlotGrid` is
removed (reference layout no longer uses square columns).

Add a pure aspect-ratio row packer used by the engine:

```ts
// Packs items of a fixed height and per-item aspect ratio into rows of maxWidth,
// left-justified, gap between items, wrapping when the next item overflows.
// A single item wider than maxWidth is scaled down to maxWidth (its height then
// drops below `height` for that item only). Returns per-item rects (origin 0,0).
export function packAspectRow(
  items: { aspectRatio: number }[],
  height: number, maxWidth: number, gap: number,
): { rects: Rect[]; totalHeight: number }
```

### Pure layout engine (`src/domain/plan/canvas/engine.ts`)

- **Component flow (continuous width):** for each component, `widthPts =
  component.width * contentWidth`. Place at the current `x`; if `x + widthPts >
  contentWidth + EPS` and the row is non-empty, wrap (`x = 0`, `y += rowHeight +
  gutter`). Advance `x += widthPts + gutter`. Page-break to the next page when
  `y + height > contentHeight + EPS` (never split a component; clamp height to one
  page). Row gap and inter-column gap are both `SPACING`.
- **Reference `imageSlots` (aspect rows):** given the component's inner content
  rect, `imageHeight`, and each image's `aspectRatio`, call `packAspectRow` to
  get per-image rects at `y = titleBand (+ descriptionBand)`. When `showCaptions`,
  each image reserves a caption band beneath it (`round(imageHeight / 4)`), i.e.
  the packer runs at `imageHeight` and the caption band is appended per image (the
  row height becomes `imageHeight + captionBand`). Slots are returned relative to
  the component origin, on the gutter-inset content width (renderers draw at
  `contentRect.x + slot.x`, matching Phase D's slot-fit fix).
- Titles/description bands unchanged (`TITLE_BAND`, `DESCRIPTION_BAND`).

### Reducers (`src/domain/plan/canvas/plan.ts`)

- `resizeComponent(plan, { id, width?, height? })` — clamp `width` via
  `clampWidth`, `height` via `clampHeight`.
- `setImageHeight(plan, id, imageHeight)` — new; clamp via `clampImageHeight`.
- `addComponent(plan, component)` — now **prepends** (index 0).
- `addReferenceImages(plan, { componentId, images })` — new; batch-append images
  (each already carrying `aspectRatio`); the single-image path composes on top.
- `setImageAspectRatio(plan, { componentId, imageId, aspectRatio })` — new;
  used by the on-load backfill (no-op if unchanged, for ref stability).
- Kept: `removeComponent`, `moveComponent`, `updatePlanHtml`,
  `setReferenceTitle`, `setReferenceDescription`, `toggleReferenceCaptions`,
  `setImageCaption`, `removeReferenceImage`, `moveImage`.
- Removed: `setReferenceColumns`.

### Persistence & migration (`src/domain/plan/canvas/migrate.ts`)

`migratePlan(raw, makeId?)` stays pure/total/never-throws:
- `schemaVersion === 3`: normalize/clamp (`width`, `height`, `imageHeight`,
  `aspectRatio > 0` else 1), drop invalid components/images.
- `schemaVersion === 2`: map each component `widthFraction → width` via a small
  local fraction→number table in `migrate.ts` (`"1"→1, "3/4"→0.75, "2/3"→0.667,
  "1/2"→0.5, "1/3"→0.333, "1/4"→0.25`; `fractionValue` is removed from models, so
  the mapping lives in the migrator, its only consumer); reference components drop
  `columnsPerRow`, gain `imageHeight = DEFAULT_IMAGE_HEIGHT`; each image gains
  `aspectRatio = 1` (backfilled on load). Preserve order/ids/heights/captions.
- v1 record: run the existing v1→v2 shape, then v2→v3.
- Non-record / unknown / forward (`schemaVersion > 3`): `EMPTY_PLAN`.

The plan JSON continues to live inside the project's `.preshot` manifest
(opaque `serde_json::Value` on the Rust side — no Rust change needed). Relocating
it to `.preshotproj` is the storage sub-project.

### Canvas UI (`src/features/plan/`)

- **`PlanCanvas`** consumes `layoutPlan` as today; `view = preview ?? components`.
- **`ComponentFrame`**:
  - Top bar becomes the **move handle** (whole bar draggable via the existing
    `useDraggable` `data.type:"component"`), showing a small low-emphasis **type
    label** (i18n `canvas.typePlan` / `canvas.typeReference`) and the delete ×.
    Hover shows `cursor: grab` + a tooltip/hint ("拖动移动 / 交换位置").
  - **Resize** strips on L/R (width), T/B (height), corner (both) with resize
    cursors; drag deltas convert to points via `scale`; live preview via
    `resizeComponent`. Width drag updates `width` continuously (clamped);
    L-border drag resizes from the left (the flow re-derives position).
  - **Delete** × opens a `ConfirmDialog` (new shared modal) → `onRemove` only on
    confirm.
- **`ReferenceComponentView`**: renders images from the engine's `imageSlots`
  (absolute-positioned tiles) so screen packing == PDF packing; keeps the caption
  editors (Phase C) in the caption band; adds a small **image-height stepper**
  (`−` / `+`, ~20pt steps, in the reference header next to the title) calling
  `onSetImageHeight` — kept distinct from the component's bottom height-resize
  edge to avoid conflict. The `+` add tile triggers a **multi-select** import. The
  columns `<select>` is removed.
- **`GroupImageGrid`/`SortableImageTile`** are refactored to position each tile by
  its engine-computed slot (absolute within the component, replacing the CSS grid)
  while keeping dnd-kit reorder (`imageDropTarget`, Phase D) and `draggable={false}`
  on the `<img>`; the caption textarea renders in the slot's caption band.
- **`InsertComponentMenu`** unchanged (insert now prepends via the reducer).
- **`ProjectCanvasProvider`**: adds `handleSetImageHeight`,
  `handleAddImages` (multi), the delete-confirm wiring, and calls the reveal
  command after a successful PDF save; seeds `[plan, reference]` for a new/empty
  plan. Image import reads natural dimensions to set `aspectRatio`; on load, any
  image missing a real ratio is measured and written back via
  `setImageAspectRatio` (deferred save).

### Image dimensions & multi-insert (infrastructure)

- `PlanImagePicker` gains `pickImageFiles(): Promise<string[]>` (Tauri dialog
  `multiple: true`); the single picker composes on top.
- `CanvasPlanService.importImages(projectPath, plan, componentId, sourcePaths)`
  imports each file (existing per-file Rust command, unchanged), returns the new
  `ReferenceImage[]` + their data URLs; the provider measures each data URL's
  natural size to set `aspectRatio`, then `addReferenceImages`.
- **Reveal folder:** a new narrow Rust command `reveal_path(path)` opens the OS
  file manager at the file's folder (Windows: `explorer /select,<path>`),
  exposed via a `PdfSaveTarget`-adjacent adapter; called after `save`.

### WYSIWYG PDF export (`src/infrastructure/pdf/canvasPdfExporter.ts`)

Consumes the same `layoutPlan` output: continuous-width component rects,
aspect-ratio reference `imageSlots` (contain-fit each image in its slot — now the
slot already matches the image ratio, so it fills it), caption bands, unified
spacing. Font priming/subsetting (Phase C) and `slotToPageRect` (Phase D)
unchanged.

## Error Handling

- Import failures surface the existing generic Chinese banner; a partial batch
  import reports which files failed and keeps the successes.
- Measuring a broken/unloadable image falls back to `aspectRatio = 1` (never
  throws); the layout stays valid.
- `reveal_path` failures are non-fatal: the PDF is already saved; log + a
  non-blocking banner, never lose the export.
- Reducers/migration never throw; invalid data is clamped or dropped.

## Testing

- **Domain (pure):** `packAspectRow` (single row, wrap, oversized-item clamp,
  gaps); `layoutPlan` continuous-width packing (two components share a row, wrap
  when they don't fit, page-break, height clamp) and reference `imageSlots` with
  captions; reducers (`resizeComponent` width/height clamp, `setImageHeight`,
  `addComponent` prepends, `addReferenceImages`, `setImageAspectRatio` no-op
  stability); `migratePlan` v3 normalize, v2→v3 (fraction→width, columns dropped,
  imageHeight/aspectRatio defaults), v1→v3, forward→empty.
- **Component (jsdom):** type label renders; delete shows the confirm dialog and
  only removes on confirm; the image-height control invokes the handler; multi
  import calls the plural picker + batch add; caption band still renders. dnd-kit
  drags remain e2e-only.
- **E2E (Playwright):** border-drag move (committed reorder), border-drag width
  resize (width changes, reflow), adjust image height (images rescale), insert at
  top, delete-with-confirm, multi-image insert, export PDF (succeeds); reference
  images render at aspect ratio (a landscape vs portrait differ in width).
- **PDF:** exporter still produces the engine's page/rect layout; a focused test
  covers a reference component with mixed-aspect images + captions.
- All new UI strings are Chinese i18n keys.

## Risks & Mitigations

- **Screen/PDF divergence for reference rows:** mitigated by rendering both from
  the same `imageSlots` (no CSS-grid packing for reference images).
- **Continuous width + fixed gap wrap math:** unit-tested at the boundary
  (`w1*CW + S + w2*CW` vs `CW`), mirroring the reference packer.
- **Legacy images without `aspectRatio`:** default 1 keeps layout valid; on-load
  measurement backfills real ratios and re-packs; deferred save persists.
- **Spacing change (48→24) shifts existing layouts:** acceptable (visual
  refinement the PRD asked for); migration re-derives layout from stored
  widths/heights.

## Documented Limitations

- Layout remains ordered-flow (no free-form absolute placement); "coordinates"
  are derived and reflow on resize/reorder.
- Reference-image packing is left-justified rows (no full-justify / masonry).
- The plan JSON still lives in the `.preshot` manifest until the storage
  sub-project moves it to `.preshotproj`.
