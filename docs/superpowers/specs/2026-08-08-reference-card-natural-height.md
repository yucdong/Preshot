# Reference Card Natural Height

## Problem

Reference components retained historical or force-fit page heights even when their final image rows occupied only a small portion of the card. The UI correctly rendered image slots at the top, but the persisted card border remained at the old height, leaving large blank areas and unnecessarily pushing following components to later A4 pages.

## Height Contract

For a reference component that fits one printable page:

`card height = max(minimum component height, frame chrome + vertical insets + title/actions + introduction control/editor + final image-row bottom)`

The height converges in both directions:

- adding images, increasing an image frame, or growing the introduction moves the border down;
- deleting images, reducing frames, removing introduction content, or loading an oversized historical card moves the border up;
- when current and natural heights differ by no more than the epsilon, normalization preserves object identity to avoid save loops.

The image grid already calculates its own display height from the maximum bottom edge of all packed slots. The component normalizer uses the same `packReferenceFrames` layout, so the border and visible grid share one geometry source.

## Pagination

- A fitting component is persisted at exact natural height.
- If natural content exceeds one page, existing uniform image scaling runs first.
- If the configured minimum still cannot fit, complete image rows become persisted continuation components.
- Components remain exclusive rows, but two consecutive compact cards share one A4 page whenever `first height + row gap + second height <= printable content height`.

## Current Project

For `小清新人像拍摄`, natural normalization produced:

- `延安西路`: `297.77pt`
- `夏日西瓜`: `397.38pt`
- `上生新所参考图`: `418pt`
- `书店参考图`: `535pt`
- `小乔治咖啡馆`: `688pt`

Their combined height plus one row gap is `719.15pt`, so they would fit together when consecutive. In the current project order, compaction instead produces a denser and more useful flow:

- page 1: `拍摄计划 + 延安西路`, ending at `559.33pt`;
- page 2: `拍摄注意点 + 夏日西瓜`, ending at `696.28pt`.

The pre-normalization manifest is retained as `.preshotproj.pre-reference-autosize-20260808.backup`.

## Verification

- Unit tests prove an oversized fitting card shrinks to its last image row.
- Unit tests prove adding enough images to create another row grows the card again.
- Re-normalizing an exact-height card returns the same plan.
- Document-flow coverage proves the two compact real-project heights remain on one page.
- Full component, browser, type, lint, and production-build validation must pass.
