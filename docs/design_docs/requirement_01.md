# Card arrow ordering

## Requirements

- Do not allow users to change component order by dragging cards with the mouse.
- Provide two icon+label buttons on the left canvas edge of each card: "Move up" and "Move down".
- Each click moves the component by exactly one position in the document array; the A4 document flow then automatically reflows and repaginates.
- Disable Move up on the first card and Move down on the last card.
- The arrow controls are editing chrome and must not appear in PDF export.
- Drag sorting of images inside an image group remains unchanged.

## Interaction and accessibility

- Use Lucide `ChevronUp` / `ChevronDown` line icons, not text arrows or emoji.
- Hide the controls by default; show them when the user hovers a card or when keyboard focus enters the controls, together with visible "Move up" and "Move down" labels.
- The button group must stay completely outside the left card border, must not cover the border or resize handle, and must keep a `2pt` gap from the border.
- Each individual button is approximately `20pt × 17pt`, using compact icon+text styling without increasing A4 page margins or changing component content width.
- Buttons provide Chinese accessible names meaning "Move up one position" and "Move down one position".
- Keyboard users can focus the buttons with Tab and activate them with Enter/Space.
- Disabled buttons use native `disabled` state and remain visually distinguishable.
- Do not render a component drag handle, grab cursor, drag placeholder, or component drag overlay anymore.

## Data and history

- Reuse `reorderComponent(plan, { id, toIndex })`; array order is the only source of vertical ordering.
- Each click produces one structural history record so Ctrl+Z/Ctrl+Y can undo and redo it.
- Autosave persists the new order, and the order stays the same after reload.

## Acceptance criteria

- No card can change order through pointer drag.
- A middle card can move up or down by one position; first/last boundaries never go out of range.
- After movement, cards automatically reflow or repaginate under A4 rules.
- Image drag, card resize, text editing, and whole-image-group scaling do not regress.
