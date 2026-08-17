# BlockNote inline multi-column layout research

Status: Implemented
Date: 2026-08-17

## Conclusion

Placing a "text block + image-group block" on the same row is supported.

BlockNote's official `@blocknote/xl-multi-column` extension provides:

```text
columnList
├─ column { width }
│  └─ regular or custom blocks
└─ column { width }
   └─ regular or custom blocks
```

Therefore the target structure can be represented as:

```json
{
  "type": "columnList",
  "children": [
    {
      "type": "column",
      "props": { "width": 0.75 },
      "children": [
        { "type": "paragraph", "content": "Shooting notes..." }
      ]
    },
    {
      "type": "column",
      "props": { "width": 1.25 },
      "children": [
        { "type": "imageGroup", "props": { "groupId": "group-1" } }
      ]
    }
  ]
}
```

Column width is a `flex-grow` weight and does not need to sum to 1; both columns default to 1.

## Official capability and version

- Official documentation:
  [Document Structure - Column Blocks](https://www.blocknotejs.org/docs/foundations/document-structure#column-blocks)
- Current organization npm mirror provides:
  `@blocknote/xl-multi-column@0.53.0`
- It matches the project's current `@blocknote/core/react@0.53.0` exactly.
- Main exports:
  - `withMultiColumn(schema)`
  - `ColumnBlock`
  - `ColumnListBlock`
  - `insertColumnList(editor, numColumns)`
  - `getMultiColumnSlashMenuItems(editor)`
  - `multiColumnDropCursor`
- Package license:
  `GPL-3.0 OR PROPRIETARY`. If Preshot is not distributed under GPL-3.0, BlockNote commercial licensing must be confirmed and obtained first.

## Why current Preshot could not use it directly yet

### 1. The schema did not include column blocks

`src/features/plan/blocknote/blockNoteSchema.tsx` only registered the currently restricted block types and `imageGroup`; it did not include `columnList` / `column`.

Recommendation:

```ts
const baseSchema = BlockNoteSchema.create({
  blockSpecs: {
    // current specs
  },
});

export const preshotBlockNoteSchema = withMultiColumn(baseSchema);
```

Merge `getMultiColumnSlashMenuItems(editor)` into the slash menu and provide "Two columns" and "Three columns".

### 2. The persistence contract rejected column structure

`PRESHOT_BLOCK_TYPES` did not contain `columnList` / `column`, and the validator lacked these rules:

- `columnList.content === undefined`
- `columnList.children` contains at least two items and only `column`
- `column.content === undefined`
- `column.props.width` is positive
- `column.children` contains at least one regular block
- `column` cannot nest another `columnList`

This is new persistence capability. To prevent old versions from silently dropping column structure on open, schema 14 should be introduced (or at least block document version 2) rather than silently extending v13.

### 3. Image groups were currently forced to be top-level

There were two existing restrictions:

- `blockDocument.ts`: any non-top-level `imageGroup` is rejected.
- `BlockNoteDocumentEditor.tsx`: nested image groups are auto-moved back to the top level when detected.

It needed to change to:

- image groups may exist at the document top level, or as direct regular-block children of a `column`;
- image groups still may not nest under paragraphs, lists, blockquotes, image groups, or other regular blocks;
- `imageGroup.children` must still remain empty.

The image-group view already constrains width using `.bn-block-content.clientWidth`, so when it enters a column it can naturally adapt to the column width without rewriting internal image layout.

### 4. Current Pointer drag needed to support left/right edges

The official extension creates columns from left/right-edge HTML5 drag drop, but Preshot already switched to Pointer Events because of CSS zoom and therefore could not rely directly on that drop handler.

`PreshotBlockSideMenu` needed to add:

- `left` / `right` drop placement;
- a vertical cyan preview in the left/right 20%-25% target zone of a block;
- for edge drop on a regular block: create a two-column `columnList` with `replaceBlocks`;
- for edge drop on a block already inside a column: create a new `column`;
- dropping back on above/below insertion lines removes it from the column;
- delete empty columns automatically; remove `columnList` automatically when only one column remains.

When an image group is dragged into a column, top-level enforcement must stop at the `column` container and must not remap it all the way back to the document top level.

### 5. PDF currently flattened children vertically

`blockDocumentToBlocks.ts` currently recursively `flatMap`s children. Even if the screen showed two columns, PDF would still output a vertical structure of "text first, image second".

A new PDF `columns` layout block was required:

- allocate available width by `column.props.width`;
- measure text and image groups independently per column;
- use the tallest column as the row height;
- paginate the whole column row as one keep-together unit by default;
- relayout image-group frame/crop within column width without changing persisted data.

### 6. Operation menus needed to understand column containers

- Add "Place beside left/right" to regular-block menus.
- Add "Remove from columns" for blocks inside columns.
- Provide "Add column / Delete column / Distribute evenly" for `columnList`.
- Limit the recommended column count to 2 first, then at most 3 later.
- Logical minimum column width should be about 280px; the current 1008px content area suits two columns, while three columns fit only short text or a single image.

## Recommended interaction

1. Insert an empty two-column layout with `/Two columns`.
2. Drag a block to the left/right edge of another block until a vertical cyan placement line appears.
3. Release to place both inside the same `columnList`.
4. Show an 8px draggable divider between columns and adjust flex weights live.
5. Recommended initial text + image-group ratio is 38:62.
6. Image groups inside narrow columns keep internal drag, resize, delete, and large-image viewing capability.
7. When deleting the last block in a column, keep an empty paragraph automatically; when explicitly removing from columns, if only one column remains, restore ordinary vertical blocks automatically.

## Not recommended

- **Table simulation**: BlockNote table cells store inline content rather than block children, so `imageGroup` cannot be placed inside them.
- **A single custom `textImageRow` block**: this would require reimplementing rich-text editing, block operations, drag-and-drop, and JSON conversion inside a custom block, losing native BlockNote capability.
- **Directly copying GPL extension source**: if Preshot is not a GPL project, that introduces licensing risk.

## Implementation result

- GPL-3.0 was chosen, and third-party notice plus full license text were added.
- Schema 14 / document version 2 was introduced, with automatic migration from v13.
- `withMultiColumn`, two-column / three-column slash menu items, and column resize were integrated.
- Image groups are now allowed as column children.
- Pointer left/right drop was extended to create same-row layout.
- JSON validation, duplication, deletion, undo, autosave, and reference integrity were updated.
- Column-aware PDF layout and whole-row keep-together pagination were implemented.
- Coverage now includes text+image same-row layout, column-width adjustment, save/reload, v13 migration, and PDF E2E.
