# Historical Preshot UI/UX Requirements Ledger

**Status:** Historical; superseded by [the active UI/UX contract](UI_UX_CONTRACT.md)
**Applies to:** The former schema-v12 TipTap and paged-canvas implementation

This translated ledger preserves the accepted interaction requirements and
test mappings that existed before the BlockNote v14 continuous-canvas design.
Its stable `UIUE-*` IDs remain useful when tracing historical tests and design
decisions, but they do not define current behavior.

## Maintenance rules at the time

- Each requirement used a stable `UIUE-*` ID and specified its trigger,
  expected result, close or cancel behavior, responsive or zoom behavior, and
  accessibility semantics.
- UI/UX changes were expected to update this ledger, implementation,
  regression tests, architecture, testing documentation, and related design
  documents together.
- Removed interactions were marked as superseded rather than silently deleted,
  with the replacement requirement and affected tests identified.
- Component tests covered accessible, user-visible local behavior. Playwright
  covered cross-component workflows, geometry, zoom, persistence, and closing
  conditions. Midscene supplemented journeys requiring visual judgment.
- Test names or comments were expected to trace back to requirement IDs.

## Global interactions

### UIUE-GLOBAL-001 Outside-click closing

Temporary menus, overlays, and contextual property bars closed when the user
clicked outside their trigger, panel, and associated editing target. Internal
panel actions did not close them, and closing did not commit an operation that
had not been explicitly confirmed.

### UIUE-GLOBAL-002 Viewport and zoom

Fixed-format content used explicit logical dimensions. Visual zoom applied the
same scale to content, contextual controls, and hit targets. Page-level UI did
not introduce unintended horizontal overflow, occlusion, or overlap.

### UIUE-GLOBAL-003 Accessible operations

Buttons, menus, toolbars, inputs, and statuses had stable roles and accessible
names. Icon-only buttons used Simplified Chinese accessible names and native
hover titles, and keyboard focus remained visible.

## Workspace and canvas

### UIUE-WORKSPACE-001 Three-column workspace

The project rail, center canvas, and assistant rail formed a fixed-height
workspace. The center canvas scrolled independently. Project actions remained
fixed at the bottom of the left rail, while a long project list scrolled
inside that rail.

### UIUE-CANVAS-001 Continuous document

Each schema-v12 project had one TipTap body editor. Text could be edited before,
between, and after image groups. Image groups were atomic document nodes, full
width by default, with resizable group frames constrained to the body bounds.
They did not create separate copy boxes.

Copy did not display cards, input boxes, independent title boxes, or a second
printable-area border. The white A4 canvas was the only text boundary, while
image groups retained a lightweight component border. Project metadata titles
were not rendered separately; visible titles used body H1 or H2 blocks.

### UIUE-CANVAS-002 Centered zoom

The canvas was horizontally centered in the middle scroll area. `Ctrl/Cmd +
mouse wheel` zoomed around the canvas horizontal center rather than a fixed
left edge while preserving the current vertical interaction position. The A4
page center remained aligned with the available viewport center after zooming.

### UIUE-CANVAS-003 Contextual property bar

- The text property bar appeared only for a non-empty text selection.
- Text, headings, list items, quotes, and code blocks used an I-beam cursor.
  Double-clicking selected the complete block without relying on browser
  triple-click behavior.
- Selecting an image group showed the image-group property bar; text and
  image-group property bars were mutually exclusive.
- The image-group bar offered add image, `- / px / +` proportional group
  scaling, and delete. Scrolling dismissed it; clicking the group restored it.
- The text bar preferred the selection's upper-right corner and reversed its
  alignment within the viewport when space was limited.
- The text bar had exactly two rows and no internal scrolling. Row one exposed
  block type, decrease/current/increase font size, and current color. Row two
  exposed bold, italic, underline, strikethrough, left/center/right alignment,
  and decrease/increase indentation.
- Toolbar width followed its actual content, with compact margins, gaps, and
  dividers rather than decorative empty space. Accessible names replaced
  visible group labels such as level, size, and color.
- Alignment used recognizable Lucide `AlignLeft`, `AlignCenter`, and
  `AlignRight` icons. Indentation used `IndentDecrease` and `IndentIncrease`.
- Enabled block types included paragraph, H1-H6, quote, bullet list, ordered
  list, task list, and code block. Tables, dividers, and image groups used
  insertion flows rather than pretending to be level styles.
- Alignment applied to paragraphs and headings. Lists supported indent and
  outdent; quotes supported nesting and unnesting. Commands preserved the text
  selection for further operations.
- Mixed font sizes displayed the minimum plus `+`, such as `12+` for a
  12px/20px selection, with an accessible description of the mixed state.
- Increasing, decreasing, or directly setting a mixed selection used the
  displayed minimum as the base and applied one resulting size to the complete
  selection.
- The left side of the current-color control immediately reused the current
  color; the right side opened Standard Colors. The toolbar did not display a
  permanent grid of swatches.
- `More Colors...` closed Standard Colors and opened an independently mounted,
  positioned, and managed full color picker.
- The two-dimensional color field displayed the complete hue rainbow on the
  horizontal axis and saturation on the vertical axis, with a separate
  brightness axis. Together they covered the full HSV/RGB gamut.
- The full picker included integer R/G/B inputs from 0-255, a color preview,
  and read-only HEX. All controls stayed synchronized. Apply committed to the
  original selection; Cancel did not modify text.
- Controls saved and restored the original text selection. Block type, font
  size, and inline formatting commands wrote real editor HTML.
- Clicking outside the Style bar and its overlays collapsed the old selection
  and dismissed the bar, including clicks in other text or blank lines in the
  same TipTap document. Editor clicks preserved the new caret; external clicks
  also cleared the browser range and focus.
- On narrow viewports the bar stayed within the viewport in two rows, could
  hide helper labels, and did not add toolbar or page overflow.

### UIUE-CANVAS-004 Insert menu

The canvas-top Insert action, blank-line `+`, and page-end `+` opened the same
component menu, which contained only Image Group. Clicking outside the menu
and trigger closed it. Choosing the item closed the menu and inserted once.
The page-end entry remained after insertion.

- Clicking a blank paragraph displayed a 24px circular `+` beside that A4
  canvas line; hover alone did not. The button followed the active blank line
  and hid after clicking non-empty text or an external area.
- The button and menu were page-level overlays and were not written to
  canonical `documentHtml`. They remained vertically aligned through scroll,
  canvas zoom, and window changes.
- Inserting from a blank line created an image-group atom before that paragraph
  and retained the blank paragraph afterward as the next text entry point.

### UIUE-CANVAS-005 Image groups

Image groups filled the printable body width by default and did not display the
old component name, title, or description. Transparent zones on four edges
resized one axis, and zones on four corners resized both axes, constrained to
the body bounds. No blue square or bar handles were shown.

Expanding a group retained existing image sizes when they fit. Shrinking below
the required space proportionally reduced all images. The property-bar
`- / px / +` control proportionally resized every image while retaining aspect
ratios, wrapping to another row when necessary.

After clicking an image, its four edge and four corner resize zones became
available. Near equal widths or heights in the same group, resizing snapped
and displayed alignment guides. The upper property bar switched to Image mode,
and delete appeared only there, not on the image card.

Double-clicking opened the full original image and then exposed Reset Size.
Reset restored the default frame and full-source crop, immediately closed the
full-image view, and returned focus to the image. The original file was never
modified and the project stored one view only.

Selection and resize preview or commit reused the existing image DOM instead of
rebuilding the complete group. At any canvas zoom, edge hit zones retained a
usable screen-space width inside the frame so the group grid did not clip them.

Selecting a group only darkened its neutral background; it did not change the
existing border, shadow, or geometry or draw another selection frame. Selecting
an image likewise retained border, shadow, and dimensions and displayed only a
two-digit sequence badge at the upper left.

### UIUE-CANVAS-006 Save and undo

Editing displayed unsaved, saving, and saved states. Autosave wrote only
changed plan data. `Ctrl/Cmd+S` saved immediately. Document structure
operations supported undo and redo, and refresh restored canonical
`documentHtml` plus image-group metadata.

### UIUE-CANVAS-007 Whole-block A4 pagination

Each A4 page had an independent printable boundary. Every top-level text block
and image group was a keep-together block: if the remaining space was
insufficient, the complete block moved to the next page. Blocks did not split
or enter the page gap, and users could continue entering text in unused space
on the preceding page.

A block taller than the printable height was scaled to one page only in the
view layer without changing canonical HTML or image metadata. Screen and PDF
used the same keep-together semantics.

- Each page displayed Word-style corner marks rather than a full inner border.
  Their tips landed exactly on the printable boundary and pointed inward.
- A non-editable overlay above the editor covered each page gap. Clicking a gap
  only cleared the prior selection; it could not place a caret or accept input.
  Keyboard line breaks and navigation crossed pagination decorations directly
  into the next page body.

## Deterministic test mapping at the time

| Requirement | Primary regression tests |
| --- | --- |
| UIUE-WORKSPACE-001 | `e2e/layout.spec.ts`, `e2e/workspace.spec.ts` |
| UIUE-CANVAS-001 | `e2e/canvas.spec.ts` - unrestricted document and double-click block selection |
| UIUE-CANVAS-002 | `e2e/canvas.spec.ts` - horizontally centered wheel zoom |
| UIUE-CANVAS-003 | `e2e/canvas.spec.ts` - compact property bars, block styles, mixed font size, RGB color |
| UIUE-CANVAS-004 | `e2e/canvas.spec.ts` - outside close, top insertion, and clicked blank-line image-group insertion |
| UIUE-CANVAS-005 | `PlanCanvas.test.tsx` - sequence badge, property-bar-only deletion, invisible eight-way image/group resize, source open, group scale, and toolbar dismissal; `ReferenceImageLightbox.test.tsx` - reset, close, and focus; `e2e/canvas.spec.ts` - property-bar deletion, selection styling, import, resize persistence, lightbox reset, and atomic group removal |
| UIUE-CANVAS-006 | `e2e/canvas.spec.ts`, `e2e/undo-redo.spec.ts` |
| UIUE-CANVAS-007 | `e2e/canvas.spec.ts` - keep-together A4 pagination |

Related historical material:
[canvas design](canvas_design.md),
[paged interaction prototype](../design_refs/preshot-paged-document-review.html),
and [picture-card interaction prototype](../design_refs/preshot-picture-card-review.html).
