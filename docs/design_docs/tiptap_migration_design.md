# TipTap editor migration design

## Status

- Status: Production migration completed and passed the full validation matrix
- Date: 2026-08-10
- POC: `docs/design_refs/preshot-tiptap-editor-demo.html`
- Split POC: `docs/design_refs/preshot-tiptap-split-editor-demo.html`
- Target version: TipTap `3.29.2`
- Upstream: `https://github.com/ueberdosis/tiptap`
- License: MIT; this plan does not depend on paid Pro Extensions

Production implementation: `src/features/plan/TiptapRichTextEditor.tsx`. BlockNote, Mantine editor styles, and `react-colorful` have been removed; the circular HSV color picker is now a Preshot-owned React component.

## Goal

Replace the BlockNote engine inside `RichTextEditor` with TipTap while preserving:

1. schema v10 and `PlanTextLeaf.html` unchanged;
2. each text leaf's persistent formatting toolbar looking basically the same;
3. paragraph, font-size, color, and link popups continuing to use a viewport-aware portal;
4. autosave, undo/redo, recursive splitting, natural height, and PDF output semantics unchanged;
5. existing project HTML opening without any data migration.

The split POC directly reuses schema-v10 recursive `leaf` / `split` semantics. Each leaf creates its own TipTap editor; `columns` and `rows` parent nodes only split geometry evenly and keep 10px gaps. Splitting preserves the first leaf's content and creates the second leaf; after deleting a leaf, sibling nodes fill the freed remaining area.

## Why TipTap was chosen

- TipTap and BlockNote are both built on ProseMirror, so selection, transaction, and document-tree models are similar.
- TipTap is headless, so the existing Preshot toolbar does not need Mantine adaptation or BlockNote UI overrides.
- Official `TextStyle`, `Color`, and `FontSize` directly output inline HTML already supported by the PDF parser:
  - `<span style="color: #0891B2">`
  - `<span style="font-size: 14px">`
- Official Link, TextAlign, Table, and TaskList extensions can be enabled capability by capability.
- The React API provides `useEditor`, `EditorContent`, and `useEditorState`; the toolbar can subscribe only to active state and avoid rerendering the full editor repeatedly.

## Stable boundaries

The public interface of `RichTextEditor` remains unchanged:

```ts
interface RichTextEditorProps {
  html: string;
  onChange(html: string): void;
  ariaLabel: string;
  placeholder?: string;
  compact?: boolean;
  rootRef?: React.Ref<HTMLDivElement>;
  onBlockHtmlChange?(sourceHtml: string, blocks: string[]): void;
}
```

Domain and infrastructure stay independent from TipTap:

```text
PlanTextLeaf.html
  -> RichTextEditor adapter
  -> TipTap/ProseMirror
  -> getHTML()
  -> existing autosave / PDF parser
```

## Dependency strategy

Production migration uses unified version `3.29.2`:

```powershell
pnpm add @tiptap/core@3.29.2 @tiptap/pm@3.29.2 `
  @tiptap/react@3.29.2 @tiptap/starter-kit@3.29.2 `
  @tiptap/extension-placeholder@3.29.2 `
  @tiptap/extension-text-style@3.29.2 `
  @tiptap/extension-text-align@3.29.2 `
  @tiptap/extension-table@3.29.2 `
  @tiptap/extension-task-list@3.29.2 `
  @tiptap/extension-task-item@3.29.2
```

`StarterKit` v3 already contains Link and Underline, so separate extensions are not re-registered. Link is configured via `StarterKit.configure({ link: ... })`.

After migration completes and passes the full matrix, remove:

```powershell
pnpm remove @blocknote/core @blocknote/mantine @blocknote/react
```

## Extension configuration

```ts
const extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3, 4, 5, 6] },
    link: {
      openOnClick: false,
      defaultProtocol: "https",
    },
  }),
  TextStyle,
  Color,
  FontSize,
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  Placeholder.configure({ placeholder }),
  TableKit.configure({ table: { resizable: false } }),
  TaskList,
  TaskItem.configure({ nested: true }),
];
```

Enable only nodes that PDF and the current UI can reliably handle. Images remain managed by Preshot reference components and do not enter the rich-text editor.

## HTML compatibility strategy

### Direct compatibility

The following existing HTML can be parsed and re-emitted directly by TipTap:

- `p`, `h1`–`h6`;
- `strong`, `em`, `u`, `s`;
- `ul`, `ol`, `li`;
- `blockquote`, `pre`, `code`;
- `a[href]`;
- `span style="font-size/color"`;
- `table`, `thead`, `tbody`, `tr`, `th`, `td` (after enabling TableKit).

### Compatibility fixtures required

BlockNote may emit extra `data-*`, classes, or details/checklist wrappers. Before migration, build a real fixture corpus:

1. Collect all current HTML from tests and browser seeds.
2. Run TipTap `setContent(html)` and then read `getHTML()`.
3. Compare semantics rather than raw strings: text, block order, marks, links, tables, and lists.
4. For wrappers TipTap does not recognize, normalize with DOMParser at the adapter entry.
5. Do not change schema or bulk rewrite project files; save TipTap-normalized HTML only after the user actually edits.

## Top-level block serialization contract

Current `onBlockHtmlChange` depends on BlockNote `blocksToHTMLLossy()`. The TipTap replacement serializes top-level ProseMirror nodes directly:

```ts
import { DOMSerializer } from "@tiptap/pm/model";

function serializeTopLevelBlocks(editor: Editor): string[] {
  const serializer = DOMSerializer.fromSchema(editor.schema);
  const document = editor.view.dom.ownerDocument;

  return editor.state.doc.content.content.map((node) => {
    const wrapper = document.createElement("div");
    wrapper.append(serializer.serializeNode(node));
    return wrapper.innerHTML;
  });
}
```

Each top-level ProseMirror node corresponds to one pagination block. The generation number continues to use the current generation ref so stale async results cannot overwrite new content.

## DOM measurement migration

Remove dependence on these BlockNote structures:

- `.bn-editor`;
- `.bn-block-group`;
- `[data-node-type="blockOuter"]`;
- `.bn-toolbar`.

When TipTap renders, add stable measurement attributes to top-level nodes:

```ts
const MeasuredParagraph = Paragraph.extend({
  renderHTML({ HTMLAttributes }) {
    return ["p", { ...HTMLAttributes, "data-editor-block": "true" }, 0];
  },
});
```

Heading, list, blockquote, code block, and table should also output `data-editor-block="true"`. The measurement hook then reads only:

```css
.tiptap-editor > [data-editor-block="true"]
```

The persistent toolbar still affects runtime frame only through `screenHeightPoints`; `heightPoints` and block heights continue to measure body content only and therefore keep driving persistence and PDF.

## UI command mapping

| Current capability | TipTap command |
| --- | --- |
| Paragraph | `setParagraph()` |
| H1–H6 | `setHeading({ level })` |
| Bold | `toggleBold()` |
| Italic | `toggleItalic()` |
| Underline | `toggleUnderline()` |
| Strikethrough | `toggleStrike()` |
| Font size | `setFontSize("14px")` |
| Text color | `setColor("#0891B2")` |
| Left/center/right align | `setTextAlign(...)` |
| Unordered / ordered list | `toggleBulletList()` / `toggleOrderedList()` |
| Blockquote | `toggleBlockquote()` |
| Link | `extendMarkRange("link").setLink({ href })` |
| Clear link | `unsetLink()` |

All toolbar `pointerdown` handlers continue to call `preventDefault()` and then execute `editor.chain().focus()...run()`; TipTap restores the ProseMirror selection automatically, so the project no longer needs to save its own Selection object.

## UI preserved vs changed

### Preserved

- A 36px persistent toolbar at the top of every text box;
- graphite / paper / cyan / berry visual tokens;
- 220px paragraph menu with single-line 36px items;
- font-size composite button;
- A underline, theme colors, and custom colors; the custom panel includes a circular HSV color field, brightness slider, and strict 0–255 integer RGB input;
- responsive More portal;
- fixed 18px component close button inside the component's upper-right internal slot;
- viewport safe distance, flipping, and portal elevation.

### Component upper-right close slot

- The close button sits inside the component border and no longer hangs outside it with negative `top/right` offsets.
- The persistent toolbar reserves a 34px screen-space slot on the right, with the 18px close button centered within that slot.
- The reserved space occupies only the right end of the toolbar and does not create a full new header; the body editing area still uses full component width.
- The close button uses graphite background and switches to danger on hover/focus while keeping a visible 2px focus ring.
- Container-query logic that decides visible formatting commands must subtract this slot; low-frequency overflow actions go into "More formatting".

### Explicit changes

- Remove BlockNote/Mantine DOM and style classes;
- BlockNote slash menu, block side menu, and block drag are not preserved automatically;
- "Collapsible headings" require a custom `details/summary` node, so phase 1 should disable or remove that menu item;
- TipTap itself has no built-in UI, so all these behaviors are owned by Preshot components.

## Phased implementation

### Phase 1: compatibility adapter and pure functions

- Install TipTap dependencies without switching UI;
- Build the extension set;
- Add old-HTML round-trip fixtures;
- Implement top-level block serialization;
- Change the measurement hook to editor-neutral `[data-editor-block]`;
- Keep BlockNote editor running, with TipTap parsing fixtures only in tests.

Acceptance: all fixture semantics round-trip, and the PDF parser is unchanged.

### Phase 2: replace RichTextEditor core

- `useCreateBlockNote` -> `useEditor`;
- `BlockNoteView` -> `EditorContent`;
- hydration uses `setContent(html, { emitUpdate: false })`;
- `onUpdate` uses `getHTML()`;
- toolbar active state uses `useEditorState`;
- keep the existing portals and color components.

Acceptance: component tests, formatting Playwright, and autosave complete without hydration echo.

### Phase 3: block capability and measurement

- Enable TableKit, TaskList, and TaskItem;
- Add `data-editor-block` to all top-level nodes;
- switch `onBlockHtmlChange` to DOMSerializer;
- validate long-text splitting, recursive leaf natural height, and PDF.

Acceptance: pagination, narrow leaves, and PDF parity all pass.

### Phase 4: clean up BlockNote

- Remove BlockNote imports, styles, and jsdom shims;
- remove `.bn-*` CSS;
- remove the three BlockNote packages;
- update architecture, test docs, and featurelist.

## Test matrix

### Component

- Empty / non-empty HTML hydration does not trigger `onChange`;
- external HTML updates use `emitUpdate: false`;
- persistent toolbar always stays visible;
- active/mixed formatting state is correct;
- Escape and keyboard menus are complete;
- compact reference editor remains accessible.

### HTML compatibility

- H1–H6, lists, blockquotes, code, task lists, tables;
- nested bold/italic/underline/strike;
- font size + color on the same span;
- links plus ordinary color;
- BlockNote fixture -> TipTap -> PDF parser keeps identical semantics.

### Playwright

- One persistent toolbar per leaf;
- paragraph, font-size, color, and link popups;
- theme colors and custom RGB truly write and persist after reload;
- alignment/nesting in responsive More;
- recursive splitting, narrow leaves, natural height;
- autosave, undo/redo, and PDF export.

## Rollback strategy

During Phases 1–3, keep the same `RichTextEditorProps` and choose the adapter behind an internal feature flag:

```ts
const EditorImplementation = tiptapEnabled
  ? TiptapRichTextEditor
  : BlockNoteRichTextEditor;
```

Because schema is unchanged and files are not migrated, rollback is just turning the flag off. Only after the full Phase 4 matrix passes should BlockNote be removed.

## POC scope

The interaction demo uses the real TipTap `3.29.2` ESM package to validate:

- H1–H6, paragraph, lists, blockquote;
- bold/italic/underline/strike;
- FontSize, Color, TextAlign, Link;
- the current Preshot persistent-toolbar visual style;
- live HTML output;
- dual proof that color is written into HTML and computed correctly by the browser.

The POC clearly marks "collapsible heading" as a custom node rather than pretending it is already supported.
