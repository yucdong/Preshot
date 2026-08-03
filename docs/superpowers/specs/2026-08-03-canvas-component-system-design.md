# Canvas Component System (A4 WYSIWYG) Design

## Goal

Turn the middle plan panel into an **A4 WYSIWYG canvas** built from movable,
resizable **components**. Two component types ship: a **Photography Plan**
(rich text) and a **Reference Images** group. Users insert components from a
menu, drag them (by a top handle) to reorder, and resize them (fractional width
+ pixel height). Components flow left-to-right and wrap to the next row; when the
current A4 page is full they continue onto the next A4 page; nothing overlaps or
exceeds the page. A single pure layout engine drives both the on-screen canvas
and a **true WYSIWYG PDF export** (1:1 with the screen). Reference images gain an
optional per-image caption; the plan component seeds a default fill-in template.

This is one spec covering what was scoped as 2A (canvas foundation), 2B (content
features), and 2C (WYSIWYG PDF). The implementation plan will sequence it in
phases.

## Scope

In scope:

- New **component/layout domain model** replacing `{ photographyPlan,
  referenceGroups }`, with pure reducers.
- A **pure layout engine** mapping components → per-page absolute rectangles
  (and per-image slot rectangles), shared by screen and PDF.
- **A4 canvas rendering**: a vertical stack of A4 pages with margins, scaled to
  fit the middle column; components absolutely positioned from the engine.
- **Insert menu** (dropdown beside Export PDF) to add a Plan or Reference
  component.
- **Component drag-to-reorder** (top-bar handle) with WYSIWYG live-reflow
  preview, and **resize** (width snaps to a fraction set; height in points with a
  fit-to-content helper).
- **Two component types**: Plan (BlockNote rich text + default template),
  Reference (title, optional description, image grid with its own
  columns-per-row, existing import/lightbox/remove, **optional per-image
  captions**).
- **Preserved image-level drag-and-drop** within and across Reference components
  (the existing dnd-kit system, adapted from groups to components).
- **Persistence**: schema v2 + a pure one-way **migration** from v1; **Rust
  decoupling** — store the plan as opaque JSON.
- **True WYSIWYG PDF export** consuming the same layout engine.
- All UI text via the existing react-i18next Chinese layer (new keys added).

Out of scope (non-goals):

- Free absolute-position canvas mode (we chose ordered flow).
- Component types beyond Plan and Reference.
- Undo/redo, manual page breaks, multi-select, collaborative editing.
- Rich-text captions (captions are plain multiline text).
- A second locale (Chinese only, per the shipped i18n foundation).

## Decisions (from brainstorming)

- **Layout model:** ordered **flow** layout (not free absolute). Components are an
  ordered list; flow left-to-right; wrap to next row when they don't fit; move to
  next A4 page when the page is full; never split a component across pages; never
  overlap; never exceed the page.
- **Width:** snaps to a **fraction set** `{1, 3/4, 2/3, 1/2, 1/3, 1/4}` of the
  content width.
- **Height:** user-adjustable (points); content fits the box (images contain-fit
  with white padding; text wraps); text overflow scrolls on screen and **clips**
  in print; a **fit-to-content** action measures and writes back a height. Print
  layout is deterministic (fixed slots).
- **Pages:** vertical stack of A4 **portrait** pages with visible boundaries and
  margins; pages auto add/remove; screen == print.
- **Reference component:** each instance = one group (editable title, optional
  description, image grid with its own columns); multiple allowed; **optional
  per-image caption** (~1/3 of the image tile height, editable, prints).
- **PDF:** true WYSIWYG via the shared pure layout engine.
- **Rust:** the `.preshot` `plan` field becomes an opaque `serde_json::Value`
  passthrough; the schema lives only in TS.

## Architecture & Data Flow

The intended flow (unchanged principle): React canvas → domain reducers/engine →
domain port → infrastructure adapter. The domain stays free of React/Tauri.

### Domain model (`src/domain/plan/models.ts`)

```ts
export type WidthFraction = "1" | "3/4" | "2/3" | "1/2" | "1/3" | "1/4";
export const WIDTH_FRACTIONS: WidthFraction[] = ["1", "3/4", "2/3", "1/2", "1/3", "1/4"];
export function fractionValue(f: WidthFraction): number; // "2/3" -> 2/3

export interface ReferenceImage { id: string; file: string; caption?: string }

export interface BaseComponent {
  id: string;
  widthFraction: WidthFraction;
  height: number;              // A4 points (resolution-independent; screen scales)
}
export interface PlanTextComponent extends BaseComponent {
  type: "plan";
  html: string;                // BlockNote HTML
}
export interface ReferenceComponent extends BaseComponent {
  type: "reference";
  title: string;
  description: string;         // BlockNote HTML (compact)
  columnsPerRow: number;       // MIN..MAX (existing clamp)
  showCaptions: boolean;       // per-component caption toggle
  images: ReferenceImage[];
}
export type PlanComponent = PlanTextComponent | ReferenceComponent;

export interface ProjectPlan { schemaVersion: 2; components: PlanComponent[] }
export const EMPTY_PLAN: ProjectPlan = { schemaVersion: 2, components: [] };
```

Heights are stored in **A4 points** (same space as the PDF); the screen multiplies
by a `scale` factor. `WidthFraction` is stored as an exact ratio string to avoid
float drift.

### Pure layout engine (`src/domain/plan/layout/`)

A total, pure function — no DOM, no measurement, exhaustively unit-tested:

```ts
export interface PageGeometry {
  page: { width: number; height: number };  // A4 points (595.28 x 841.89)
  margin: number;                            // content inset (default 48)
  gutter: number;                            // visual inset between components in a row
  rowGap: number;                            // vertical gap between rows
}
export interface Rect { x: number; y: number; width: number; height: number } // page-content-relative points
export interface Placement {
  componentId: string;
  pageIndex: number;
  rect: Rect;                    // outer allotment of the component on its page
  imageSlots?: Rect[];           // for reference components: square image slots (+ caption band folded in)
}
export interface LayoutResult { pageCount: number; placements: Placement[] }

export function layoutPlan(components: PlanComponent[], geometry: PageGeometry): LayoutResult;
```

Algorithm (deterministic):

- `contentWidth = page.width - 2*margin`, `contentHeight = page.height - 2*margin`.
- Cursor `(x, y)`, `rowHeight`, `pageIndex` start at 0.
- For each component in order:
  - `width = fractionValue(f) * contentWidth`; `height = clamp(component.height, MIN_H, contentHeight)`
    (a component can never be taller than one page's content).
  - **Wrap:** if `x + width > contentWidth + EPS`, start a new row: `x=0`,
    `y += rowHeight + rowGap`, `rowHeight=0`.
  - **Page break:** if `y + height > contentHeight + EPS`, start a new page:
    `pageIndex++`, `x=0`, `y=0`, `rowHeight=0`.
  - Place at `rect = { x, y, width, height }` (page-content-relative). Advance
    `x += width`; `rowHeight = max(rowHeight, height)`.
- `pageCount = max(pageIndex)+1` (≥1).
- **Gutter** is applied as a visual inset *inside* each allotment (each renderer
  insets content by `gutter/2`), so fraction widths stay exact (two `1/2` fill a
  row precisely) while adjacent components still show a gap.
- For `type:"reference"`, `imageSlots` are computed purely from the component's
  content rect and `columnsPerRow` (reuse/relocate the existing `squareSlotGrid`
  math): a fixed title band, an optional fixed description band, then square image
  slots row-major; when `showCaptions`, each slot reserves a caption band of
  ~1/3 its height. Sub-part heights are **geometry-driven (not text-measured)**;
  overflowing text clips within its band, keeping the engine pure and the PDF
  identical to the screen.

Both the on-screen canvas and the PDF exporter call `layoutPlan` with the same
geometry, guaranteeing 1:1 output.

### Reducers (`src/domain/plan/plan.ts`)

Pure, return the same reference on no-op:

- `addComponent(plan, component)` — append.
- `removeComponent(plan, id)`.
- `moveComponent(plan, { id, toIndex })` — reorder (post-removal index, mirrors
  the image `moveImage` semantics).
- `resizeComponent(plan, { id, widthFraction?, height? })` — set width fraction
  (snapped) and/or height (clamped to `[MIN_H, contentHeight]`).
- `updatePlanHtml(plan, { id, html })`.
- Reference sub-ops: `setReferenceTitle`, `setReferenceDescription`,
  `setReferenceColumns` (clamped), `toggleReferenceCaptions`, `addReferenceImage`,
  `removeReferenceImage`, `setImageCaption(plan, { componentId, imageId, caption })`.
- `moveImage(plan, { fromComponentId, imageId, toComponentId, toIndex })` — the
  existing within/across reference-component image move (renamed group→component).

`MoveImageParams` and the pure `dropTarget` helpers are adapted from
group ids to reference-component ids; the WYSIWYG image-drop-preview behavior is
preserved.

### Persistence & migration

- **Migration** (`src/domain/plan/migrate.ts`, pure, total, unit-tested):
  `migratePlan(raw: unknown): ProjectPlan`.
  - `{ schemaVersion: 2, components: [...] }` → normalize/validate (drop invalid
    components, default missing fields, clamp).
  - v1 `{ photographyPlan, referenceGroups }` (no/other version) → convert:
    non-empty `photographyPlan` → one full-width `plan` component (default
    height); each `referenceGroup` → one full-width `reference` component
    (title/description/columnsPerRow/images preserved, `caption` unset,
    `showCaptions:false`, default height); order = plan first, then groups.
  - anything else → `EMPTY_PLAN`. Never throws.
- **Adapters:** `tauriPlan.loadPlan` and `browserPlan` read raw JSON and return
  `migratePlan(raw)`; `savePlan` serializes the v2 `ProjectPlan`. Image files on
  disk are unchanged (`references/`, `file`); `caption` is new plan metadata.
- **Rust decoupling** (`src-tauri/src/workspace.rs`, `plan.rs`): change
  `ProjectManifest.plan` to `Option<serde_json::Value>`; `save_project_plan(plan:
  serde_json::Value)` stores it verbatim; `read_project_plan() -> serde_json::Value`
  returns it (default `null`/empty). Rust no longer types the plan (schema lives
  in TS); update Rust tests to assert opaque round-trip via `serde_json::json!`.
  This satisfies AGENTS.md (Rust commands: serializable, narrow, no business
  rules) and removes TS/Rust schema coupling for this and future changes.

### Canvas UI (`src/features/plan/`)

- **`PlanPanel`** header keeps Export PDF + SaveStatus and adds an **Insert
  component** dropdown (`插入组件 ▾` → `摄影计划` / `参考图组`). Selecting appends
  a new component (Plan seeded with the default template; Reference with a default
  title, empty grid, `showCaptions:false`).
- **`PlanCanvas`** renders a scrollable stack of **A4 page surfaces** (white,
  visible margin guides, gaps between pages), sized by a `scale` = availableWidth
  / A4.width. It calls `layoutPlan(view, geometry)` and absolutely positions each
  component at `rect * scale` on its page. `view = preview ?? components` (optimistic
  during drag/resize).
- **`ComponentFrame`** wraps each component: a **top bar** (drag handle + delete;
  Reference adds a columns control + caption toggle), the content, and **resize
  handles** (right = width, bottom = height, corner = both; a fit-to-content
  affordance on the bottom handle).
  - **Move:** dragging the top bar computes an insertion index among components
    from the pointer (a pure `componentDropTarget`), previews via `moveComponent`
    on an optimistic copy (live reflow), commits on release, reverts on
    cancel/no-change — mirroring the image drop-preview pattern.
  - **Resize width:** dragging the right handle snaps to the nearest
    `WidthFraction`; live preview reflows.
  - **Resize height:** dragging the bottom handle changes points (min height,
    clamped to one page), snapped to a small step; corner = both.
  - **Fit to content:** measures the content's natural height (DOM), converts to
    points, writes back via `resizeComponent`.
- **Nested DnD:** one `DndContext`; draggables carry `data.type` =
  `"component"` (top-bar handle) or `"image"` (reference tile). Component drags
  reorder components; image drags reorder/move images within/across reference
  components (existing behavior). Pointer-activation distance keeps clicks
  (lightbox) working.
- **Component content:**
  - Plan: the existing BlockNote `RichTextEditor` (zh) filling the frame.
  - Reference: title input, optional description (compact editor), the image grid
    (existing tiles: add/import, open lightbox, remove ×), and — when
    `showCaptions` — a caption box (~1/3 tile height) under each image bound to
    `image.caption`.
- **State (`ProjectPlanProvider`)** holds `components`, an optimistic `preview`
  during drag/resize, the `scale`, and the existing 5s change-detected auto-save;
  handlers call the reducers. Image loading (`references/`) is unchanged.

### Component types

- **Photography Plan** — inserted with a default Chinese template (from an i18n
  content key), an editable fill-in form: `拍摄时间：` / `拍摄地点：` /
  `道具和服装：` / `器材：`. Fully editable thereafter.
- **Reference Images** — title + optional description + image grid; per-component
  `showCaptions` toggle. When on, every tile reserves a caption band (~1/3
  height), each caption editable independently (empty allowed; the band still
  reserves space to keep the grid/print slots uniform). Captions persist in
  `image.caption` and render on screen and in PDF.

### WYSIWYG PDF export (`src/domain/plan/pdf/`, `src/infrastructure/pdf/`)

- Replace the independent section geometry with a renderer that consumes
  `layoutPlan(components, geometry)` (A4 points):
  - For each `Placement`, draw within `rect` (inset by `gutter/2`):
    - `plan`: render its BlockNote HTML via the existing HTML→runs pipeline
      (`htmlToBlocks` + pdf-lib run rendering with marks), top-down, clipped to
      the rect.
    - `reference`: draw the title band, optional description band (HTML→runs),
      then for each `imageSlot` draw the image contain-fit with white padding and
      a light-gray frame (reuse `containSize` + the frame), and, when
      `showCaptions`, the caption text in the slot's caption band.
  - Page count and each component's page come from the engine → PDF pages ==
    engine pages == screen pages.
- A4 size / margin / gutter / rowGap are **shared domain constants** used by both
  the screen and the PDF. Chinese text uses the bundled Noto Sans SC.
- `document.ts`/`geometry.ts` are refactored to feed from the layout engine; the
  rich-text run rendering is reused.

## Error Handling

- Layout engine, reducers, and migration are **pure and total**: invalid inputs
  are clamped or dropped, unknown component types are ignored, no throws.
- Migration is defensive: partial/malformed old data is best-effort migrated
  (drop invalid components, default missing fields), never throwing.
- Persistence and PDF failures surface via the existing **generic Chinese error
  banner** (`errors.plan`); raw messages stay English in logs.
- Auto-save remains change-detected (skip writes when unchanged); a move/resize is
  pure metadata committed through the provider → deferred save.

## Testing

- **Domain (pure, exhaustive):**
  - `layoutPlan`: single/multi row wrapping at each fraction; page breaks (fill a
    page, overflow to next); no component split across pages; gutter inset keeps
    fraction fitting exact; height clamp to one page; reference `imageSlots` for
    various columns, with/without description and captions; empty plan → 1 page.
  - Reducers: add/remove/move/resize/update; reference sub-ops; `setImageCaption`;
    `moveImage` within/across components; no-op returns same ref.
  - `migratePlan`: v2 passthrough/normalize; v1 → v2 (plan + groups + images +
    order); empty; malformed/partial.
  - `componentDropTarget` / adapted image `dropTarget`: insertion indices.
- **Component tests (jsdom):** canvas renders placements onto pages; insert menu
  adds each type; width resize snaps to fractions; fit-to-content sets height;
  caption toggle shows/hides caption boxes; accessible names (Chinese). dnd-kit
  pointer drags aren't simulable in jsdom → drop/resize math is pure-unit-tested;
  real drags are e2e.
- **E2E (Playwright):** insert a Plan and a Reference component; drag-reorder
  components by the top bar (WYSIWYG preview → commit → order asserted); resize a
  component's width (fraction change asserted); add an image and type a caption;
  overflow content to a second A4 page; export a PDF (succeeds); existing image
  within/across reference-component drag still commits.
- **Rust:** `save_project_plan`/`read_project_plan` round-trip an opaque
  `serde_json::Value` unchanged; default when absent.
- **PDF:** the exporter reflects the layout — page count and component/​image
  rects come from `layoutPlan`; a focused test asserts a representative plan
  produces the expected pages/rects (reuse existing pdf test patterns).
- All new UI strings are i18n keys (Chinese); a smoke assertion covers the insert
  menu / component chrome / default template / caption placeholder keys.

## Risks & Mitigations

- **Rich-text reflow parity (screen vs pdf-lib):** block/component **rects** are
  identical (shared engine), but line wrapping inside a text box can differ
  slightly due to font metrics. Mitigation: identical fonts (Noto Sans SC), same
  rect + clipping; documented as a minor caveat. Block positions/sizes and image
  slots are pixel-faithful.
- **Nested DnD conflicts (component vs image):** distinguish by `data.type` and
  separate handles (top bar vs tile); preserve pointer-activation distance so
  clicks still open the lightbox. Covered by e2e for both drag kinds.
- **Migration correctness:** pure `migratePlan` with exhaustive tests; one-way and
  defensive; never throws.
- **Height/overflow UX (text clipping):** fit-to-content helper + on-screen scroll
  reduce surprise; print clips per the agreed model.
- **Engine/measurement boundary:** the engine consumes explicit geometry only
  (fraction width + point height); the sole measurement is the fit-to-content
  action, keeping the engine pure and WYSIWYG guaranteed.
- **Scope size:** large feature; the implementation plan sequences it in phases
  (model+engine → persistence/migration+Rust → canvas render+insert →
  component DnD/resize → component types+captions+template → WYSIWYG PDF), each
  independently testable.

## Documented Limitations

- One-way v1→v2 migration: once saved as v2, older app versions cannot read the
  `.preshot`.
- Text that exceeds its component box is clipped in print (by design); use
  fit-to-content or enlarge the component.
- Intra-box text line-wrapping may differ subtly between screen and PDF; layout
  rectangles do not.
- Captions are plain multiline text (not rich text). Flow layout only (no free
  absolute positioning); no undo/redo or manual page breaks.
