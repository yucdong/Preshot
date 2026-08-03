# Canvas Phase C — Content features (captions, plan template, description, PDF size)

Executes the content half (2C) of the approved canvas design
(`docs/superpowers/specs/2026-08-03-canvas-component-system-design.md`) now that
Phases A (pure domain) and B (wiring + WYSIWYG PDF) have shipped to `main`.

## Context

The v2 A4 canvas is live: `ProjectCanvasProvider` renders `PlanCanvas`, which
lays components out with the pure `layoutPlan` engine and exports a WYSIWYG PDF
via `canvasPdfExporter`. All Phase-A domain pieces already exist and are tested:
the reducers `toggleReferenceCaptions`, `setImageCaption`, `moveImage`
(`src/domain/plan/canvas/plan.ts`), the caption-band geometry
`slotCaptionSplit` + `referenceImageSlots` (`engine.ts`), and the model fields
`ReferenceComponent.showCaptions` + `ReferenceImage.caption?`
(`canvas/models.ts`). The exporter already draws the caption text when
`showCaptions && caption` (`canvasPdfExporter.ts`), using the pure
`slotToPageRect` helper fixed at the end of Phase B.

**What is missing is the UI/content wiring**, which this phase adds:
1. inserting a Plan component seeds an empty `html: ""` — it should seed a
   default Chinese fill-in template;
2. `showCaptions` is always `false` with no toggle, and `image.caption` has no
   editor — captions are unreachable on screen;
3. a reference description editor only renders when the description is already
   non-empty — new components can never gain one;
4. the PDF embeds the CJK font with `subset: false`, producing ~14 MB files.

**Wiring pattern (established, follow exactly):** pure metadata mutations
(title/columns/description) are applied CLIENT-SIDE in `ProjectCanvasProvider`
via a reducer + `applyPlan(...)`; the 5 s change-detected auto-save persists
them. Only file-side-effect ops (import/remove image, remove component) go
through `CanvasPlanService`. Caption toggle, `setImageCaption`, and the plan
template all follow the client-side metadata pattern — NO new service methods.

## Global Constraints (binding — copy into every reviewer prompt)

- All new UI strings are i18n keys added to `src/shared/i18n/locales/zh.ts`
  (Chinese); components read them via `useTranslation`. No hardcoded UI text.
- Follow the client-side metadata-mutation pattern: reducer + `applyPlan` in
  `ProjectCanvasProvider`; do NOT add service methods for captions/template.
- Captions are PLAIN multiline text (a `<textarea>`), NOT rich text. Empty is
  allowed; the caption band still reserves space so print slots stay uniform.
- The caption box is ~1/3 of the image tile height and sits directly under each
  image, bound to `image.caption`.
- The Plan default template is a single i18n key `content.planTemplate` holding
  BlockNote-compatible HTML with exactly these four editable lines, each on its
  own paragraph: `拍摄时间：` / `拍摄地点：` / `道具和服装：` / `器材：`. It is
  fully editable thereafter (it is ordinary component HTML, not locked).
- Do not change the layout engine (`src/domain/plan/canvas/geometry.ts`,
  `engine.ts`) or the `slotToPageRect` mapping. Caption geometry already exists
  and is tested; this phase only renders into it.
- jsdom cannot drive dnd-kit pointer drags; interaction math is unit-tested and
  real drags are Playwright e2e. Co-locate Vitest as `*.test.ts(x)`.
- Every task keeps the whole suite green (`pnpm typecheck`, `lint`, `test`) and
  lists its validation. Commit trailer:
  `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

## Task C1: Plan component default template

**Files:** `src/shared/i18n/locales/zh.ts` (+ its type/companion if any),
`src/features/plan/ProjectCanvasProvider.tsx` (+ `.test.tsx`).

**Interfaces:** `handleInsert("plan")` currently seeds `html: ""`. Seed it with
the template HTML from a new i18n key.

- [ ] **Steps (TDD):**
  1. Add `content.planTemplate` to `zh.ts` = the BlockNote-compatible HTML
     `"<p>拍摄时间：</p><p>拍摄地点：</p><p>道具和服装：</p><p>器材：</p>"`.
  2. In `ProjectCanvasProvider.handleInsert`, when `type === "plan"`, set
     `html: t("content.planTemplate")` instead of `""`.
  3. Test (component or a focused unit around the insert handler): inserting a
     plan component seeds HTML containing 拍摄时间/拍摄地点/道具和服装/器材; the
     i18n key resolves (not the raw key string). Keep existing insert tests
     green. Validation: the provider test file + `pnpm typecheck`, `lint`.

## Task C2: Caption toggle + reducer wiring (provider → canvas → reference view)

**Files:** `src/features/plan/ProjectCanvasProvider.tsx` (+test),
`src/features/plan/canvas/PlanCanvas.tsx`,
`src/features/plan/canvas/ReferenceComponentView.tsx` (+test if present),
`src/shared/i18n/locales/zh.ts`.

**Interfaces:** import `toggleReferenceCaptions` and `setImageCaption` from
`domain/plan/canvas/plan`. Add two client-side handlers mirroring
`handleSetColumns` (reducer + `applyPlan`): `handleToggleCaptions(id)` and
`handleSetImageCaption(componentId, imageId, caption)`. Thread both as new props
through `PlanCanvas` (`onToggleCaptions`, `onSetImageCaption`) to
`ReferenceComponentView`.

- [ ] **Steps (TDD):**
  1. Add i18n keys: `reference.showCaptions` = "显示说明" (toggle-on label) and
     `reference.hideCaptions` = "隐藏说明" (or a single `reference.captions`
     label + a checkbox — implementer's call, but Chinese + accessible).
  2. Provider: add the two handlers (client-side reducer + `applyPlan`); pass
     them into `PlanCanvas`.
  3. `PlanCanvas`: add `onToggleCaptions?` and `onSetImageCaption?` to
     `PlanCanvasProps`; forward to `ReferenceComponentView`.
  4. `ReferenceComponentView`: render a caption toggle (checkbox/button, Chinese
     accessible name) next to the columns control, calling `onToggleCaptions`
     with the component id; reflect `component.showCaptions`.
  5. Tests: toggling calls the handler and flips `showCaptions` (reducer already
     unit-tested — here assert the WIRING: the control renders with the right
     accessible name and invokes the callback). Keep existing tests green.
     Validation: the touched component/provider tests + `pnpm typecheck`, `lint`.

## Task C3: Per-image caption boxes on screen

**Files:** `src/features/plan/GroupImageGrid.tsx` (+`.test.tsx`),
`src/features/plan/SortableImageTile.tsx` (+`.test.tsx` if present),
`src/features/plan/canvas/ReferenceComponentView.tsx`,
`src/shared/i18n/locales/zh.ts`.

**Interfaces:** `GroupImageGrid` currently takes `group`, `imageSrc`,
`onAddImage`, `onRemoveImage`, `onOpenImage`, `enableReorder?`. Add
`showCaptions?: boolean` and `onSetCaption?(imageId: string, caption: string)`.
`ReferenceComponentView` passes `showCaptions={component.showCaptions}` and
`onSetCaption={(imageId, caption) => onSetImageCaption(component.id, imageId, caption)}`.
The `GroupLike` interface must widen to expose each image's optional `caption`.

- [ ] **Steps (TDD):**
  1. Add i18n key `content.captionPlaceholder` = "补充拍摄说明…" (or similar) and
     `reference.captionAria` = "图片说明 {{index}}".
  2. Widen `GroupLike.images` to `{ id: string; file: string; caption?: string }`.
  3. When `showCaptions`, render under each tile a `<textarea>` (~1/3 tile
     height; the tile is `aspect-square w-full`, so a caption box roughly a third
     of that height) bound to the image's `caption ?? ""`, with a Chinese
     `aria-label` (index-based) and placeholder; `onChange` calls `onSetCaption`.
     Empty is allowed. When `showCaptions` is false, render exactly as today.
  4. Keep the tile drag/open/remove behavior unchanged (the textarea must stop
     pointer/keydown propagation so typing doesn't trigger drags or the
     lightbox).
  5. Tests: with `showCaptions`, a caption textarea renders per image with the
     accessible name and current value, and typing calls `onSetCaption`; without
     it, no textarea renders and the grid is unchanged. Validation: the grid/tile
     tests + `pnpm typecheck`, `lint`.

## Task C4: Verify PDF caption rendering + focused test

**Files:** `src/infrastructure/pdf/canvasPdfExporter.test.ts` (extend), possibly
a small pure test around `slotCaptionSplit` usage (no production change expected
unless a real defect surfaces).

**Interfaces:** the exporter already computes `slotCaptionSplit(slot, showCaptions)`
and draws the caption via `slotToPageRect(contentRect, split.caption)` when
`showCaptions && images[i].caption`. Confirm it is correct end-to-end and lock it
with a test.

- [ ] **Steps (TDD):** Add an exporter test that builds a reference component
  with `showCaptions: true` and images carrying captions, exports, and asserts
  the PDF is produced without error and has the expected page count; and a pure
  assertion that for a captioned slot `slotCaptionSplit` yields an image band +
  a non-zero caption band below it (image stays ~square). If a real rendering
  defect is found (e.g. caption drawn outside its band), fix ONLY that in the
  exporter. Do not alter engine geometry. Validation: `canvasPdfExporter.test.ts`
  + `pnpm typecheck`, `lint`.

## Task C5: "Add description" affordance for reference components

**Files:** `src/features/plan/canvas/ReferenceComponentView.tsx` (+test if
present), `src/shared/i18n/locales/zh.ts`.

**Interfaces:** today the description editor renders only when
`component.description.trim()` is truthy, so a new component (seeded
`description: ""`) can never gain one. Add an affordance.

- [ ] **Steps (TDD):** Add i18n key `reference.addDescription` = "添加描述". When
  `description` is empty, render an "添加描述" button that, when clicked, reveals
  the compact `RichTextEditor` (e.g. by seeding a minimal non-empty value like
  `"<p></p>"` via `onSetDescription`, or a local "show editor" state — the
  editor must then persist edits through `onSetDescription` as today). When
  `description` is non-empty, render the editor as today (no button). Test: with
  an empty description the button renders and clicking it reveals the editor;
  with a non-empty description the editor renders and no button. Validation: the
  view test + `pnpm typecheck`, `lint`.

## Task C6: Restore font subsetting to shrink PDFs (clip-before-measure)

**Files:** `src/infrastructure/pdf/canvasPdfExporter.ts` (+`.test.ts`).

**Interfaces:** the exporter embeds the CJK font with `subset: false` (full
font, ~14 MB PDFs) because `drawRichText` calls `font.widthOfTextAtSize()` while
line-breaking, which registers glyphs in the CFF subset, but clipped lines
(cursor past the rect bottom) are never drawn — and `@pdf-lib/fontkit`'s
`CFFSubset.encode` then throws `RangeError` for the phantom glyphs. The fix is
clip-BEFORE-measure.

- [ ] **Steps (TDD):**
  1. Re-add a test (or un-skip/strengthen the existing multi-page CJK export
     test) that exports a multi-page plan with long CJK text AND asserts the
     resulting PDF byte length is well under the full-font size (e.g. `< 2_000_000`)
     — this fails with `subset: false` and would throw with a naive
     `subset: true`.
  2. In `drawRichText`, before calling `widthOfTextAtSize` for a
     token/line, if the current cursor Y is already past the rect's bottom
     (the line would be clipped and never drawn), STOP tokenizing/measuring that
     block (break out) so no phantom glyph is registered. Keep the visible output
     identical (already-clipped lines were dropped before).
  3. Switch both `embedFont(..., { subset: false })` calls back to
     `{ subset: true }`.
  4. Validation: `canvasPdfExporter.test.ts` (all cases incl. multi-page CJK and
     the size assertion) green, non-flaky; `pnpm typecheck`, `lint`. Update the
     inline comment that references the subset bug.

## Task C7: e2e, featurelist, and full-matrix validation

**Files:** `e2e/canvas.spec.ts` (extend), `docs/design_docs/featurelist.json`.

- [ ] **Steps:**
  1. Extend `e2e/canvas.spec.ts`: (a) inserting a Plan component shows the
     template lines (拍摄时间/…); (b) inserting a Reference component, toggling
     captions on, adding an image, and typing a caption persists (SaveStatus
     flips to unsaved) and the caption textarea shows the typed value; (c)
     exporting the PDF still succeeds with captions on. Keep the existing canvas
     e2e green.
  2. Update `docs/design_docs/featurelist.json` "Canvas Component System" entry:
     move captions + plan template + add-description from deferred to delivered
     in `feature_descriptions`/`decisions`; note the reduced PDF size; update the
     `remaining` array (image reorder + slot-overflow remain, see Phase D);
     refresh `lastVerified`. Validate the JSON parses.
  3. Run the FULL matrix: `pnpm typecheck`, `pnpm lint`, `pnpm test`,
     `pnpm test:e2e`, `cargo test --manifest-path src-tauri\Cargo.toml`,
     `pnpm build`. All green. Commit
     `feat(canvas): reference captions, plan template, add-description, PDF subsetting`.

## Self-Review Notes

- **Spec coverage (2C):** default plan template ✓ (C1); per-component caption
  toggle + per-image editable caption boxes on screen ✓ (C2, C3) and in PDF ✓
  (already drawn; verified C4); reference description reachable for new
  components ✓ (C5). PDF size regression fixed ✓ (C6). e2e + featurelist ✓ (C7).
- **Client-side pattern honored:** captions/template use reducers + `applyPlan`,
  no new service methods; only existing file-op service methods persist images.
- **Green-at-every-task:** each task lists focused validation; C7 runs the full
  matrix + build.
- **Deliberately deferred to Phase D (separate plan):** within-group image
  drag-reorder re-wiring (the pure `moveImage` reducer exists + is tested, but
  the v1 2-D image drop-target math was deleted in Phase B B8 and must be
  re-implemented as a pure helper + nested image `DndContext` that dispatches
  `moveImage`, re-enabling `GroupImageGrid enableReorder`); and the ~6 pt
  horizontal slot overflow (slots computed on full `rect.width` but drawn from
  the gutter-inset `contentRect.x`). Both are noted in `featurelist.remaining`.

## Next Phase (Phase D — separate plan, after C ships)

- Re-wire within-group (and cross-component) image reordering in the canvas:
  a pure grid drop-target helper + `data.type: "image"` drags dispatched to
  `moveImage`, `GroupImageGrid enableReorder` re-enabled, e2e for a committed
  reorder. Fix the ~6 pt horizontal image-slot overflow so PDF slots sit inside
  the gutter-inset content box (match the screen's padded grid). Update
  featurelist.
