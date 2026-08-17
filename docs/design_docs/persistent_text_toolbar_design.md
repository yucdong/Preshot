# Persistent text toolbar and zoom-component chrome design

## Status

- Status: Implemented and validated
- Date: 2026-08-10
- Interaction reference: `docs/design_refs/preshot-persistent-text-toolbar-review.html`
- Method: `ui-ux-pro-max`, density 9, motion 2; follows keyboard reachability, non-hover dependence, readable menus, and safe positioning
- Visual baseline: `design-system/preshot/MASTER.md`

## Problem diagnosis

1. The current paragraph menu is 176px wide and items use fixed `h-8`. When long Chinese labels wrap to two lines, they are still constrained to 32px height, so items such as "Collapsible heading level 1" overlap each other.
2. The current text-format bar comes from BlockNote's floating selection toolbar and appears only after editing/selection activation, which does not fit the workflow where every text box should always show its controls.
3. Current close-button size and negative offset are both multiplied directly by canvas `scale`. At 1.125× canvas scale, the measured button is 18px with offset -9px. Although the number changes with scale, it still belongs to an absolutely positioned layer inside the component and is affected by natural height, padding, and overflow, so the visual anchor is unstable.
4. BlockNote's own toolbar still uses `overflow: auto`. Secondary menus have already been fixed with portals and must not regress back into toolbar children.

## Recommended structure

Each `PlanTextLeaf` uses the following three-layer structure:

```text
TextLeaf
├─ PersistentLeafToolbar   persistent, participates in screen layout, not exported
├─ RichTextEditorContent   measures only natural body height
└─ PortaledMenus           mounted to document.body, does not contribute to leaf height
```

Component-level buttons stay independent from the leaf:

```text
ComponentFrame
├─ ComponentChromeLayer    ordering, close, resize state
└─ TextTree                leaves and body
```

## Persistent toolbar

- Every text leaf always shows a 36px toolbar at the top, without depending on hover, selection, or focus.
- Default order: paragraph type, bold, italic, underline, strikethrough, font size, color, alignment, link, more.
- The toolbar belongs to screen editing chrome and is ignored by PDF export.
- Toolbar height counts toward the component's natural screen height; body measurement must exclude the toolbar so chrome is not mistaken for PDF text height.
- With no selection, commands apply to the current insertion point or future input; with a selection, they apply to the selection.
- Inactive leaf toolbars stay visible but use a subdued background; the active leaf uses a cyan border/focus ring without changing size.

### Responsive density

Use leaf-container queries instead of viewport media queries:

- `>= 420px`: full single-row toolbar.
- `280–419px`: shorten paragraph labels and move low-frequency actions such as align-right / nest into "More".
- `< 280px`: paragraph shows only `T/H1/H2` icons; keep B/I/U, font size, color, and More, with no horizontal scrolling.
- Low-frequency capabilities must always remain accessible from the More menu and never disappear because of width.

## Paragraph menu

- Mount to `document.body` through the existing viewport-aware portal.
- Increase width from 176px to 220px.
- Each item uses three columns: `22px icon / label / 16px checkmark`.
- Use `min-height: 36px` rather than fixed height.
- Labels use `white-space: nowrap`, font size 12px, and line height 20px.
- Maximum height is `min(420px, 100vh - 16px)`, and the menu itself scrolls.
- Near the bottom edge, it flips above the trigger automatically; keep at least 8px safe distance on all sides.
- Keyboard supports up/down movement, Enter apply, and Escape close + return focus to the trigger.

## Close button

Recommended as component-level screen-space chrome:

- Anchor to the upper-right corner of `ComponentFrame.getBoundingClientRect()`.
- Place the button `4–6px` inside the outer border instead of using negative `right/top: -8 * scale` offsets.
- Visual size changes with bounded scaling: `clamp(18px, 18px * scale, 22px)`.
- Update the anchor on every component ResizeObserver event, canvas zoom, or scroll.
- Natural-height changes move only the anchor and do not participate in body measurement.
- The button uses graphite by default, switches to danger on hover/focus, and keeps `aria-label` plus a 2px focus ring.

This solves both "incorrect position" and "unstable behavior under zoom": the button follows the real component-frame rect rather than an inferred inner-padding coordinate.

## State and motion

- The toolbar is persistent and has no enter/exit animation.
- Menus use 120–160ms opacity + translateY(2px); reduced motion disables the motion.
- Activating a leaf changes only border/background and never changes toolbar or body size.
- Width/height animation is prohibited to avoid text measurement and save loops.

## Implementation path

1. Extract reusable command models and `PersistentLeafToolbar` from `PreshotFormattingToolbar`.
2. Render the toolbar persistently inside `TextLeafEditor` while keeping each BlockNote editor's own selection state.
3. Remove floating-visibility responsibility from `FormattingToolbarController`; keep the BlockNote editor body.
4. Change the paragraph menu to 220px, content height, single-line labels, and add keyboard roving focus.
5. Move the component close button into an independent `ComponentChromeLayer` positioned from frame rect.
6. Update natural-height calculation: screen component height includes toolbar, but PDF/text measurement reads body only.
7. Validate single-leaf, left/right split, top/bottom split, nested leaves, and 72%–125% canvas zoom.

## Acceptance criteria

1. Every text box shows a formatting toolbar without hover.
2. All paragraph-type labels avoid wrapping, overlap, and clipping.
3. The narrowest supported leaf has no horizontal scroll, and all commands remain reachable through More.
4. Paragraph, size, color, and link menus all escape toolbar clipping boundaries.
5. After component resize, natural-height changes, scrolling, and canvas zoom, the close button remains anchored to the upper-right corner.
6. The toolbar never enters PDF and does not pollute body-height measurement.
7. Mouse, keyboard, and screen readers can all complete the core formatting operations.
8. Theme colors and custom RGB must actually write to the current selection; tests should read editor HTML/CSS styles and confirm the color still exists after autosave and reload.

## Design validation

- In the interaction reference, selecting "35mm portrait session" and applying functional cyan writes `color="#0891b2"` into the DOM, and the browser-computed color is `rgb(8, 145, 178)`.
- The reference also updates the color-button underline and the status text `Applied: #0891B2`; after the palette closes, the body color remains.
- Production Playwright covers full pointer clicks on theme colors, custom RGB `#C2385C`, autosave, and reload persistence, and the related tests pass.
- At 960×720 and 72% canvas zoom, the narrow toolbar satisfies `scrollWidth === clientWidth`, the page has no horizontal overflow, and the close button remains `18×18px` in screen space inside the safe upper-right border zone.
- The paragraph menu is 220px wide and item labels use a single-line layout; when expanded, each item is 36px high, and labels such as "Collapsible heading level 1" no longer overlap.
- Every text leaf now always shows its own formatting bar; narrow leaves retain paragraph, B/I/U, font size, color, link, and "More formatting", while alignment/nesting are reached through the portaled More panel.
- The close button uses a fixed `18×18px` screen-space size and centers on the component-frame upper-right corner with a 1px border tolerance; it no longer multiplies by canvas scale.
- `screenHeightPoints` drives only the runtime canvas outer frame; pure body `heightPoints` still drives persistence, pagination, and PDF, so the toolbar never enters export or project schema.
- Reference images now load concurrently and commit aspect ratio once, avoiding interruption of text runtime measurement by sequential image loading.
- Final validation: 84 Vitest files / 461 tests, 47 Playwright tests, TypeScript, and production build all pass; ESLint retains only the existing ThemeProvider Fast Refresh warning.
