# Document editor

[Documentation index](../README.md)

Preshot uses a continuous BlockNote document with optional multi-column rows.
Page boundaries appear only in exported PDF or Word files.

Type directly into the document. Use `/` to insert headings, paragraphs, lists,
checklists, tables, quotes, dividers, images, and photography components. Select
text to format it. The block handle moves rows and opens block actions.
**Ctrl+Z** undoes an edit; **Ctrl+Shift+Z** redoes it.

| Component | Content |
| --- | --- |
| Location | Venue, address, description, reference images |
| Model | Identifier, measurements, notes, sample images |
| Props / clothing | Item name, source, image references |
| Image group | Several reference images in document flow |
| Image | One independent document image |

For example, start a bridge portrait plan with a schedule and shot list, then
add a Nanjing Yangtze River Bridge location, fictional Model A, a transparent
umbrella, a bubble machine, and reference photographs.

Cards grow with their content and fill their containing column. Their text and image
areas share the width on larger screens and stack when space is limited.
Image groups wrap in row-major order. The toolbar controls zoom and fitting;
[focus mode](settings.md) gives the document more room. See
[Images](images.md) for crop, resize, capture, and gallery controls.

## Multi-column rows

Drag a block using its six-dot handle to the left or right edge of another block.
A vertical insertion line marks the new column; release to create it. Repeat at
the edge of an existing column's block to add another sibling. There is no preset
column-count cap or separate column toolbar. Nested column rows are not supported;
the existing document size limits still apply.

Drop above/below a block to change its vertical position, or in a column's blank
area to append to that column. Move a block above/below the whole column row to
return it to the document's full-width flow. Moving the last block out of a column
removes that empty column; a row with one remaining column returns to ordinary
document flow. Each completed column move is undoable. Escape or dropping outside
the editor cancels the drag.

Drag the divider between columns to adjust relative widths. Divider dragging
previews only; release commits one undoable edit, and Escape cancels.
Dense rows scroll horizontally.
Gallery frames, gaps and offsets scale together from their original layout;
resizing a column does not rewrite image frame dimensions, crop, fit or files.
Text and buttons keep their font sizes. Photography cards stack their metadata
and gallery inside columns. Material insertion follows the last user-focused
block within its column. The isolated material editor stays one component.

Older v15/document-v3 plans migrate to v16/document-v4 on opening. New saves
require this version of Preshot; older releases cannot open multi-column plans.
See [export constraints](exports.md) and the
[acceptance report](../test_reports/multi-column-acceptance.md).
