# Task 4 Report — Image Crop and Size UX

## Status
Implemented the Task 4 UI scope in the assigned image tile, grid, lightbox, and crop overlay files. Provider and canvas wiring remain intentionally deferred to Task 7.

## TDD record
- RED: the required focused suite failed because `ImageCropOverlay` and crop controls did not exist; the image remained `object-contain`; and the lightbox showed `关闭` instead of `×`.
- RED: the lost-pointer-capture regression test failed with `onCancel` receiving zero calls before the handler was added.
- RED: the active-drag preview test failed with source width `100%` instead of `133.33333333333334%` before tile preview state was connected.
- GREEN: focused suite passes with 37 tests in 4 files.

## Validation
- `pnpm test -- src/features/plan/ImageCropOverlay.test.tsx src/features/plan/SortableImageTile.test.tsx src/features/plan/GroupImageGrid.test.tsx src/features/plan/ReferenceImageLightbox.test.tsx`
- `pnpm typecheck`
- `git diff --check`

## Self-review
Confirmed four accessible handles, one commit per pointer release, cancellation/lost-capture rollback, reset visibility, clipped non-destructive source positioning, and propagation isolation from lightbox opening and sortable listeners. No Task 4 scope issues found.

## Concern
Task 7 must connect the optional crop callbacks to provider persistence/history; this task deliberately does not edit provider or canvas wiring.

## Review follow-up — callback gating
- RED: added regressions for `onSetCrop`-only and `onResetCrop`-only tiles; the focused SortableImageTile test run failed 2 tests because the overlay rendered with either callback.
- GREEN: `SortableImageTile` now renders `ImageCropOverlay` only when both callbacks are supplied; updated existing crop interaction tests to provide both callbacks. SortableImageTile tests pass (15 tests).
- Focused Task 4 suite: `pnpm test -- src/features/plan/ImageCropOverlay.test.tsx src/features/plan/SortableImageTile.test.tsx src/features/plan/GroupImageGrid.test.tsx src/features/plan/ReferenceImageLightbox.test.tsx` — 4 files, 39 tests passed.
- Typecheck: `pnpm typecheck` — passed.