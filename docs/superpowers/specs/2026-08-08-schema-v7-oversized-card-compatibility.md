# Schema v7 Oversized Card Compatibility

## Problem

Schema v7 represented a continuous free canvas. Historical reference components could therefore persist heights larger than one printable A4 content page. The schema v8 migration already clamps those temporary card heights before reference normalization, but the v7 parser rejected the oversized height before migration could run.

The real project `小清新人像拍摄` exposed this mismatch with a valid v7 reference component height of `1120.451pt`.

## Compatibility Contract

- Schema v7 card height must be finite and at least `MIN_COMPONENT_HEIGHT`; it has no A4-page maximum because v7 is a continuous canvas.
- Existing v7 strict checks remain: known fields only, valid horizontal bounds, non-negative coordinates, valid component/image fields, and unique logical IDs and names.
- During v7 to v8 conversion, component height is clamped to the printable A4 content height.
- After loading, the existing reference normalization pipeline recalculates natural height, uniformly shrinks images to the 67.5pt minimum, and creates persisted continuation components at complete image-row boundaries when needed.
- Schema v8 remains strict. New v8 data cannot contain `y`, unknown fields, invalid bounds, or unsupported future schema versions.

## Persistence And Recovery

Migration and normalization happen in memory first. The provider compares the migrated result with the stored snapshot and marks it unsaved when structural changes exist. The existing serialized save path writes schema v8 only after successful loading.

Before repairing the current project, preserve the original manifest as `.preshotproj.schema-v7-20260808.backup`. Reference images are not copied or modified by schema migration.

## Verification

- Regression test uses a minimized v7 reference component matching the real `1120.451pt` shape.
- Migration/schema/continuation/service tests must pass.
- A local probe runs the complete real manifest through `migratePlan` and `normalizeReferenceContinuations` without writing it.
- After application startup and save, the live manifest must report schema v8 while the backup remains schema v7.
