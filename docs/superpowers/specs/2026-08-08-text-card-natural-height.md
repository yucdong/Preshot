# Text Card Natural Height

## Problem

Schema v8 uses persisted continuation components for pagination, but the text measurement hook still inserted legacy page-break spacer margins inside one BlockNote editor. Those spacers were counted as editor overhead, producing cards hundreds of points taller than their visible text and splitting a fitting numbered list into multiple false continuation cards.

A second grow-only condition kept any historically oversized card from shrinking when its content became shorter.

## Height Contract

For a fitting plan component:

`card height = max(minimum component height, frame chrome + editor overhead + measured top-level block heights)`

The card converges to that value in both directions:

- adding text, list items, or larger wrapped number markers grows it;
- deleting text or reducing wrapping shrinks it;
- a change smaller than the measurement epsilon preserves object identity to avoid save loops.

BlockNote DOM measurements are authoritative. Numbered-list indentation and wrapping are naturally reflected in each top-level block's measured height.

Schema v8 plan components may optionally persist `contentScale` in the existing validated `0.5–2` range. Components without the field render at `1`. A scale below `1` uses compensated editor width on screen and the same legacy PDF layout scale, so force-fit behavior remains screen/PDF consistent without changing other projects.

## Pagination Contract

- The editor never inserts visual page spacers or dashed page-break margins.
- `usePlanContentMeasurement` reports natural editor height and top-level block heights only.
- `normalizePlanContinuations` splits content at BlockNote top-level block boundaries when natural height exceeds one printable A4 content page.
- Each continuation is a persisted, editable, sortable component named `(2)`, `(3)`, and so on.
- One indivisible block taller than a page continues to fail closed until visual-line splitting is implemented.

## Existing Project Repair

The first faulty migration of `小清新人像拍摄` produced false numbered components. Preserve that v8 manifest for diagnosis, restore the verified original v7 plan, and re-run migration with the corrected measurement pipeline. The user then explicitly selected merge-all plus force-fit:

- merge `拍摄注意点 (2)` and `(3)` into the base component using the verified original HTML and persist `contentScale: 0.7`;
- merge `延安西路 (2)` into the base image group and uniformly halve its image frames;
- remove all `(2)` and `(3)` components while preserving base IDs and all image records.

## Verification

- Unit coverage proves a short list shrinks from a historical page-height card and grows again when measured wrapping increases.
- Hook coverage proves absolute placement near a page boundary never changes natural height or adds `bn-page-break-before`.
- The real project must contain only the original plan components unless its measured text genuinely exceeds one page.
- All persisted component heights must be within one A4 content page and the reference image multiset must remain unchanged.
