# Canvas Layout, Crop, and Document Chrome Refinement

## Goal

Refine the shipped A4 planning canvas so its document structure is explicit and
stable across edits, project reloads, and PDF export. The feature adds persisted
row membership, document and component names, non-destructive image cropping,
caption export rules, clearer theme-aware card styling, and a global settings
entry point.

This design implements the twelve requirements in
`docs/design_docs/requirement_0806.md` without replacing the existing ordered
flow canvas, autosave, history, image import, or PDF architecture.

## Confirmed Product Decisions

- Component row membership is persisted. Width changes never move a component
  into another row. Only drag-and-drop can change row membership.
- A component can enter another row only when the target row has enough
  remaining width. Dropping between rows creates a new row.
- Images use free four-edge cropping. Cropping can change aspect ratio, so the
  image width changes while its group-wide image height remains fixed.
- The lightbox always shows the uncropped source image.
- Component names appear in the editable gray top bar and are also rendered as
  component titles in PDF output.
- The canvas title is a fixed first-page document title. It occupies layout
  space, is exported to PDF, defaults to the project name, and can diverge from
  that name after editing.
- Settings moves from the canvas toolbar to the top-right corner of the entire
  workspace.
- Undo and redo buttons are hidden, but existing keyboard shortcuts remain.

## Scope

### In scope

- Plan schema v5 and strict v4-to-v5 migration.
- Persisted document title, component name, row membership, and image crop
  metadata.
- Unique default and edited component names within a project.
- Explicit row layout and row-aware component drag-and-drop.
- Four-edge image crop, live crop preview, reset-to-original action, and
  source-image lightbox.
- Image size wording and minimum-size adjustment.
- Screen-only caption visibility with captions always included in PDF output.
- Global settings placement, PDF button placement, and card visual refinement
  for light and dark themes.
- Screen/PDF parity for document titles, component titles, crop rectangles,
  rows, and captions.
- Domain, component, PDF, end-to-end, migration, and regression tests.
- Feature status updates in `docs/design_docs/featurelist.json`.

### Out of scope

- Free-form absolute positioning.
- Destructive image editing or writing cropped image files.
- Rotation, perspective correction, filters, or focal-point editing.
- Renaming the project when the canvas title changes.
- New component types.
- Removing history support or keyboard shortcuts.
- Replacing the current autosave or persistence ports.

## Requirements Mapping

| Requirement | Design response |
| --- | --- |
| Global settings | Move `SettingsButton` to the workspace composition root. |
| Hide undo/redo | Remove toolbar buttons; retain keyboard history commands. |
| Rename component types | User-facing labels become `文案` and `图片组`. |
| Editable unique defaults | Persist `name`; generate `文案N` and `图片组N`. |
| Remove image-group title editor | Use the component top-bar name as the only group name. |
| Caption behavior | New image groups show captions by default; screen may hide them; PDF always renders non-empty captions. |
| Image sizing | Rename to `图片尺寸`; use 67.5pt minimum, 135pt default, and the existing maximum. |
| Crop and lightbox | Persist normalized crop metadata, add edge handles/reset, and show original source in a lightbox with `×`. |
| Manual row placement | Persist `rowId`; resize stays in row; drag is the only cross-row operation. |
| PDF button | Place at the canvas toolbar's right edge with theme-aware amber emphasis. |
| Card styling | Increase dashed frame contrast and use consistent spacing/elevation. |
| Canvas title | Persist an editable first-page title initialized from the project name. |

## Architecture

The existing dependency direction remains:

```text
React canvas -> pure domain reducers/layout -> domain ports -> infrastructure
```

`src/domain` remains independent from React, DOM, Tauri, and PDF libraries.
Screen and PDF continue to consume the same pure layout result. Tauri continues
to store the plan as opaque JSON and requires no plan-schema business logic.

## Plan Schema v5

```ts
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ReferenceImage {
  id: string;
  file: string;
  caption?: string;
  aspectRatio: number;
  crop?: CropRect;
}

export interface BaseComponent {
  id: string;
  name: string;
  rowId: string;
  width: number;
}

export interface PlanTextComponent extends BaseComponent {
  type: "plan";
  html: string;
}

export interface ReferenceComponent extends BaseComponent {
  type: "reference";
  description: string;
  showCaptions: boolean;
  images: ReferenceImage[];
  imageHeight: number;
}

export interface ProjectPlan {
  schemaVersion: 5;
  title: string;
  components: PlanComponent[];
}
```

The flat `components` collection is retained to minimize disruption to current
reducers, services, history, and rendering. Row membership is explicit through
`rowId`. Components in one row must be contiguous; row order is the order in
which each row ID first appears.

Empty rows are not stored. Removing the final component in a row therefore
removes that row automatically.

### Invariants

- `title`, component IDs, component names, and row IDs are non-empty.
- Component names are unique after trimming within one plan.
- Components sharing a row ID are contiguous.
- Every row fits the content width, including inter-component spacing.
- Width remains in the existing supported continuous range.
- `CropRect` values are finite and normalized to `[0, 1]`.
- `crop.width` and `crop.height` are positive.
- `crop.x + crop.width <= 1` and `crop.y + crop.height <= 1`.
- A crop equal to the complete source rectangle is stored as `undefined`.

Strict persisted-data validation rejects violated invariants with contextual
load errors. Interactive reducers clamp pointer-derived crop values before
creating persisted state.

## Migration

`migratePlan` receives a pure context object:

```ts
interface PlanMigrationContext {
  projectName: string;
  makeId?: (prefix: string) => string;
}
```

The v4-to-v5 migration:

1. Sets `title` to the trimmed project name, or the localized untitled fallback
   supplied by the caller when the project name is empty.
2. Replays current v4 width and spacing rules to identify the rows in which
   components are presently displayed.
3. Assigns one stable generated row ID to every identified row.
4. Converts each existing reference `title` into the component `name`.
5. Generates `文案N` for plan components and `图片组N` for references without a
   usable title.
6. Resolves migrated name collisions by allocating the smallest available
   type-appropriate numeric suffix.
7. Removes the reference `title` field.
8. Leaves image files and image aspect ratios unchanged and omits `crop`.
9. Preserves the existing `showCaptions` choice for migrated components; newly
   inserted reference components default it to `true`.

The existing v1-to-v4 migration chain remains, with v5 applied as the final
step. Forward schema versions still fail closed.

## Pure Domain Operations

### Naming and title

- `setPlanTitle(plan, title)` trims only for validation; it preserves intentional
  internal spaces.
- `nextComponentName(plan, type)` returns the smallest unused `文案N` or
  `图片组N`.
- `renameComponent(plan, id, name)` returns a typed validation result for empty
  or duplicate names and returns the same plan reference on a no-op.

### Rows and width

- `rowsOf(plan)` returns ordered row descriptors without mutating the plan.
- `availableWidthInRow(plan, rowId, excludingComponentId?)` uses the same page
  content width and spacing constants as the layout engine.
- `resizeComponentInRow(plan, { id, width })` clamps width to the component
  limits and the row's remaining capacity. It never changes `rowId`.
- `moveComponentInRows(plan, target)` supports:
  - reorder within the current row;
  - move to an insertion index in another row when capacity allows;
  - move to a newly generated row before or after an existing row.
- Invalid or capacity-exceeding moves return the original plan.

The drag target helper reports a target kind (`within-row`, `existing-row`,
`new-row`, or `invalid`) so the UI can distinguish a valid preview from a
rejected drop.

### Crop

- `normalizeCrop(rect)` clamps finite pointer-derived values and rejects
  degenerate rectangles.
- `setImageCrop(plan, { componentId, imageId, crop })` persists a normalized
  crop and returns the same reference on no-op.
- `resetImageCrop(...)` removes crop metadata.
- `effectiveImageAspectRatio(image)` returns
  `image.aspectRatio * crop.width / crop.height`, or the source ratio when no
  crop is present.

Reference row packing uses the effective ratio. This makes a cropped image keep
the group's configured height while its width and row placement respond to the
new crop.

## Layout

The layout engine groups consecutive components by `rowId`. It lays each
logical row left-to-right without considering unused capacity in earlier rows.
That prevents width changes from compacting a component upward.

The engine validates row capacity and retains current page fragmentation for
long text and reference content. A row's following content begins after the
greatest page/end position reached by its components.

The first page reserves a fixed document-title band before its first logical
row. Other pages do not repeat the document title. Component placements include
a component-title band so screen and PDF use the same vertical geometry.

## User Interface

### Workspace and toolbar

- `SettingsButton` is composed by the workspace shell at the outer top-right.
- The canvas toolbar removes visible undo/redo buttons.
- Insert and save status stay on the left.
- Export PDF moves to the right and uses the existing amber color family with
  separate light/dark contrast values.
- History keyboard handling remains in `ProjectCanvasProvider`.

### Document title

The first page renders an accessible single-line title input in the title band.
Changes participate in history and the existing five-second autosave. The
project name is used only during initial creation or migration; later project
metadata changes do not overwrite an edited title.

### Component frame

The gray top bar renders the component `name` as an editable input and remains
the drag handle outside the input's interactive area. Enter or blur attempts to
commit. Empty or duplicate names remain in edit mode with an accessible inline
validation message.

The top bar's visible type terminology is `文案` or `图片组`. The reference body
no longer renders a separate group-title input.

Frames use a clearly visible dashed border in both themes. Inner text and image
surfaces use restrained elevation. Page inset, frame gaps, and content inset
derive from the existing `SPACING` constant.

### Row drag behavior

During component drag:

- current row insertion points allow reorder;
- target-row insertion points are enabled only when capacity is sufficient;
- row gaps provide new-row drop zones;
- invalid targets show a rejected cursor/preview and do not mutate state;
- preview and commit call the same pure reducer parameters.

### Captions and image size

New reference components set `showCaptions: true`. The toggle remains available
but is labeled as a screen-display control. PDF layout ignores the toggle and
reserves caption space whenever a non-empty image caption exists.

The image control label becomes `图片尺寸`. Its range is:

```text
minimum: 67.5pt
default: 135pt
maximum: existing 400pt
```

The existing increment remains unless usability tests require a smaller step.

### Image crop

An image tile uses an overflow-hidden viewport. Hovering or focusing the tile
reveals four edge handles. Pointer drag:

1. captures the pointer;
2. updates local crop preview;
3. computes the effective aspect ratio;
4. previews reference-row reflow;
5. commits one history entry on pointer release;
6. cancels without mutation on pointer cancellation.

An already cropped tile shows an accessible `恢复原图` action on hover/focus.
Regular tile click continues to open the full uncropped image. Crop handle and
reset interactions stop propagation so they do not open the lightbox or begin
image reorder.

The lightbox close button keeps its accessible name but renders only `×`.

## PDF Export

The PDF exporter consumes the same title band, component-title band, explicit
rows, effective image ratios, and caption geometry as the screen layout.

For cropped images, the exporter:

1. creates a clipping rectangle matching the image slot;
2. scales the full source image so the normalized crop fills that slot;
3. offsets the source according to `crop.x` and `crop.y`;
4. draws inside a saved graphics state;
5. restores the graphics state before drawing subsequent content.

No cropped derivative is written to disk.

Every component name is rendered as a PDF heading. Reference captions are
rendered whenever their trimmed text is non-empty, regardless of
`showCaptions`. Missing source image data or crop-rendering failures abort
export with the existing contextual error flow.

## Error Handling

- Persisted schema errors fail the plan load explicitly; no success-shaped
  fallback replaces user content.
- Empty and duplicate names produce actionable inline validation.
- Capacity-exceeding row drops are non-destructive rejected interactions, not
  persistence errors.
- Pointer cancellation restores the pre-crop state.
- PDF image or clipping failures propagate through the existing export error
  banner and structured logger.
- Settings persistence behavior is unchanged; only composition moves.
- Autosave, project retirement flush, and history cover all v5 metadata.

## Testing

### Domain

- v4-to-v5 migration: title, names, collision suffixes, old reference titles,
  row IDs, order, caption visibility, and crop absence.
- v1/v2/v3 chains terminate at valid v5.
- v5 validation rejects duplicate names, non-contiguous row IDs, over-capacity
  rows, and invalid crop rectangles.
- unique-name generation handles gaps and user-created numeric names.
- row resize never changes membership and clamps to available capacity.
- move within row, move to a fitting row, reject a full row, create a new row,
  delete the final row member, and no-op reference stability.
- crop normalize/set/reset and effective aspect ratio.
- row packing uses cropped aspect ratios.
- first-page title and component-title bands affect placements exactly once.

### Components

- global settings is present at workspace top-right and absent from canvas
  toolbar.
- undo/redo buttons are absent while keyboard history remains functional.
- document title defaults, edits, validates, autosaves, and survives reload.
- component names edit in the top bar; empty/duplicate names are rejected.
- reference body has no second title editor.
- new reference captions are visible by default; screen toggle still hides.
- image size label and 67.5pt minimum.
- crop handles preview/commit/cancel; reset restores source ratio.
- image click opens the uncropped source; lightbox renders `×`.
- light/dark frame contrast and accessible focus states are covered by
  user-visible assertions rather than snapshots.

### PDF

- first-page document title and all component names render.
- rows and component rectangles match the domain layout.
- a cropped image uses the expected clipping/transform commands.
- cropped aspect ratio controls slot width.
- captions render with `showCaptions` both true and false.
- missing image data fails export.

### End to end

- resize a component and verify it remains in its original row.
- drag a fitting component into another row and verify persistence after reload.
- reject a component drop into a full row.
- edit document and component names and verify reload.
- crop an image, verify row reflow, reset it, and open the full source.
- hide captions on screen and export successfully.
- switch light/dark theme through the global settings button.
- export PDF from the right-aligned emphasized action.

### Full validation

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:init
pnpm test:e2e
cargo test --manifest-path src-tauri\Cargo.toml
pnpm build
```

## Parallel Implementation Plan

Implementation uses isolated worktrees and explicit ownership after one shared
schema-contract task.

| Batch | Package | Ownership |
| --- | --- | --- |
| Foundation | Schema v5 contract | `models.ts`, `migrate.ts`, core pure helpers and tests |
| Parallel A | Persisted rows | row reducers, layout engine, drop-target helpers, `PlanCanvas` DnD tests |
| Parallel B | Names and document chrome | title/name UI, component frame, reference-title removal, i18n tests |
| Parallel C | Crop and image UX | crop helper/UI, image tile/grid, size wording, lightbox tests |
| Parallel D | PDF parity | PDF title/name/crop/caption rendering and exporter tests |
| Parallel E | Workspace and theme chrome | workspace settings placement, toolbar actions, frame style tests |
| Integration | Provider and persistence | provider handlers, history/autosave/export wiring, migrations at adapters |
| Acceptance | Cross-feature verification | e2e, full matrix, featurelist update |

Parallel packages must not edit each other's owned files. Shared interface
changes are completed in the foundation batch. Provider wiring is deliberately
reserved for integration to avoid concurrent edits to
`ProjectCanvasProvider.tsx`.

## Acceptance Criteria

- Resizing never changes a component's persisted row.
- A component moves into another row only through a valid drag with enough
  capacity.
- Row membership, title, names, and crop survive project reload.
- New default names are unique and user edits cannot create duplicates.
- Screen and PDF use the same rows, title bands, component names, crop geometry,
  and effective image ratios.
- Hiding captions on screen never removes non-empty captions from PDF.
- The lightbox displays the full source and closes with a visible `×`.
- Settings is available only in the global workspace top-right.
- Undo/redo buttons are absent while keyboard history still works.
- Both themes show clear dashed component frames, consistent spacing, and an
  emphasized PDF action.
- The full validation matrix passes.
