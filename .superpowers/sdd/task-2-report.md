# Task 2: Persisted Row Layout and Component DnD Report

## Scope

Implemented only Task 2's assigned engine, drop-target, `RowDropZone`, and
`PlanCanvas` source/test files. The requested report is this file.

## RED evidence

1. `pnpm test -- src/domain/plan/canvas/engine.test.ts src/domain/plan/canvas/dropTarget.test.ts`
   failed with 7 expected assertions: persisted rows were auto-compacted, title
   space was not reserved, and the old index-only target API returned `null`.
2. `pnpm test -- src/features/plan/canvas/RowDropZone.test.tsx` failed because
   `RowDropZone` did not exist.
3. `pnpm test -- src/features/plan/canvas/PlanCanvas.test.tsx` failed the new
   row-gap commit case because the old canvas passed an invalid target through
   to `onMoveComponent`.

## GREEN evidence

`pnpm test -- src/domain/plan/canvas/engine.test.ts src/domain/plan/canvas/dropTarget.test.ts src/features/plan/canvas/RowDropZone.test.tsx src/features/plan/canvas/PlanCanvas.test.tsx`

- 4 test files passed
- 61 tests passed
- 0 test failures

The tests cover persisted logical-row placement, document-title reservation,
same/cross-row targets, capacity rejection, row-gap target registration, and
committing a row-gap drop as a generated persisted row target.

## Implementation

- The pure engine now groups consecutive components by `rowId` and optionally
  reserves title space before the first row.
- Drop targeting returns typed row/new-row/invalid results and reuses Task 1
  capacity checks.
- The canvas renders row-gap droppables, previews through `moveComponentInRows`,
  and commits `ComponentMoveTarget` values.

## Self-review

`git diff --check` passed. Reviewed the production and test diffs for scope,
domain purity, invalid-target handling, and stable generated row IDs between
row-gap preview and commit.

## Concern

`pnpm typecheck` currently fails only at the out-of-scope
`src/features/plan/ProjectCanvasProvider.tsx`: its callback still accepts
`toIndex: number`, while this task correctly changes `PlanCanvas` to use
`ComponentMoveTarget`. Task 7 owns that provider integration. PDF title-layout
configuration is likewise owned outside this task's allowed files.
