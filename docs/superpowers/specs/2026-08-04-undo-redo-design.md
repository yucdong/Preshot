# Undo / Redo — Design

PRD sub-project 4. A structural undo/redo for the canvas, layered on the existing
pure-reducer + `applyPlan` mutation path, while leaving rich-text (BlockNote)
editing to BlockNote's own Ctrl+Z.

## Goal

The user can undo/redo structural & layout changes on the canvas (add/remove/
move/resize components, image add/remove/reorder/caption, image height, titles,
caption toggle) via toolbar buttons and Ctrl+Z / Ctrl+Shift+Z (and Ctrl+Y).
Typing inside a plan/description editor is undone by BlockNote when that editor
is focused — the two systems never fight over Ctrl+Z.

## Decisions (from brainstorming)

- **Snapshot-based, capped in-memory history** (~50 states) of the `ProjectPlan`
  JSON. In-memory only; reset on each project open (not persisted).
- **Structural scope only:** history is pushed for structural/metadata changes,
  NOT for plan `html` / reference `description` edits (BlockNote owns those).
- **Focus routing:** Ctrl+Z/Ctrl+Shift+Z trigger global undo/redo ONLY when no
  rich-text editor (BlockNote/contenteditable) is focused; when one is focused,
  the event is left to BlockNote.
- **Text preserved on restore:** undoing/redoing a structural change restores the
  structural state but keeps the CURRENT text of components that still exist
  (matched by id) — a structural undo never rewinds text the user typed.

## Architecture & Data Flow

The `ProjectCanvasProvider` is the single mutation point (`applyPlan`). History
wraps it.

```
structural handler -> applyStructural(next)  -> push prev to undoStack, clear redo -> applyPlan(next)
text handler       -> applyPlan(next)         (no history)
undo -> target = undoStack.pop(); redoStack.push(current); applyPlan(mergeText(target, current))
redo -> target = redoStack.pop(); undoStack.push(current); applyPlan(mergeText(target, current))
```

### Pure history core (`src/domain/plan/canvas/history.ts`)

- `createHistory(limit = 50)` → a pure, testable stack model:
  `{ past: ProjectPlan[]; future: ProjectPlan[] }` with
  `record(state, prev)` (push `prev` to `past`, clear `future`, cap `past`),
  `undo(state)` / `redo(state)` → `{ next, history } | null`,
  `canUndo`/`canRedo`.
- `mergeStructural(target: ProjectPlan, current: ProjectPlan): ProjectPlan`
  (pure): returns `target` where every component that also exists in `current`
  (by id) keeps `current`'s `html` (plan) / `description` (reference); components
  only in `target` keep their own text. This yields "structural undo, current
  text preserved". Unit-tested.
- `coalesceKind`: consecutive structural changes of the SAME coalescing key
  (e.g. `resize:<id>`, `imageHeight:<id>`) within a short window replace the top
  `past` entry instead of pushing a new one, so a drag/stepper burst is ONE undo.

### Provider integration (`src/features/plan/ProjectCanvasProvider.tsx`)

- Hold `historyRef` (the pure model) + `canUndo`/`canRedo` state; reset on load.
- A `mutate(next, opts?: { coalesceKey?: string })` helper for STRUCTURAL
  handlers: `historyRef = record(...)` (with coalescing) then `applyPlan(next)`.
  Route the structural handlers (`handleMoveComponent`, `handleResize`
  [coalesceKey `resize:<id>`], `handleRemoveComponent`, `handleAddImages`,
  `handleRemoveImage`, `handleMoveImage`, `handleSetImageHeight` [coalesce],
  `handleSetTitle`, `handleSetImageCaption`, `handleToggleCaptions`,
  `handleInsert`, seed) through `mutate`. Leave `handleChangeHtml` /
  `handleSetDescription` on plain `applyPlan` (no history).
- `undo()` / `redo()`: compute via the pure model + `mergeStructural`, `applyPlan`
  the result, update `canUndo`/`canRedo`. (Undo/redo do NOT re-record.)
- Keyboard: a `keydown` handler — if the active element is inside a BlockNote/
  contenteditable, return (let BlockNote handle); else Ctrl/Cmd+Z → undo,
  Ctrl/Cmd+Shift+Z or Ctrl+Y → redo, `preventDefault`.
- Toolbar: 撤销 / 重做 buttons (i18n `history.undo`/`history.redo`) in the top
  bar, disabled when `!canUndo`/`!canRedo`.

## Error Handling

- Undo/redo are no-ops when the stack is empty (buttons disabled; shortcuts
  ignored). History operations are pure and never throw. A capped history bounds
  memory; snapshots are structuredClone/JSON copies so later mutations can't
  corrupt past states.

## Testing

- **Domain (pure):** `record` (push/clear-future/cap), `undo`/`redo` sequences,
  `canUndo`/`canRedo`, coalescing (two same-key records → one past entry),
  `mergeStructural` (keeps current html/description for surviving components,
  restores structure, uses target text for re-added components).
- **Component:** structural change then `undo()` reverts it (via a driven
  provider test); a text (`handleChangeHtml`) change does NOT create an undo
  entry; the keyboard handler ignores Ctrl+Z while a contenteditable is focused
  and triggers undo otherwise; buttons disable correctly.
- **E2E:** insert a component (appears at top) → Ctrl+Z removes it → Ctrl+Shift+Z
  restores it; move/resize → undo reverts; typing in the editor + Ctrl+Z undoes
  text (BlockNote), not the last structural action.

## Documented Limitations

- History is per-session (not persisted across app restarts). Text editing undo
  is BlockNote's (per-editor), independent of the global structural history.
