# Mixed block and drag-handle alignment

Date: 2026-09-30. Follow-up to the updated `test-results/buglist2.md`.

## Reproduction and correction

The original [reported screenshot](media/block-alignment/original-report.png)
shows a card border below its six-dot drag handle. Real Edge measurements at
100% canvas zoom reproduced these differences:

| Pair or control | Before |
| --- | --- |
| Paragraph / model card top edges | 12px apart |
| Native image / prop card top edges | 12px apart |
| Image group / location card top edges | 12px apart |
| Card drag handle / card top edge | 12px apart |
| Heading drag handle / heading content box | 24px apart |

Cards added a 12px top margin inside BlockNote's content padding. Native headings
added an 18px top inset, while other blocks used 3px. BlockNote positioned side
menus with type-specific first-line offsets and a 30px container even though
Preshot uses 18px buttons.

The change removes cards' extra top margin, keeps their bottom spacing, and uses
the standard 3px content inset for headings that begin a column. Later headings
keep their section spacing. Side menus now use the owning content's actual CSS
top inset in Floating UI's canvas coordinates, with an 18px container and a flex
drag trigger. Lookups remain scoped to the owning reference element, so cached
projects with matching block IDs cannot affect each other.

The shared card renderer and first-column heading rule also apply to the DOM
used for long-image export. PDF and DOCX mapping code is unchanged. There are no
plan, image, schema or migration changes.

## Visual evidence

| Pair | Before | After |
| --- | --- | --- |
| Paragraph / model | [Image](media/block-alignment/before-text-model.png) | [Image](media/block-alignment/after-text-model.png) |
| Image / prop | [Image](media/block-alignment/before-photo-prop.png) | [Image](media/block-alignment/after-photo-prop.png) |
| Image group / location | [Image](media/block-alignment/before-group-location.png) | [Image](media/block-alignment/after-group-location.png) |
| Heading / clothing | [Image](media/block-alignment/before-heading-clothing.png) | [Image](media/block-alignment/after-heading-clothing.png) |

Additional screenshots: [70%](media/block-alignment/after-70-text-model.png),
[130%](media/block-alignment/after-130-text-model.png).

Alignment refers to content boxes; font glyphs retain their natural line metrics.

## Validation

- The geometry regression failed against the original production code with the
  measured offsets above, then passed after correction.
- Three Edge geometry cases cover all four pairs at 70%, 100% and 130% canvas
  zoom. Each checks both content top edges and both six-dot handles within 1.5
  viewport pixels, including scrolling to lower rows.
- Two existing Edge workflows passed: cancelled/outside column drops; column
  creation/removal, divider resize, image geometry, undo/redo and save/reopen.
- 14 Vitest cases passed in `BlockNoteDocumentEditor.test.tsx` and
  `ArtifactBlockView.test.tsx`.
- Typecheck, focused ESLint and documentation checks passed.

Browser runs used port 1454 and explicit output folders under
`.preshot-build-cache/block-alignment-*`. They did not change the user's projects,
library or bug report. No MSI, native Windows scaling matrix or new export-file
acceptance was run for this presentation change.

```powershell
$env:PRESHOT_E2E_PORT = '1454'
pnpm exec playwright test e2e/block-alignment.spec.ts --output .preshot-build-cache/block-alignment-regression
pnpm exec playwright test e2e/multi-column.spec.ts --grep 'cancels a column drop|creates and removes columns' --output .preshot-build-cache/block-alignment-gestures
```
