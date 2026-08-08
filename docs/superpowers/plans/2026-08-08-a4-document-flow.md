# A4 Document Flow Implementation Plan

**Goal:** Deliver a schema-v8 A4 WYSIWYG document flow with one component per
row, sortable component order, non-crossing components, and persisted image/text
continuations.

## Constraints

- Use TDD and run the smallest focused Vitest file after each production edit.
- Preserve `React UI -> domain use case -> domain port -> infrastructure`.
- Keep layout geometry in A4 points; screen scale must not enter persistence.
- Do not alter or remove unrelated `.github/prompts` worktree changes.
- Update `featurelist.json` incrementally while this feature is in progress.

## Task 1: Pure single-column A4 flow

- [x] Add `documentFlow.test.ts` for row exclusivity and intact page moves.
- [x] Add pure `layoutDocumentFlow` with title reservation and A4 bounds.
- [x] Reject an oversized unsplit component instead of rendering it across pages.
- [x] Add edge cases for empty plans and first-page title rollover.
- [ ] Add custom-geometry coverage when the active surface integration begins.

## Task 2: Schema v8 and migration

- [x] Add v8 model with `x/width/height` and no persisted `y`.
- [x] Migrate v7 by stable `y`, `x`, original-index ordering.
- [x] Keep v1-v6 migration chaining through v7 into v8.
- [x] Update strict validation, fixtures, history merge, and browser seed data.

## Task 3: Component reorder

- [x] Add a pure `reorderComponent(plan, activeId, overId)` reducer.
- [x] Replace coordinate-move callbacks with sortable reorder callbacks.
- [x] Render source placeholder and compact overlay; preserve reduced motion.
- [x] Cover pointer ordering in component and Playwright tests.
- [ ] Add a dedicated dnd-kit KeyboardSensor reorder smoke test.

## Task 4: Active paged A4 surface

- [x] Feed v8 components through `layoutDocumentFlow` in `PlanCanvas`.
- [x] Restore A4 page backgrounds, printable margins, and page gaps.
- [x] Keep width/height edge resizing while deriving vertical positions.
- [x] Add desktop/narrow-window visual and page-boundary assertions.

## Task 5: Reference continuation normalizer

- [x] Add pure proportional group scaling with a `67.5pt` minimum image height.
- [x] Split only between complete rows and move image records without file copies.
- [x] Generate unique continuation ids and `(2)`, `(3)` names.
- [x] Commit normalization and initiating mutation as one history entry.

## Task 6: BlockNote continuation normalizer

- [x] Add top-level block-preserving HTML split utilities.
- [x] Use runtime measurements to select the largest fitting block prefix.
- [ ] Add line-level fallback for one block taller than a full page.
- [x] Ensure generated editors load independently without hydration echoes.

## Task 7: PDF parity and persistence

- [ ] Remove the temporary v7-to-v6 PDF layout adapter.
- [x] Preserve v8 exclusive rows, horizontal offsets, persisted continuations, and A4 geometry in PDF.
- [x] Validate complete image readiness and reject any oversized component.
- [x] Cover page count, margins, order, names, and image geometry.

## Task 8: Final verification

- [x] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm test:e2e`.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml` and `pnpm build`.
- [x] Verify `featurelist.json` parses and update in-progress status.