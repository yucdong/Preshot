# Font size and font color toolbar design

## Status

- Status: Implemented and validated
- Confirmation date: 2026-08-10
- Interaction reference: `docs/design_refs/preshot-font-size-dropdown-review.html`
- Design method: `ui-ux-pro-max`, following its compact tools, keyboard reachability, progressive disclosure, and no-layout-shift principles; marketing-page and purple-theme suggestions that do not fit a desktop editor were discarded

## Goal

Without replacing BlockNote or changing document schema, redesign the selection toolbar's font-size and text-color controls into compact composite controls similar to Microsoft PowerPoint:

1. Move the font-size entry from the far right to immediately after strikethrough and before paragraph alignment.
2. In collapsed state, show the numeric size and a separate small arrow on the right, with no `px` label.
3. Place font color right next to font size, showing an `A` with the current-color underline plus a separate small arrow on the right.
4. The color arrow first opens a common theme palette; `More Colors…` then opens a hue board and precise RGB input.
5. All operations preserve the current ProseMirror selection and keep HTML, autosave, and PDF output consistent.

## Non-goals

- No font-family switching.
- No alpha or RGBA; paper and PDF use opaque text colors.
- Do not change `schemaVersion: 10`, `PlanTextLeaf`, or project migration logic.
- Do not change existing BlockNote behavior for paragraph type, alignment, links, nesting, and similar capabilities.
- This document originally said "do not convert to a persistent card bar", but that has been superseded by `persistent_text_toolbar_design.md`; every text leaf now always shows its own formatting bar.

## Toolbar order

### v12 continuous-document update (2026-08-12)

The following rules replace the original single-row order in this section and apply to the current TipTap v12 selection Style bar:

- The toolbar is fixed to two rows with no internal scrolling.
- First row: block type, decrease current-size increase, current-color split button.
- Second row: bold, italic, underline, strikethrough, left/center/right align, decrease/increase indent.
- The toolbar uses `width: max-content` to shrink-wrap actual content; outer padding is 4px, control gap is 1px, icon buttons are 26px, and redundant group labels or fixed-width blank filler are removed.
- Alignment uses Lucide AlignLeft/AlignCenter/AlignRight, and indent uses IndentDecrease/IndentIncrease; the same text symbol must not represent different alignments.
- Block type fully covers the TipTap nodes currently enabled and applicable to the selection: body text, H1-H6, blockquote, unordered list, ordered list, task list, code block.
- Tables, separators, and image groups are structural insertions and are not included in the block-type dropdown.
- Alignment writes paragraph/heading `textAlign`; list indent uses `sinkListItem` / `liftListItem`, and blockquotes use nest / unnest semantics.
- Before executing all block-type, alignment, and indent commands, restore the ProseMirror Selection; after execution, preserve the selection.

The browser prototype has validated all 12 block structures, three alignments, and list indent/outdent one by one. The compact toolbar measures 277×68px on desktop and 273×68px at 390px; both rows have no blank filler, no scrolling, and no page overflow. The interaction reference is `docs/design_refs/preshot-paged-document-review.html`.

From left to right:

1. Paragraph type
2. Bold
3. Italic
4. Underline
5. Strikethrough
6. Font-size composite dropdown
7. Font-color composite button
8. Align left
9. Align center
10. Align right
11. Nest / unnest
12. Link

Font size and font color are character formatting and should sit after character styles and before paragraph layout. Keep `4px` spacing between them and use separators before/after them to define visual grouping.

## Font-size composite dropdown

### Collapsed state

- Overall visual height matches the existing toolbar buttons at `30px`.
- The numeric area is about `39px`, using tabular digits.
- The arrow area is about `23px`, with a faint separator on the left.
- Show `14`, not `14 px`.
- Either the numeric area or the arrow area can open the menu; the right arrow provides the explicit dropdown affordance.
- Mixed-size selections display `minimum+`, for example 12px and 20px show `12+`; the accessible name must explain the mixed state and minimum value.
- When `+` / `−` is used on a mixed selection, compute the target size from the minimum value and overwrite the whole selection; directly picking a size likewise unifies the full selection to that target. Different text nodes must not increment/decrement relative to their prior individual sizes.

### Menu

- Single-column options: `10 / 12 / 14 / 16 / 18 / 24`.
- The current font size uses both a checkmark and a bolder weight rather than color alone.
- Menu width is about `86px`, and each item is `29px` high.
- Clicking a size applies it immediately, closes the menu, and returns focus to the font-size trigger.
- No arbitrary text input for font size is added; this phase keeps the existing controlled size set.

### Keyboard

- `Enter` / `Space`: open the menu.
- `ArrowDown` / `ArrowUp`: cycle through size items.
- `Enter`: apply the currently focused item.
- `Escape`: close without changing content and return focus to the trigger.
- `Tab`: leave the control in visual order without creating a keyboard trap.

## Font-color composite button

### Collapsed state

- The primary button shows `A`, with a `3px` color bar below it indicating the current or most recently used text color.
- Primary button: immediately applies the current color to the selection.
- Right arrow: opens the theme palette.
- Height, border, corner radius, and arrow-area size match the font-size control.
- When the selection contains mixed colors, the color bar shows the most recently explicit chosen color; the menu must not incorrectly mark any one color as the selection's only current color.

### Theme palette

The first-level palette stays compact and provides 10 opaque theme colors:

- Graphite black `#202329`
- Neutral gray `#6B6F76`
- Berry red `#C2385C`
- Deep red `#B42342`
- Amber `#C78218`
- Pine green `#2F7D65`
- Functional cyan `#0891B2`
- Cobalt blue `#2563A9`
- Iris purple `#6F56A6`
- White `#FFFFFF`

Palette rules:

- Use a `5 × 2` swatch grid with swatches about `22 × 22px`.
- The current item uses a checkmark; each swatch has an accessible name containing both human-readable color name and HEX.
- Opening the color menu automatically closes the font-size menu, and vice versa.
- The bottom of the palette provides `More Colors…`.

## More Colors

### Progressive disclosure

Clicking `More Colors…` closes Standard Colors and opens a fully independent full-color picker mounted at the page top level. The full panel is not nested in, attached to, or sized/positioned like the standard palette. Ordinary users do not need to see RGB fields until they ask for precise color.

### Panel contents

- Desktop panel width is about `408px`; narrow screens use `calc(100vw - 12px)`, centered independently, without changing toolbar or canvas layout.
- The left 2D color field shows the full 0–360° Hue rainbow across the x-axis at once, with Saturation on the y-axis; it must not collapse into a single-hue gradient.
- A separate Brightness axis sits to the right of the field; Hue×Saturation×Brightness covers the full HSV/RGB gamut.
- The right side shows a color preview.
- Provide numeric `R / G / B` inputs, all in the range `0–255`.
- Show a read-only HEX preview; direct HEX editing is not provided in this phase.
- The bottom contains `Cancel` and `Apply`.
- No Alpha / transparency.

### Value sync and validation

- Changes in the color field or Brightness sync RGB, HEX, and preview.
- Changes in RGB sync Hue×Saturation position, Brightness, HEX, and preview.
- RGB accepts only integers `0–255`.
- Empty, non-integer, or out-of-range values show field-level errors and disable `Apply`; do not silently clamp or modify body text.
- `Cancel`, `Escape`, or the close button discards the draft and restores the pre-open color.
- `Apply` normalizes the color to uppercase 6-digit HEX such as `#0891B2`, then writes it into BlockNote `textColor` style.

### Full-color picker implementation

Production implementation should prefer a mature React full-gamut component that supports both a full Hue×Saturation plane and an independent Brightness axis, avoiding handwritten pointer math, HSV/RGB conversion, and keyboard behavior. Check bundle size, maintenance state, and license before adoption; the adapter layer should expose only normalized HEX strings to the editor.

If no dependency meets the requirements, use native color-conversion utilities plus tested pure functions instead; the full-color picker must still provide keyboard alternatives, and RGB input remains the precise-entry path.

## Selection and editor behavior

All font-size and color operations reuse the existing selection-preservation flow:

1. During toolbar `pointerdown` capture, save the TipTap/ProseMirror Selection.
2. Prevent toolbar controls from stealing editor focus.
3. Restore the saved Selection before command execution.
4. Font size writes through `fontSize` mark, for example `14px`.
5. Color writes through TipTap `setColor("#0891B2")`.
6. Default-color operations use `unsetColor` rather than writing a fake default color.
7. After the command finishes, focus returns to the editor or the corresponding trigger, and the original selection is not collapsed.

Only one popup layer stays active at a time while menus are open:

- `sizeMenuOpen`
- `colorMenuOpen`
- `customColorOpen`

Whenever any one becomes `true`, the other two must close. Clicking outside, `Escape`, editor unmount, or selection invalidation closes all of them.

## Data and persistence

- No new domain fields.
- BlockNote continues to serialize as HTML.
- Font size continues to persist as inline `font-size`.
- Text color continues to persist as inline `color`.
- Custom RGB normalizes to HEX before writing to reduce serialized variance between equivalent colors.
- Autosave, undo/redo, and project reload continue to use the existing HTML change pipeline.

## PDF consistency

The current PDF pipeline already supports this design:

- `htmlToBlocks.ts` reads inline `style.color` and `style.fontSize`.
- `pdfTextLayout.ts` passes color and font size into drawing commands.
- `canvasPdfExporter.ts` `parseColor` supports 3/6-digit HEX and RGB/RGBA text.

Implementation should add regression tests for arbitrary RGB and verify:

1. `#0891B2` converts to the correct normalized RGB in PDF.
2. Custom color and font size can both apply to the same text run.
3. HTML and PDF colors remain consistent after save/reload.
4. Link color still follows existing link rules and is not broken by ordinary text color.
5. With Brightness 100, the full-color picker can produce red, green, and blue primary hues respectively, and RGB `123/45/210` yields exactly `#7B2DD2`.

## Component design

Suggested split under `src/features/plan`:

- `FormattingSelectionGuard` or equivalent hook: save/restore ProseMirror Selection.
- `FontSizeControl`: collapsed font-size state, menu, and keyboard behavior.
- `FontColorControl`: current color, theme palette, and quick-apply action.
- `CustomColorPanel`: hue field, RGB draft, HEX preview, and validation.
- `colorValue.ts`: pure functions for RGB/HEX normalization, range validation, and conversion.

These modules belong to the rich-text editing feature and should not go into `shared` or `domain`. `RichTextEditor` is responsible for composition order and passing the editor into the controls.

## Accessibility

- Font size uses `combobox` / `listbox` / `option` semantics and maintains `aria-expanded`, `aria-controls`, and `aria-activedescendant` or roving focus.
- The primary font-color button and its arrow use different accessible names: "Apply current text color" and "Choose text color".
- Swatch names expose readable color names plus HEX, not just visual swatches.
- The custom-color panel is a named `dialog`; when opened, focus lands on the `R` input or the keyboard alternative for the hue field.
- Closing it returns focus to the color arrow.
- Input errors use `role="alert"` or `aria-live` and connect fields through `aria-invalid`.
- Focus rings use functional cyan, and ordinary text contrast is at least 4.5:1.
- State changes must not cause layout shift and should respect reduced motion.

## Visual spec

- Keep the existing white floating toolbar and do not introduce purple or any new primary color.
- Control corner radius is `5px`; toolbar corner radius is at most `8px`.
- Use Lucide `ChevronDown` for arrows, not text characters or emoji.
- Popups use unified border and shadow elevation.
- The theme palette is about `146px` wide; the custom panel is about `244px` wide.
- Menus should auto-flip or translate so they remain inside the viewport and visible A4 area.
- Validate the reference page at `1440 × 900` with no horizontal or vertical overflow.

## Test plan

### Pure functions

- RGB boundaries: `0`, `255`.
- Reject non-integer, empty, NaN, and out-of-range values.
- RGB ↔ HEX conversion and uppercase 6-digit normalization.
- Stability of RGB after color-field value conversion.

### Component tests

- The font-size control sits after strikethrough and before align-left.
- The color control sits after font size and before align-left.
- The current size item is checked in the size menu, and selecting it closes the menu and restores focus.
- Theme-color selection calls `addStyles`.
- The primary color button reuses the recent color.
- `More Colors…` opens the secondary panel and closes the theme palette.
- Invalid RGB does not submit; valid values submit normalized HEX.
- Cancel and Escape do not modify the editor.

### Playwright

- Real drag-selection on a single-leaf text applies font size and theme color.
- Real drag-selection in a narrow split leaf applies bold, font size, and custom RGB.
- Save status changes and autosaves.
- Font size and color still exist after reload.
- The theme palette and More Colors panel are not clipped by the card, canvas, or toolbar.
- Keyboard fully operates the size menu and RGB panel.
- PDF export finishes without error, and PDF unit tests validate color drawing commands.

## Implementation order

1. First add failing tests for RGB/HEX pure functions.
2. Implement and validate color-value normalization.
3. Add tests for the font-size composite dropdown and replace the existing size button.
4. Add tests for the theme-color composite button and replace the default `ColorStyleButton` position.
5. Add tests for the More Colors panel and RGB validation.
6. Integrate the unified Selection Guard.
7. Add Playwright regressions for single-leaf and narrow split leaves.
8. Add HTML/PDF regressions for custom colors.
9. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, and `pnpm build`.

## Acceptance criteria

1. Font size appears after strikethrough and before alignment, and the collapsed state does not show `px`.
2. The font-size arrow expands a fixed-size menu where the current item is identifiable and keyboard operable.
3. Font color is to the right of font size, and the underline below A accurately shows the current or recent color.
4. Theme-color selection, quick reuse, and More Colors all correctly apply to the current selection.
5. The hue field and RGB inputs synchronize bidirectionally, and RGB accepts only integers `0–255`.
6. No transparency setting exists; written values are standardized to 6-digit HEX.
7. Bold, italic, underline, strikethrough, font size, color, and links do not lose selection because of toolbar clicks.
8. Save, undo/redo, reload, and PDF export preserve font size and color.
9. All menus avoid clipping, page overflow, and layout shift.
10. Mouse, keyboard, and screen readers can all complete the core operations.

## Implementation validation

- The font-size composite control now sits after strikethrough and before alignment, and its collapsed state shows the number with a separate arrow.
- The font-color composite control now sits immediately beside font size and supports a theme palette, quick recent-color apply, a `react-colorful` hue field, and precise RGB `0–255` input.
- Custom colors normalize through tested RGB/HEX pure functions. After BlockNote serialization, HEX may be represented as CSS `rgb(...)`; the PDF parser already supports that standard form.
- Font-size and color arrows open during `pointerdown`, avoiding Tauri WebView recomputing selection and unmounting the popup between `mousedown` and `click`; keyboard activation still uses click/Enter/Space.
- Browser tests cover real selection for font size, theme color, custom RGB, autosave, and reload; formatting in narrow split columns remains correct.
- Four secondary popups—paragraph, size, color, and link—are all covered for pointerdown and full pointer-click interaction; bold, italic, underline, strikethrough, alignment, nest/unnest, paragraph type, and link all verify real content changes.
- Paragraph, size, color, and link popups are all portaled to `document.body`, so they are no longer clipped by BlockNote toolbar `overflow: auto`; they follow the trigger on scroll/zoom and auto-flip or translate near viewport edges.
- The `More Colors` panel has been restored to 244px width; live page measurement is 244×220px and shows the full color field, RGB fields, and action buttons.
- Validation: 84 Vitest files / 461 tests, 47 Playwright tests, TypeScript, and production build all pass; ESLint retains only the existing ThemeProvider Fast Refresh warning.
