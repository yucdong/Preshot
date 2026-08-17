# Block operation controls design

Status: Implemented
Interaction draft: `docs/design_refs/preshot-block-operations-controls-demo.html`

## Official API mapping

The design is based on BlockNote's official documentation:
[Manipulating Content](https://www.blocknotejs.org/docs/reference/editor/manipulating-content)
and
[Block Side Menu](https://www.blocknotejs.org/docs/react/components/side-menu):

| Capability | BlockNote API | Preshot control |
| --- | --- | --- |
| Read structure | `editor.document`, `getBlock`, `getPrevBlock`, `getNextBlock`, `getParentBlock`, `forEachBlock` | Menu title shows type, level, and parent |
| Insert | `insertBlocks` | Left `+`, menu entries "Insert above/below" |
| Update / convert | `updateBlock` | "Convert to" submenu |
| Delete | `removeBlocks` | Danger-colored "Delete" with undo toast after completion |
| Replace | `replaceBlocks` | Future template / composite block operations |
| Move | `insertBlocks`, `removeBlocks`, `transact` | Menu shortcut arrows reorder sibling subtrees; `Alt+↑/↓` calls the same path; the handle uses Pointer Events to place before/after/inside on the zoomed canvas |
| Nest | `canNestBlock`, `nestBlock`, `canUnnestBlock`, `unnestBlock` | Menu indent / outdent, `Tab/Shift+Tab` |

## Current project constraints

- `imageGroup` does not support ordinary indentation-based nesting. It may exist as a top-level block or as a direct child inside a column.
  "Increase indent" therefore remains disabled, and left/right edge dropping is used to enter column layout.
- Copying a regular block duplicates the full subtree and regenerates all block IDs.
- Copying `imageGroup` continues to call `ImageGroupBlockController.cloneGroup`, generating new group/image IDs while reusing the underlying image files.
- Image-group deletion continues to rely on the existing tombstone mechanism so BlockNote undo can restore it; files are deleted only during project retirement cleanup.
- Moving a parent block must move its entire child subtree together and may not break the hierarchy apart.
- Menu move-up / move-down must not implicitly change nesting level. Native BlockNote `moveBlocksUp/moveBlocksDown` can enter/leave children, so the menu uses transactional remove + relative insert to reorder siblings only.
- Native HTML5 drag in BlockNote 0.53 cannot reliably commit a ProseMirror drop on Preshot's CSS `zoom` canvas. The production handle therefore uses Pointer Events with a 6px threshold and a separate fixed overlay to show before/after insertion lines or inside-container highlighting.
- Deleting a parent block deletes the full subtree by default and shows the child-block count in the menu.

## Control styling

### Left control strip

- Shown when the current block is hovered or focused; both buttons are 18×18 logical pixels.
- Total strip width is 36px, exactly matching the page's 36px left padding; the left edge must not cross the white canvas and the right edge must not enter the text area.
- The strip belongs to the canvas zoom tree, so button size scales proportionally with the page rather than using fixed screen-pixel compensation.
- `+`: directly inserts a paragraph below the current block; clicking the arrow opens the full insertion menu.
- Six-dot drag handle: drag the block; click to open the operation menu.
- The strip must not cover the body text and uses BlockNote `SideMenuController` positioning.

### Operation menu

- Width 248px, dark floating layer consistent with the image-group toolbar.
- The top shows block type, level, and child-block count.
- First row: four 36×32px shortcut buttons for move up, move down, outdent, and indent.
- Main menu: insert above, insert below, duplicate, convert to, delete.
- The delete entry sits in a separated bottom section, uses danger color, and offers an "Undo" toast after execution.
- Non-executable actions keep their position but are disabled, with tooltips explaining boundary or schema reasons.

### Nesting feedback

- Each indentation level is 28px.
- Hovering the current level shows a low-contrast vertical structure line.
- Dragging distinguishes three targets: above, below, and as child block.
- "As child block" uses cyan container highlighting; normal reordering uses a cyan 2px insertion line.

## Keyboard and accessibility

- `Alt+↑/↓`: move the current block.
- `Tab/Shift+Tab`: indent / outdent.
- `Ctrl+D`: duplicate the current block.
- `Delete` deletes only when the block control menu has focus, to avoid damaging text editing.
- `Escape` closes submenus and the operation menu, then returns focus to the drag handle.
- All icon buttons have Chinese `aria-label`s, visible focus rings, and disabled reasons.

## Validation scope

- Regular block insertion, duplication, conversion, and deletion.
- Moving a parent block together with its full subtree.
- Nest / unnest plus disabled first/last boundaries.
- Image groups cannot be nested normally, but can still move, duplicate, delete, and undo at the top level or inside columns.
- Menu keyboard navigation, Escape focus return, and shortcuts.
- After JSON persistence, child hierarchy, unique block IDs, and image-group references remain intact.

## Implemented files

- `src/features/plan/blocknote/blockOperations.ts`
- `src/features/plan/blocknote/BlockOperationsMenu.tsx`
- `src/features/plan/blocknote/PreshotBlockSideMenu.tsx`
- `src/features/plan/blocknote/BlockNoteDocumentEditor.tsx`
- `src/features/plan/blocknote/blockOperations.test.ts`
- `e2e/blocknote-v14.spec.ts`
