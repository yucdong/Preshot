# PDF gallery pagination acceptance

[Documentation index](../README.md) · [Export guide](../features/exports.md)

Date: 2026-09-30. Scope: production BlockNote / React-PDF image-group pagination.

## Task understanding

A photographer exports a plan containing notes followed by a large image group.
The group must start below the notes if a complete image row fits, and continue
on subsequent pages without forcing a new page for the entire group. This applies
both to full-width groups and groups inside columns.

## Risk and priority

- P0: avoid blank-heavy pages, missing or duplicated images, and split image rows.
- P1: preserve crop/fit, order, proportions, narrow-column frame bounds, explicit
  page breaks and legacy offsets. Keep normal PDF failure reporting intact.
- The application has no role-dependent behavior for pagination. Native file
  permissions, installer lifecycle and user data migration are outside this fix.

## Core functional coverage

The previous preflight kept groups shorter than one page indivisible and packed
larger groups into whole-page fragments. The mapping also inserted a full-page
presence hint and forced breaks between fragments. Both rules prevented using
the space remaining below earlier content.

The fix emits one indivisible fragment per visual image row and lets React-PDF
choose page boundaries. Joined surface strips retain the original row gaps and
outer frame without adding internal borders. A first-strip border adjustment
prevents clipping when a narrow column's gap is less than one point. Positive
offsets stay with the first row; negative offsets shift the first page together
and retain the total flow reservation without shifting continuation pages.

Multi-row PDF groups use actual image content height, so unused legacy container
height does not create empty surfaces. Single-row groups retain their geometry.
The existing whole-page emergency scale check remains for an overheight row.
Original images, project data and the independent DOCX/long-image pipelines
are unchanged. The obsolete forced-fresh-page helper was removed.

## Key scenarios and results

Three real-PDF regressions failed before the fix:

| P0 scenario | Before: images per page | After: images per page |
| --- | --- | --- |
| Short text followed by three tall rows | 0, 2, 1 | 2, 1 |
| Half-page of text followed by two rows | 0, 2 | 1, 1 |
| Half-page of text followed by five rows | 0, 2, 2, 1 | 1, 2, 2 |

Browser UI tests use the actual toolbar and production exporter, with isolated
project storage and numbered derivatives of bundled sample photographs:

| P0/P1 scenario | Images per page | Checks |
| --- | --- | --- |
| Twelve images; group fits a page but not the remaining space | 9, 3 | Starts below notes; complete rows |
| Thirty images; group exceeds one page | 9, 12, 9 | Continuous pagination; no blank continuation |
| Thirty images in a weighted column | 12, 18 | Column bounds and proportions |
| Deliberate page-break block before twelve images | 0, 12 | Exactly one intentional transition |
| Twelve images in one of six equal-width columns | 12 | Complete narrow frames and gaps on one page |

All images are counted once with distinct PDF resources. Page screenshots and
extracted text verify image order, the heading and the paragraph after the group.
The first three scenarios place image rows on the same page as the preceding
notes. Empty space smaller than the next intact row remains expected.

Additional regressions cover exact-page heights, no remaining room for one row,
paired images, positive/negative offsets, emergency-scale acceptance/rejection,
missing/corrupt assets, six narrow columns, and stale legacy container height.

## Execution notes

The affected PDF/DOCX suite passed **25 files / 185 tests**. TypeScript, focused
ESLint and documentation checks passed. The final browser run passed **5 cases**;
all **10 PDF pages** were visually reviewed, including a high-resolution detail
of the six-column gallery. All five PDFs retain their heading and final paragraph.
The final local `verification-summary.json` records PDF and runtime module hashes.

Validation commands:

```powershell
pnpm test src/infrastructure/pdf src/domain/plan/blocknote/pdfExportPreflight.test.ts src/infrastructure/docx
pnpm typecheck
pnpm exec playwright test e2e/pdf-gallery-pagination.spec.ts --workers=1
pnpm docs:check
```

Focused ESLint covers every changed TypeScript/TSX file. Optional PDF page
rasterization uses `pdftoppm`; geometry/identity assertions use `pdf-lib` only.
Local PDF, screenshots and JSON evidence are under
`.preshot-build-cache/pdf-gallery-pagination/`. Existing user projects, material
libraries and original bug screenshots were not used or changed.

## Open questions and limits

No input is required to use the fix. This verifies the shared production PDF
renderer and browser UI export path; this change does not rebuild or reinstall
the previously produced 0.0.24 MSI. Artifact-card pagination is separate from
standalone image-group pagination. Manual page breaks intentionally retain their
authored whitespace. Individual images are never divided across pages.
