# Export

[Documentation index](../README.md)

Open **Export** in the toolbar. The menu order is **PDF**, **DOCX**, then
**Long image**. Assets must be available and decoded; missing images are
reported rather than silently omitted.

| Format | Use |
| --- | --- |
| PDF | Paginated A4 shooting plans for viewing and printing |
| DOCX | Editable Word documents for collaboration |
| Long image | A continuous image for chat and sharing |

Desktop export asks where to save. Successful saves reveal the project
directory. Fixed field labels follow the interface language; original
document text, crop/fit settings, frame sizes, and image order are preserved.

PDF material cards wrap descriptions using the bundled font metrics within
the text column, leaving room for the image column. Cards that fit on a page
move together when the current page has insufficient space; taller cards can
still span pages. The [walkthrough](../demo/README.md) includes an exported PDF
with illustrated model, location, and prop cards.

PDF image groups start in the space remaining below earlier content and continue
onto later pages **between image rows**. This also applies inside columns and to
groups that fit a full page but exceed the current page's remaining space. A row
stays intact; when it cannot fit, only that row and the following content move
forward. Image order, crop, fit and relative sizes are preserved. A single row
taller than an entire page uses the existing proportional fit check. Explicit
page-break blocks still start a new page. Some space at a page bottom is expected
when the next complete image row cannot fit.

Long images default to 900px width, with 890px compatibility available.
WeChat JPEG targets 6,000px / 1 MiB, high-quality JPEG 8,000px / 3 MiB,
and lossless PNG 4,000px / 8 MiB per part. These are practical compatibility
targets, not official platform limits.

**Automatic splitting** starts unchecked. Enable it to split at block or
image-row boundaries. Single images can reach 20,000px high within the
18-million-pixel / 72-million-byte decoded-memory budget. If a plan exceeds
the limits, enable splitting, shorten it, or use PDF/DOCX. Up to 32 parts
are allowed. The three formats use independent rendering pipelines.

## Multi-column layout

PDF preserves relative column widths and paginates vertical flows. DOCX uses
borderless tables with the same relative widths. Long images render columns on
the export surface; splitting chooses a cut that crosses no text, card or image
row in any column. If no safe cut fits the resource budget, export fails with
an actionable error instead of clipping content.

The editor has no preset column-count limit, but an A4 page or 900px image has
finite width. Exports reject layouts with a column narrower than 48 logical
pixels after gaps. Widen very narrow columns or distribute them across multiple
rows before exporting. DOCX also respects Word's 63-cell-per-table-row limit,
including spacer cells. Editing expansion and scrolling do not affect exports.
