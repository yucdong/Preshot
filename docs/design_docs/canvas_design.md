# Canvas unified document-flow design

**Status:** Image interaction revisions implemented and validated on 2026-08-13
**Target version:** Canvas schema v12
**Interaction reference:** `docs/design_refs/preshot-paged-document-review.html`

## Goal

Turn the central canvas into one continuous A4 rich-text document. There are no longer separate "text components" or multiple independent text boxes. Users continue typing inside a single TipTap editor, while image groups are inserted into the body as non-editable atomic nodes.

Image groups occupy the printable body width by default and contain only images. They do not show component name, title, intro, or description. Users can drag the four corners within body bounds to adjust image-group frame width and height.
The only currently insertable component type is the image group.

## Confirmed interaction

### Continuous body text

- Each project has only one body TipTap editor.
- No standalone canvas-title input or title band is shown. `ProjectPlan.title` remains only project metadata. When a visible document title is needed, edit it as H1/H2 inside the same TipTap body; v12 PDF also does not render metadata title separately.
- Text itself shows no cards, no input boxes, and no component borders; the white A4 canvas is the only text-area boundary, and no second printable-area helper border is drawn.
- Paragraphs, headings, and lists before/after image groups all belong to the same ProseMirror document.
- Cursor and keyboard navigation can move across image groups and continue editing without creating new text boxes; the text area always uses an I-beam cursor.
- Double-clicking any body paragraph, heading, list item, blockquote, or code block selects that full text block; browser triple-click is not required. Clicking other text, blank lines, image groups, or outside the canvas in the same TipTap document then explicitly collapses the old selection and hides the Style bar; clicking outside the editor also clears the browser Range and blurs focus.
- The end of the document always keeps one editable empty paragraph; clicking that blank paragraph reveals the image-group insertion position.

### Context property bar

- The property bar is not persistent and does not occupy PDF layout space.
- The text property bar appears only when the current selection is non-empty; placing only a caret does not show it.
- The text property bar prefers the upper-right of the selection, flips when there is insufficient right-side space, and always remains clamped inside the viewport.
- The text property bar is fixed to two rows and does not allow internal horizontal/vertical scrolling or respond to wheel scrolling:
	- First row: full block type, font-size value/decrease/increase, current-color split button;
	- Second row: bold, italic, underline, strikethrough, left/center/right align, decrease/increase indent.
- Toolbar width is determined by the real content of the two rows rather than a fixed width. Remove visible grouping labels that can be represented by `aria-label`; use 4px outer padding, 1px control gaps, and 26×26px buttons so both rows stay close in width.
- Left/center/right alignment uses the standard multi-line Lucide `AlignLeft` / `AlignCenter` / `AlignRight` icons; decrease/increase indent uses `IndentDecrease` / `IndentIncrease`. Do not fake them with the same `≡` character or ambiguous text symbols.
- "Full block type" covers the TipTap extensions currently enabled in production and applicable to the selection: body text, H1-H6, blockquote, unordered list, ordered list, task list, and code block, for a total of 12 types. Tables, separators, and image groups are structural insertions rather than text-style levels and remain handled by insertion workflows.
- Left/center/right alignment writes `textAlign` on paragraph or heading. Increase/decrease indent on list items uses `sinkListItem` / `liftListItem`; on blockquotes it means nest / unnest. Commands must not damage or collapse the original selection.
- Font-size state must scan every text node in the selection and read explicit `fontSize` marks; when a mark is absent, use the effective font size of the owning paragraph/heading. A single size displays the raw value; multiple sizes display `minimum+`, for example a mixed 12px and 20px selection shows `12+`.
- Clicking `+` or `−` on a mixed-size selection computes the new value from the minimum size, then uses one `setFontSize` command to override the whole selection to that new size; sizes must not increment/decrement relative to their previous individual values.
- The left half of the current-color split button shows A with the current color underline and immediately reapplies the current color to the original selection; the right arrow opens the Standard Colors panel.
- The Standard Colors panel groups neutral, theme, and standard colors rather than flattening swatches directly in the toolbar; selecting a standard color applies it immediately, updates current color, and closes the panel.
- A `More Colors…` entry sits at the bottom of the Standard Colors panel. Clicking it first closes Standard Colors, then opens a fully independent color picker with separate DOM, size, positioning, and lifecycle:
	- The 2D color field must show the full 0–360° Hue rainbow across the x-axis (red, yellow, green, cyan, blue, magenta) in one view, while the y-axis controls Saturation; it must not collapse into the current hue or any single-color gradient;
	- A separate Brightness axis on the right, combined with the Hue×Saturation plane, must cover the full HSV space and therefore any RGB combination;
	- R/G/B use integer 0–255 inputs and stay bidirectionally synchronized with the color field, Brightness, preview, and read-only HEX;
	- `Apply` commits the draft color to the original selection and updates current color; `Cancel` discards the draft and leaves the text unchanged.
- Opening block-type, font-size, or color controls saves the ProseMirror selection. Before every command, restore that selection, and keep the text selected after execution so multiple formats can be applied continuously.
- Clicking an image group shows the image-group property bar, scaled proportionally with the A4 page, with its right edge aligned to the image-group right edge.
- The image-group property bar is 30px high and contains only image-group type, add image, and delete image group; all size adjustments are handled by the image group's eight-way resize hit zones.
- Clicking anywhere outside the Style bar or its popups collapses the text selection and hides the property bar; clicks inside the same editor preserve the new caret position, while clicks outside the editor also blur focus.
- In narrow viewports, the property bar remains two rows and clamped inside the viewport, hides helper labels but preserves all commands, and neither the property bar nor the page may produce overflow scrolling.

### Insert image groups

- The text property bar does not include "Insert image group".
- An "Insert" button is shown at the top of the canvas; the component menu currently contains only "Image group".
- Clicking outside the insert trigger and menu closes the component menu.
- Clicking any blank paragraph in the body shows a circular `+` at the left side of the corresponding A4 canvas line; hover alone does not show it. Clicking another blank line moves the button there; clicking non-empty text or outside the canvas hides it.
- The blank-line `+` is a viewport overlay mounted at the page top level, not written into `documentHtml`, and never becomes persisted ProseMirror widget DOM. Reposition it from the blank paragraph rect on scroll, zoom, or window resize.
- Clicking `+` opens the component menu, which currently contains exactly "Image group". After selection, insert the image-group atom before that blank paragraph and keep the original blank paragraph after the image group so the user can continue typing.
- Top insertion appends to the end of the document when there is no valid caret; in-line `+` insertion happens at that line position.
- The empty paragraph at the end of the page always remains, allowing continuous insertion of multiple image groups.

### Image groups

- Image groups fill body width by default. Transparent hit zones on four edges resize one axis, and transparent hit zones on four corners resize width and height together; the frame must never cross the body boundary, and no blue squares or bars are shown.
- Image groups use a light 1px border to express the atomic component; text does not use the same border treatment.
- Enlarging a group frame does not change image size as long as the images still fit; only when the group becomes too small are all images uniformly scaled down.
- Individual images expose transparent hit zones on four edges and four corners: edges resize one axis, corners resize both dimensions, and approaching matching width/height of nearby images in the same group causes snapping plus alignment guides.
- Single-clicking an image both selects it and opens the full-size image; the large-image dialog only provides close and does not provide reset size.
- When hovering an image, show a delete button near the upper-right area, offset away from the upper-right resize zone; clicking it deletes through the global confirmation dialog.
- Images can be reordered within a group or moved to another group. Dragging uses a movement threshold and live placeholder, cancels on invalid drop targets, and does not rebuild image DOM.
- Selected image groups are expressed through a theme-aware neutral darker background rather than extra border, outline, or box shadow; selected single images do not change original border/shadow/size and show only a top-left index badge, with delete living in the image property bar.
- Image groups are selectable atomic nodes that can be dragged to reorder. A light tap on the blank gray area only selects; holding and moving beyond the threshold lets the whole group swap document order with text blocks, other components, or other image groups.
- Image groups and image areas use default/grab cursors rather than text I-beam; only the body text keeps the text cursor.
- Image content uses a grab cursor. Without preselection, hover/focus-within immediately enables 20px edge hit zones and 24×24px corner hit zones; starting a resize auto-selects the image. The image element itself does not capture pointer events, preventing inheritance of TipTap's text cursor.
- Single-image left/top resize persists signed frame offsets so the opposite edge stays fixed; offset participates uniformly in canvas layout, auto-wrap, persistence, and PDF.
- Image-group top-edge resize persists signed group offset and can consume only space left by the previous document block; moving the top edge keeps the bottom edge fixed.
- During image-group resize, pointermove updates only a body-level preview frame; metadata commits only on release, causing one NodeView/layout/pagination update.
- Single-image resize Smart Guides follow "size and position are separate": magenta dashed lines with endpoints indicate true edge/center position; dimension brackets plus `Equal width` / `Equal height` labels indicate size matches.
- At most one closest, highest-priority positional candidate can be chosen on each axis. Size matching may coexist with position guides, but positional labels must not explain a pure size match.
- Smart Guides use a 6px entry and 10px release threshold in screen pixels; candidate geometry is frozen at resize start, and preview writes are batched through `requestAnimationFrame`.
- Dimension labels position themselves from their own size: the equal-width label centers below the bracket with `translateX(-50%)`, and the equal-height label vertically centers to the right of the bracket with `translateY(-50%)`.
- Empty image groups show an add-image entry; deleting an empty image group removes that atomic node.

## Schema v12

v12 no longer persists text components. `documentHtml` is the only source of text plus image-group order, while `components` stores only image-group metadata so existing image import, crop, and file-cleanup logic can be reused.

```ts
interface ProjectPlan {
	schemaVersion: 12;
	title: string;
	documentHtml: string;
	components: ReferenceComponent[]; // v12 only allows reference
}
```

Image groups use a stable TipTap block-atom marker in HTML:

```html
<figure
	data-preshot-node="image-group"
	data-preshot-group-id="group-id"
></figure>
```

Constraints:

- Every marker must reference one image group in `components`.
- Every image group must appear exactly once in `documentHtml`.
- Image files, source dimensions, frame, crop, and caption live only in the image-group record and are not copied into HTML attributes.
- Strict v12 loading rejects plan components, unknown root fields, dangling markers, and duplicate markers.

## v1-v11 migration

Older versions are first normalized to strict v11 by the existing migration chain, then v11→v12 runs:

1. Generate one HTML document in the user-visible order of the old `components`.
2. Append original HTML directly for plain text leaves.
3. Recursively split text is flattened by canvas visual order (top before bottom; within a row, left before right), removing only layout boundaries and preserving all rich-text content.
4. If an image-group name has content, convert it into a normal H2 before the image group.
5. If an image-group intro has content, convert it into normal body HTML after the heading.
6. Append the image-group atom marker.
7. Preserve image ID, file, caption, aspect ratio, source dimensions, frame, and crop as-is.
8. Normalize image-group records to full width; old x/width/height act only as migration input and no longer determine new canvas layout.
9. If there is no text at all, create `<p></p>`; always ensure the document ends with an editable paragraph.

When the app loads any old project, it automatically obtains an in-memory v12 model and autosave writes it back. The batch migration script still uses dry run, timestamped backup, temporary file, atomic replace, and strict post-write verification.

## Editor implementation

Add a new `imageGroup` TipTap node:

- `group: "block"`
- `atom: true`
- `selectable: true`
- `draggable: true`
- attributes contain only `groupId`
- React NodeView reads images and callbacks from the v12 image-group map

Editor serialization outputs only the marker, never runtime data URLs or NodeView DOM.
Top insertion and line insertion both ultimately call the same `insertImageGroup(groupId)` command.

## Production validation

On 2026-08-12, the approach was validated using `docs/design_refs/preshot-paged-document-review.html` and then implemented in the production TipTap document canvas:

- The production document-mode toolbar is a two-row compact surface shown at A4 scale; Playwright verifies all 12 block types, the font-size stepper, Standard/More Colors, typography, alignment, and indent.
- In a 390px viewport, the two rows keep zero internal scrolling and the page has no horizontal overflow.
- The production block-type menu converts ordinary paragraphs into TipTap `codeBlock`; all 12 menu items and alignment/indent buttons are covered by Playwright.
- Font size `+` changes the selection from 16px to 17px, and font size `−` returns it to 16px; selection HTML persists the corresponding inline font size.
- Mixed-size tests use two segments, 12px and 20px: the initial display shows `12+` and `aria-label` says "Mixed font size, minimum value 12 pixels"; clicking `+` turns the whole selection into 13px, clicking `−` then turns the whole selection into 11px, output no longer includes `+`, and selected text stays unchanged.
- Bold on ordinary body text generates `<b>` and computed font weight 700; italic, underline, and strikethrough produce visible `<i>`, `<u>`, and `<strike>` effects.
- All 12 block types are validated one by one: `p`, `h1`–`h6`, `blockquote`, top-level `ul`, top-level `ol`, `ul[data-type="taskList"] > li[data-type="taskItem"]`, and `pre` all generate matching structures; lists do not produce invalid `<p><ul>` wrappers.
- Left/center/right buttons write `text-align: left/center/right` respectively. Indenting the second list item creates one nested list level; outdenting restores the top level, and the selected text remains unchanged after both actions.
- At 390px, both rows satisfy `scrollWidth === clientWidth`; every visible control stays inside toolbar bounds; all 3 alignment and 2 indent Lucide SVGs render correctly; the page has no horizontal overflow.
- Production blank-line insertion uses a page-top React overlay: clicking an empty paragraph shows a 22 logical-px circular `+`, the menu contains only "Image group", and insertion order is "image-group atom → original blank paragraph".
- Standard Berry Red writes `#C2385C` and updates current color. The CSS of the full color field simultaneously displays the red→yellow→green→cyan→blue→magenta gamut and is not constrained by the current color.
- After setting Brightness to 100, sampling red/green/blue positions along the Hue axis yields `#FF1203`, `#03FF03`, and `#0303FF`, proving the field is not a monochrome blue hue.
- Any RGB `123/45/210` produces exactly `#7B2DD2`; after Apply, it writes into selection HTML, updates current color, and preserves the original selection.
- Entering R/G/B `123/45/210` in production More Colors writes actual text color `rgb(123, 45, 210)`, Standard Colors is closed, and the selection is preserved.
- More Colors is a standalone full color panel mounted to `body`, not contained inside Standard Colors DOM; opening it closes Standard Colors and centers the full panel independently.
- The desktop full color panel is 408px wide; at 390px it is 378×276px. Both viewports show the entire panel with no horizontal overflow or internal scrolling.
- After the commands above run in sequence, the selected text stays unchanged; clicking outside the toolbar closes the Style bar and clears the non-empty selection.

The interaction prototype used browser formatting commands only to validate feasibility. The production implementation persists schema-safe HTML through TipTap/ProseMirror commands and does not use deprecated `document.execCommand`.

## A4 and PDF

- Each A4 page shows only four Word-style printable-area corner markers rather than a full inner border. The marker arms sit outside the text area, their tips point inward, and they coincide with the four printable corners: upper-left `┘`, upper-right `└`, lower-left `┐`, lower-right `┌`. A page-seam overlay sits above the continuous editor; clicking the seam cannot create a caret or text input, while pressing Enter / keyboard navigation naturally enters the next page body.
- The screen paginates the same TipTap top-level block sequence into printable A4 areas.
- All TipTap top-level text blocks (paragraphs, headings, lists, blockquotes, code blocks, tables) and image groups are keep-together blocks: they cannot cross a page or fall into a page seam, and move to the next page as a whole when remaining space is insufficient.
- When a single text block or component is taller than an entire printable page, use a ProseMirror node decoration for view-layer fit and compensate document-flow height so the block still fits on one page; do not rewrite canonical `documentHtml`, font-size marks, image frame, or crop data.
- Pagination gaps use ProseMirror widget decorations rather than directly modifying TipTap child styles, so pagination state is not lost on editor rerender.
- After an image group moves to the next page, the remaining space on the previous page still belongs to the continuous body text and users can continue typing there naturally.
- Image-group maximum height is capped at one printable page; once the cap is reached, enlargement stops so every image group can still land fully on one page.
- PDF reads text and image-group markers in `documentHtml` order and then uses group IDs to fetch image data.
- v12 PDF does not reserve or draw a standalone metadata title; any visible title on screen/PDF comes from `documentHtml`.
- During migration, a read-only old-layout sequence may be constructed to reuse PDF geometry, but that sequence must never be persisted or written back.
- Screen and PDF must use the same image frame/crop spec.

## Implementation phases

1. Schema v12, strict validation, v11→v12 migration, and manifest script.
2. Single TipTap document plus imageGroup atom NodeView.
3. Context property bar, top insertion, and blank-line / end-of-page insertion entry points.
4. Image-group simplification, import, ordering, total height, cropping, and deletion.
5. A4 screen pagination and PDF document-order adaptation.
6. Real-project backup migration, visual reverification, and full test matrix.

## Acceptance

- The page contains only one body `contenteditable`.
- Text before and after image groups shares the same ProseMirror document.
- Multiple image groups can be inserted continuously from both the top and the page end.
- Selecting text shows the two-row Style bar; all 12 block types, font-size ±, left/center/right alignment, bold, italic, underline, strikethrough, increase/decrease indent, and layered color controls apply to the same selection.
- Color uses current color as the entry point: Standard Colors can open, and its `More Colors…` entry jumps to an independent full color panel. More Colors is not coupled to Standard Colors, uses full Hue×Saturation gamut plus independent Brightness, RGB, and HEX, and commits or cancels explicitly through Apply/Cancel.
- The Style bar has no horizontal or vertical scrolling; clicking outside clears both the bar and the text selection.
- Text has no component border; image groups do. When an image group does not fit on the current page, it moves as a whole to the next page.
- Image groups do not show name, title, intro, or description.
- After upgrading v1-v11 projects, text, images, captions, crop, and frame are preserved with zero loss.
- Save, reload, undo/redo, PDF, and project switching all pass.
- Neither desktop nor a 390px viewport shows page-level horizontal overflow.
