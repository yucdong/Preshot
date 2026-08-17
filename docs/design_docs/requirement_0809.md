# A4 document-flow canvas

## Original requirements

- The canvas must be designed strictly to printable A4 page dimensions, and screen/PDF output must be WYSIWYG.
- Every component occupies its own row; multiple components cannot be placed in the same row. Dragging components is used to change order.
- A single component cannot span pages. If it does not fit on the current page, move the entire component to the next page.
- Image groups should first shrink their images. If the group still cannot fit after reaching the minimum size, create a continuation image group on the next page and append suffixes such as `(2)` and `(3)` to the name.
- Text should not shrink its font size. If content does not fit, split it by BlockNote blocks into a new text component on the next page.

## Clarifications confirmed on 2026-08-08

- Components keep width and height resize capability, but no matter how narrow they become, each still occupies a full row. Remaining horizontal space cannot be used by other components.
- Auto-created continuation image groups and text components are real project components: they are written into `.preshotproj`, and can be edited, dragged, undone, and redone independently.
- The minimum auto-scaled image height is `67.5pt`, approximately screen `90px` at 96 DPI. Images keep their current aspect ratios.
- The default behavior still enforces the `67.5pt` image minimum. When the user explicitly chooses "Force single page", the specified image group may be uniformly reduced below that limit, and the actual frame size is persisted.
- Text is split first at BlockNote top-level block boundaries. A single block that exceeds the height of an entire page may be split internally by visible lines to avoid an unlayoutable case.
- Text card height must adapt bidirectionally to actual BlockNote content: it grows when text, numbered-list wrapping, or line breaks increase, and shrinks when content is removed. Persisted historical height must not prevent shrinking.
- Image-group card height must adapt bidirectionally to the title, intro controls, and final image-row bottom: when images are added or enlarged the border moves down, and when images are removed or reduced the border moves up, without keeping historical blank height.
- The text editor must not insert cross-page blank space internally. When content exceeds a page, pagination happens only through persisted `(2)` and `(3)` continuation components.
- When the user explicitly chooses "Force single page", a text component may persist `contentScale` (range `0.5–2`); screen and PDF use the same scale, while all other components without a setting remain at 1.
- After migration, old projects are sorted once by original component `y`, then by `x`; after that, array order becomes the only source of vertical ordering.
- Schema v7 is a continuous freeform canvas, so historical component heights may exceed one page. Migration validation must not apply v8 single-page limits too early. During v7→v8 migration, temporarily clamp height to A4 content height first, then let image/text normalization create continuation components.

## Acceptance criteria

- The screen shows separate A4 sheets, page margins, and page gaps; component content does not enter unprintable margins.
- No two components may appear in the same visual row, and components use consistent vertical spacing.
- Components shorter than one page never span pages; when the current page has insufficient remaining space, the entire component appears at the top of the next page.
- Dragging components changes only array order and no longer persists freeform vertical coordinates.
- Automatic splitting is one structural history record; undo restores the pre-split component, redo restores the continuation components.
- The bottom of a short text card on a single page keeps only component padding and does not gain extra blank space from its page position.
- Line wrapping caused by ordered-list numbering changes triggers DOM remeasurement and synchronizes card height.
- The bottom of an image-group border keeps only component padding. When the combined height of two consecutive shrunken components plus row spacing is less than printable A4 height, they must appear on the same page.
- PDF uses the same page size, margins, component order, split results, and image sizes as the screen.
- Valid schema v7 projects that contain over-height components can be loaded and migrated to v8; schema v8 and later versions still enforce strict field and boundary validation.
