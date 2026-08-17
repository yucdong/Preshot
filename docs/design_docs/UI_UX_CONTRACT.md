# Preshot UI/UX Contract

**Status:** Active for `0.0.1`
**Platform:** Windows desktop
**Runtime language:** Simplified Chinese

## Workspace

- Opening a project maximizes the window.
- The project panel and assistant panel remain visible by default.
- The center workspace uses the available viewport with restrained gray margins.
- The white document has a fixed logical width of 1080px and can extend vertically.
- Mouse-wheel zoom uses 15% steps and remains anchored near the pointer.
- Fit-width keeps the document readable without creating a large gray gutter.

## Document editing

- BlockNote v14 is the only editable document surface.
- Text, image groups, images, video, audio, and column layouts participate in
  one continuous block document.
- Native block controls support insertion, movement, nesting, unnesting,
  duplication, conversion, and deletion.
- The compact block control strip stays inside the 36px white-page padding,
  does not overlap text, and scales with the document zoom.
- Pointer-based block dragging is used instead of native HTML5 dragging so
  drop geometry remains stable under CSS zoom.

## Image groups

- An image group can be moved from its six-dot handle, toolbar label, or
  non-interactive gray surface.
- A group can move before or after other blocks or into a column layout.
- Images can move within a group or between groups.
- Group and image frames expose four edge handles and four corner handles.
- Resize previews must not change document layout until the gesture commits.
- Images use a grab cursor; controls use the normal arrow cursor. Editable text
  alone uses the text cursor.
- The compact upper-right toolbar exposes drag, insert image, screen capture,
  and delete actions with native hover titles.
- Deleting a group follows the same tombstone, notification, and undo behavior
  as deleting it from the block menu.
- There is no automatic size-reset command; frame size is user-controlled.

## Columns

- Two- and three-column layouts can be inserted from the slash menu.
- Edge dropping can create a same-row column layout.
- Column widths are user-resizable and persisted.
- Image groups are valid as top-level blocks or direct column children.

## Media

- Native BlockNote image, video, and audio blocks use project-owned media
  files.
- Persisted documents store relative `media/...` paths; runtime rendering uses
  resolved data URLs.
- Image imports are limited to 16 MiB, audio to 64 MiB, and video to 128 MiB.
- Successful Windows captures are imported into the project and their
  Preshot-owned temporary PNG is discarded.

## Feedback and accessibility

- Icon-only actions have accessible names and native hover titles.
- Destructive actions use explicit danger styling and confirmation where data
  loss would otherwise be surprising.
- Save failures remain visibly unsaved and show an actionable error.
- Unexpected rendering failures remain the responsibility of the application
  error boundary; expected operation failures are handled locally.

## Historical specifications

Earlier TipTap, paged-canvas, split-text, and card experiments remain under
`docs/design_docs` and `docs/design_refs` as historical design evidence. They
do not override this contract or the current architecture documentation.
