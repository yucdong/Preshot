# Preshot Design System

## Direction

Editorial Studio: a fashion-forward photography planning editor with graphite global chrome, paper-white content, berry primary actions, and functional cyan editing states. It borrows the clarity and contextual-tool rhythm of modern creative software without copying another product's branding.

Design dials: variance 7/10, motion 5/10, density 7/10.

Approved reference: `docs/design_refs/preshot-editorial-hifi.html`.

## Principles

1. The A4 page is always the visual focus, remains white in both themes, auto-fits with a maximum scale of 0.92, and supports pointer-anchored Ctrl+wheel zoom from 25% to 150%.
2. Global chrome is graphite; repeated cards and dialogs use at most 8px radius.
3. Functional cyan communicates selection, focus, resize, and editing. Berry is reserved for prominent creation/export actions.
4. Danger has its own semantic color and is never communicated by color alone.
5. Motion explains state changes only, lasts 150-200ms, and respects reduced-motion preferences.

## Color Tokens

| Role | Light | Dark |
|---|---|---|
| App background | `#DFE1E5` | `#23262B` |
| Panel | `#F7F6F4` | `#17191D` |
| Strong panel | `#FFFFFF` | `#202329` |
| Ink | `#18181B` | `#F4F4F5` |
| Muted ink | `#6B6F76` | `#A7ABB3` |
| Border | `#D7D6D3` | `#35383F` |
| Graphite primary | `#202329` | `#F4F4F5` |
| Functional cyan | `#0891B2` | `#22B8D6` |
| Accent berry | `#C2385C` | `#DB6B87` |
| Danger | `#B42342` | `#F091A3` |

Paper tokens are invariant: paper `#FFFFFF`, ink `#18181B`, border `#DADBDD`, functional primary `#0891B2`, danger `#A43F52`.

Use semantic Tailwind classes from `src/styles.css`: `app-*` for shell surfaces and `paper-*` inside A4 content.

## Typography

- Display headings and brand: bundled Outfit Variable, then Noto Sans SC.
- Body and controls: bundled Noto Sans SC, then Nunito Sans Variable.
- Fallbacks: Microsoft YaHei UI, Segoe UI Variable, system sans-serif.
- Scale: 12, 14, 16, 20, 24, 32px.
- Body line height: 1.5-1.7. Labels use 500-600 weight; headings use 600-700.
- Letter spacing remains zero except source content that explicitly requires otherwise.

## Layout

- Header: 58px, fixed graphite.
- Default workbench: `192px / 6px splitter / flexible canvas / 6px splitter / 272px`; the narrower side panels make the canvas the dominant column.
- Global persisted ranges: project rail 176–320px, assistant 240–420px, canvas drag constraint 480px; below the native 960px window minimum CSS may shrink the canvas safely.
- Spacing follows a 4/8px system.
- A4 paper uses a graphite-neutral shadow, no dark-mode recoloring, and a maximum automatic scale of 0.92. Ctrl+wheel applies 10% zoom steps around the pointer while ordinary wheel input retains native scrolling.
- Do not nest decorative cards or wrap whole page sections in floating cards.

## Components

- Buttons and dialogs: 8px radius maximum; icon buttons have visible labels through `aria-label`.
- Primary global/action chrome: graphite. Insert/export: berry. Selection/focus/resize: cyan. Destructive confirmation: danger.
- Icons: Lucide outline icons, usually 16-20px with 1.8-2px stroke.
- Focus: visible 2px semantic ring; keyboard order follows visual order.
- Disabled controls: semantic `disabled`, reduced opacity, and no pointer action.
- Component order uses hover/focus-revealed up/down edge controls, never component drag. Image tiles retain drag-and-drop with cyan placeholders and overlays.
- Reference group sizing uses minus/value/plus controls: 24pt minimum, exact 4pt steps, dynamic one-page maximum.
- Floating tool surfaces use graphite with 160–240ms opacity/transform feedback; avoid layout animation for hover.
- Modals: 55% black scrim with subtle 2px backdrop blur, visible close/cancel route.

## Accessibility And Responsive Checks

- Normal text contrast must meet WCAG AA 4.5:1.
- Do not rely on color alone for save, error, or selection states.
- Respect `prefers-reduced-motion` globally.
- Verify at 900x800 and 1440x900 desktop sizes with no horizontal overflow.
- Preserve keyboard alternatives for drag and all modal focus behavior.
