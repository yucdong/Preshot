# Text Card Content-Fit Resize Design

## Status

Implemented and browser-verified on 2026-08-10.

Interactive review: `docs/design_refs/preshot-text-card-two-layer.html`.

## Problem

The current plan card reserves `24pt` for an empty component header, `4pt` for a content gap, and `12pt` on every outer edge. In the measured browser example, the text body occupies about `95.4%` of card width but only `72.5%` of card height. The visible empty band makes the text editor feel detached from its card.

The existing global card minimum also permits a resize preview that is smaller than the rendered text tree. Natural-height correction occurs afterward, so the pointer can temporarily pull the outer frame across its leaves.

## Recommended Layout

- Text cards use compact plan-specific chrome; reference cards keep their current header geometry.
- The component close button becomes an overlay at the upper-right corner and consumes no flow height.
- The visual safety zone changes from `12pt` to `6pt` on all sides: `5pt` frame padding plus the `1pt` leaf border.
- The text tree fills the complete inset body. Split parents remain invisible.
- Leaf borders stay visible, preserving the approved two-level hierarchy.
- Target occupancy for a fitting single leaf is about `98%` of outer width and at least `90%` of outer height.
- Split gap remains `10pt`; toolbar overlays remain outside layout measurement.

## Content-Fit Resize Lock

Every pointer preview is clamped before it reaches the DOM. The frame, text tree, and leaf editors therefore remain nested throughout the gesture, not only after pointer release.

### Width

- Minimum editable leaf width: `132pt`.
- A leaf requires `132pt`.
- A columns node requires `left minimum + gap + right minimum`.
- A rows node requires `max(left minimum, right minimum)`.
- The outer card adds `12pt` total horizontal inset.
- Left/right shrinking stops at the recursively calculated card width.

### Height

- Each leaf reports its natural rendered height at the current preview width, with a `64pt` floor.
- A columns node requires the maximum recursive child height.
- A rows node requires both recursive heights plus its gap.
- The outer card adds `12pt` total vertical inset.
- Top/bottom shrinking stops at this measured natural card height.
- If narrower wrapping would make the natural tree exceed one printable page, width shrinking stops at the last fitting preview.

The last valid rectangle is the only rectangle committed. No clipped intermediate state and no corrective snap after pointer release are shown.

## Boundary Feedback

- At the limit, the active resize edge and handle remain amber while the pointer is held past the boundary.
- A small adjacent status bubble says `内容已达到最小尺寸` and uses `aria-live="polite"`.
- The cursor remains the appropriate resize cursor; the edge simply stops following movement beyond the limit.
- Moving back toward a larger size resumes immediately.
- No modal, toast, or persistent warning is used.
- Reduced-motion mode removes the brief color transition.

## Acceptance Criteria

1. Text body occupancy is at least `97%` of outer width and `90%` of outer height for the representative single-leaf card.
2. Every leaf, BlockNote wrapper, editor, and ProseMirror rectangle stays inside all four outer card edges during preview and after commit.
3. Left/right resizing never gives any leaf less than `132pt` logical width.
4. Top/bottom resizing never gives the tree less than its measured natural height.
5. When the limit is reached, continued pointer movement cannot change the preview rectangle.
6. Boundary feedback is visible, keyboard/screen-reader announced, and does not shift layout.
7. Growing the card remains immediate; widening reflows text and may reduce the natural minimum height.
8. Screen and PDF geometry continue to use the same persisted width, split topology, and gaps.

## Confirmation Defaults

- `6pt` outer inset.
- `132 × 64pt` minimum editable leaf.
- Amber edge feedback with the text `内容已达到最小尺寸`.
- Text-card close button remains an upper-right overlay.

## Implementation Verification

- Plan cards use `5pt` CSS padding plus the `1pt` frame border as a shared `6pt` visual inset; reference-card chrome is unchanged.
- Horizontal previews use immediate CSS natural height, then converge on ResizeObserver measurements, so wrapping cannot outrun the frame during a gesture.
- The representative single-leaf browser card measured `97.96%` body-width occupancy and `92.05%` body-height occupancy.
- A two-column card stopped at `286pt`; both leaves measured about `132.96pt`, remained contained, and had no scrollbars.
- The screen continuation model and PDF renderer use the same compact plan inset and zero-height plan header.
- Validation: 83 Vitest files / 456 tests, 42 Playwright tests, 48 Rust tests, 4 initializer checks, TypeScript, production build, and ESLint with only the existing ThemeProvider Fast Refresh warning.