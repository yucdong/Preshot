# Requirement 0809 Editor UX Design

> Text-card title and sizing rules in this document are superseded by the approved two-layer schema-v10 design in `docs/superpowers/specs/2026-08-10-two-layer-text-card-design.md`. Project, image, formatting, and canvas-fit decisions remain applicable.

## Status

Draft for user confirmation. No production implementation should begin until the decisions in **Confirmation Gate** are approved.

## Goal

Extend the existing Editorial Studio workbench without changing its visual identity. The canvas remains the dominant surface while text editing, internal text layouts, image sizing, project management, and responsive A4 fitting become more direct and predictable.

Approved visual foundation: `design-system/preshot/MASTER.md`.

Review sketch: `docs/design_refs/preshot-requirement-0809-workbench.html`.

## Requirement Understanding

1. Move Insert from a centered floating island to the upper-left of the canvas work area, aligned with the white A4 page edge.
2. Add selected-text font-size formatting. Text measurement must update the text block and component height after formatting.
3. Treat component IDs as immutable GUID identity. GUIDs stay internal and are never rendered as labels. Display names may repeat.
4. A text component is a recursively splittable tree. Any leaf can split left/right or top/bottom while the outer component rectangle remains unchanged at the split command. Only leaf titles appear in the canvas.
5. Text regions use an I-beam cursor. Selection formatting for bold, italic, underline, strike, color, links, and font size must visibly apply and persist.
6. The reference-group average image height can be typed directly in pixels as well as changed with minus/plus. Invalid values do not commit and the previous persisted value is restored.
7. A project can be removed from the recent-project registry after confirmation. This is a soft removal and never deletes its directory or files.
8. Project identity is GUID-based and display titles may repeat. Hover/focus on a rail item reveals its full path plus Reveal Folder and Remove actions.
9. Automatic A4 fitting keeps a stable white-paper-to-gray-workspace ratio as the window changes size. Manual Ctrl+wheel zoom remains relative to that fit.

## UI/UX Pro Max Interpretation

The generated general recommendation leaned toward a retro photography landing page. That pattern is rejected because Preshot is a dense operational editor, not a marketing surface. Applicable high-priority guidance is retained:

- all controls are keyboard reachable in visual order;
- visible focus rings and WCAG AA text contrast;
- controlled numeric input with inline, announced validation;
- 150-240ms state transitions based on opacity/transform;
- no hover-only capability: project actions also appear on focus-within;
- no layout animation during text measurement or window resize;
- no emoji controls; use Lucide icons.

## Recommended Interaction Design

### Canvas-aligned Insert

- The Insert button sits 10px above the first A4 page and shares its left edge.
- It is sticky within the canvas scroller so it stays reachable while scrolling pages.
- It remains outside the printable page and never enters PDF export.
- Opening it reveals the existing `文案` and `图片组` menu downward.

### Text Selection Toolbar

- No font or font-size field is permanently rendered in the text card header or above the card.
- When a text body enters edit mode, show BlockNote's contextual formatting toolbar near the active leaf/selection. Hide it when focus leaves text editing, except while focus is moving into the toolbar itself.
- Add a compact font-size menu: `10 / 12 / 14 / 16 / 18 / 24 px` plus a controlled custom value. The menu applies to the current selection; with a collapsed caret it sets the size for subsequent typing.
- Bold, italic, underline, strike, color, and link operate on the current selection/caret. Mixed selections display an indeterminate formatting state.
- Leaf split controls are separate hover/focus actions and never appear inside the text-formatting toolbar.
- The contextual toolbar is an overlay and consumes no card or leaf layout height.
- The editable content region uses `cursor: text`; component border and resize handles retain their own cursors.
- Formatting causes DOM remeasurement. Single-block cards grow or shrink naturally; split cards initially retain their outer bounds, then grow only if either pane cannot contain its content.

### Text Block Layout

Confirmed direction: recursively splittable leaf blocks.

Rules:

- Split action duplicates no content: existing content stays in the first child; the second child starts empty.
- Any leaf can split into two children with `columns` or `rows`; nested splits may combine both axes.
- Switching one branch between columns/rows preserves both child IDs, titles, HTML, and descendants.
- Merge combines the branch's leaves in visual order with paragraph boundaries and retains the parent component ID.
- Outer component width/height does not change at the split command.
- Gap is fixed at `12pt` for every split branch and scales visually with the page.
- Each leaf has one optional visible `title`; no outer text-component title, type label, or GUID label is rendered.
- Empty titles consume no title-row height and do not export. Hover/focus within the untitled leaf reveals an `插入标题` affordance without shifting content.
- The selected leaf exposes local split controls; recursive structure is communicated through dividers, not nested decorative cards.

### Text Schema Proposal

Schema v9 replaces one `html` field with internal blocks while preserving the outer component ID:

```ts
interface PlanTextLeaf {
  id: string; // UUID
  title: string; // may be blank or duplicate
  html: string;
}

interface PlanTextSplit {
  id: string; // UUID
  direction: "columns" | "rows";
  gap: number; // 12pt default
  children: [PlanTextNode, PlanTextNode];
}

type PlanTextNode = PlanTextLeaf | PlanTextSplit;

interface PlanTextComponent extends BaseComponent {
  type: "plan";
  name: string; // display metadata; duplicates allowed
  textRoot: PlanTextNode;
}
```

Migration v8 -> v9 creates one leaf with a new deterministic migration UUID, blank title, and the former `html`. Existing component IDs remain unchanged. Continuations operate on leaf IDs and preserve titles. Tree depth and minimum leaf dimensions are validated to prevent unusable layouts.

### Numeric Image Height

- Replace the read-only `136pt` output with a compact controlled field displaying pixels, e.g. `181 px`.
- UI conversion uses `1pt = 4/3px`; persisted dimensions remain points for PDF geometry.
- Recommended valid range: dynamic `32px` minimum to the existing one-page maximum.
- Minus/plus continue using the existing 4pt step, displayed as the nearest integer pixel.
- Enter/blur commits. Escape restores. Empty, nonnumeric, or out-of-range values show an inline error and restore the previous value without persistence.
- Use `inputmode="numeric"`, `aria-invalid`, and a nearby `role="alert"` message.

### Project Rail Actions

- Hover or keyboard focus reveals a lower metadata strip without changing item height.
- The full path uses middle ellipsis visually and is exposed through `title`/accessible description.
- Folder icon reveals the project directory through a workspace-level port and narrow Tauri command.
- Trash icon opens the existing confirmation dialog. Confirmation targets immutable `projectId` and removes only that registry record, even when multiple projects share the same title.
- If the active project is removed, open the next most-recent available project; if none remains, show the launcher.
- Duplicate display titles are allowed. Identity and React keys use `projectId` only.
- For a new project whose display title duplicates a sibling folder, recommended behavior is a unique folder suffix while preserving the requested display title.

### Responsive A4 Fit

- Replace the fixed `0.92` maximum with a canvas-width occupancy target.
- Recommended auto-fit paper width: `82%` of available canvas width.
- Side gutter: `clamp(32px, 9%, 88px)`.
- Automatic scale range: `0.5-1.15`.
- Fit scale changes continuously with the canvas ResizeObserver.
- User zoom remains a multiplier over fit scale and remains pointer-anchored.
- At native minimum window width, the page may use up to 90% width; at wide/fullscreen sizes it remains near 82% instead of becoming visually tiny.

## Motion And States

- Toolbar/menu enter: 160ms opacity + translateY(4px).
- Project hover actions: 180ms opacity only; item dimensions stay fixed.
- Split-mode switch: no animated width/height. Crossfade content dividers in 160ms.
- Numeric commit success: no toast; layout responds immediately.
- Numeric error: danger border + inline message, announced once.
- Respect `prefers-reduced-motion` globally.

## Accessibility

- Every selected leaf exposes separate Split Horizontally and Split Vertically commands; each branch orientation control uses `aria-pressed` when applicable.
- Every child text block has a distinct localized accessible label including its title or position.
- Project actions are available with Tab and remain visible under `focus-within`.
- Soft-delete dialog states explicitly that project files remain on disk.
- Reveal Folder and Remove use separate buttons and accessible names; color is not the only danger cue.
- The numeric image field preserves the last valid value and never silently clamps invalid user input.

## Architecture And Testing

### Domain

- Schema v9 migration and strict validation.
- Duplicate component/project display names accepted; IDs remain unique.
- Pure recursive reducers for leaf split, branch orientation switch, branch merge, leaf title update, and leaf HTML update.
- Domain validation for numeric image height conversion and range.

### UI

- Canvas-aligned sticky insert anchor.
- Contextual text formatting and font size.
- Two-block renderer and selection-aware measurement.
- Project hover/focus actions and confirmation.
- Responsive occupancy-based fit.

### Infrastructure

- Workspace `revealProjectDirectory(projectPath)` port.
- Tauri implementation opens the directory itself, not a child file.
- Existing registry removal remains the soft-delete implementation.

### Regression Coverage

- Migration v8 -> v9 and duplicate names.
- Nested split/merge/orientation operations preserve unaffected IDs, content, and outer bounds.
- Bold/italic/font-size selection persists and remeasures.
- Invalid image pixels restore the previous value and never mutate history.
- Active-project soft removal chooses the next project without touching files.
- Reveal Folder invokes only the workspace boundary.
- A4 occupancy remains within accepted bounds at 960, 1200, 1600, and fullscreen-like widths.
- PDF exports all text blocks, optional titles, font sizes, and split geometry.

## Delivery Phases

1. Schema v9 identity/name and text-block domain migration.
2. Split text UI, selection formatting repair, font-size persistence, PDF parity.
3. Numeric image size editor and validation.
4. Project rail reveal/soft-remove/duplicate-title behavior.
5. Canvas-aligned Insert and occupancy-based responsive fit.
6. Full visual, migration, PDF, Tauri, and E2E validation.

## Confirmation Gate

Recommended defaults are marked **Recommended**.

1. Recursive split depth: unlimited subject to minimum leaf size (**Recommended**) or an explicit maximum depth?
2. Untitled leaf behavior: content remains fully visible and only the title row is collapsed (**Recommended**) or collapse the entire leaf content?
3. Active project removal: automatically open next recent project (**Recommended**) or require switching first?
4. Duplicate project creation: preserve duplicate display title and auto-suffix the folder (**Recommended**) or ask for a separate folder name?
