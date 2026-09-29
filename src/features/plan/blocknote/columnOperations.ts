import { closeHistory } from "prosemirror-history";
import { blockContext } from "./blockOperations";
import type { PreshotBlockNoteEditor, PreshotEditorBlock, PreshotEditorPartialBlock } from "./preshotBlockNoteSchema";

/** Reject nesting introduced by native keyboard, paste or upstream drop commands. */
export function attachColumnStructureGuard(editor: PreshotBlockNoteEditor) {
  return editor.onBeforeChange(({ tr }) => {
    if (!tr.docChanged) return true;
    let valid = true;
    tr.doc.descendants((node, position) => {
      if (node.type.name === "columnList" && tr.doc.resolve(position).depth !== 1) valid = false;
      if (node.type.name === "column" && (!Number.isFinite(node.attrs.width) || node.attrs.width <= 0)) valid = false;
      return valid;
    });
    return valid;
  });
}

export function activeColumn(editor: PreshotBlockNoteEditor, id: string | null) {
  let context = id ? blockContext(editor.document, id) : undefined;
  let leaf = context?.block;
  while (context) {
    if (context.block.type === "columnList") {
      const column = context.block.children[0];
      return column?.type === "column" ? { row: context.block, column, block: undefined } : null;
    }
    if (context.block.type === "column" && context.parent?.type === "columnList") {
      return { row: context.parent, column: context.block, block: leaf?.type === "column" ? undefined : leaf };
    }
    leaf = context.block;
    context = context.parent ? blockContext(editor.document, context.parent.id) : undefined;
  }
  return null;
}

export function columnTransaction(editor: PreshotBlockNoteEditor, action: () => void) {
  editor.prosemirrorView.dispatch(closeHistory(editor.prosemirrorView.state.tr));
  editor.transact(action);
  editor.prosemirrorView.dispatch(closeHistory(editor.prosemirrorView.state.tr));
}

const emptyColumn = (): PreshotEditorPartialBlock => ({ type: "column", props: { width: 1 }, children: [{ type: "paragraph", content: "" }] });

export const columnWeight = (block: PreshotEditorBlock) => block.type === "column" ? block.props.width : 1;

export function createColumns(editor: PreshotBlockNoteEditor, count: number, anchor: string | null) {
  if (!Number.isSafeInteger(count) || count < 2) throw new Error("A column row requires at least two columns");
  const selected = anchor ? editor.getBlock(anchor) : undefined;
  let root = selected;
  while (root && editor.getParentBlock(root)) root = editor.getParentBlock(root);
  const canWrap = root && root.type !== "columnList";
  const row: PreshotEditorPartialBlock = { type: "columnList", children: Array.from({ length: count }, (_, i) => i === 0 && canWrap && root
    ? { type: "column", props: { width: 1 }, children: [root] } : emptyColumn()) };
  let inserted: PreshotEditorBlock[] = [];
  columnTransaction(editor, () => {
    if (root && canWrap) inserted = editor.replaceBlocks([root], [row]).insertedBlocks;
    else inserted = editor.insertBlocks([row], root ?? editor.document[0], root ? "after" : "before");
  });
  const first = inserted[0]?.children[0]?.children[0];
  if (first) editor.setTextCursorPosition(first, "start");
  return inserted[0];
}

export function addColumn(editor: PreshotBlockNoteEditor, anchor: string) {
  const context = activeColumn(editor, anchor);
  if (!context) return;
  const index = context.row.children.findIndex(c => c.id === context.column.id);
  const children: PreshotEditorPartialBlock[] = [...context.row.children];
  children.splice(index + 1, 0, emptyColumn());
  columnTransaction(editor, () => editor.updateBlock(context.row, { children }));
  const next = editor.getBlock(context.row.id)?.children[index + 1]?.children[0];
  if (next) editor.setTextCursorPosition(next, "start");
}

export function mergeColumn(editor: PreshotBlockNoteEditor, anchor: string) {
  const context = activeColumn(editor, anchor); if (!context) return;
  const children = structuredClone(context.row.children);
  const index = children.findIndex(c => c.id === context.column.id);
  const destination = index > 0 ? index - 1 : 1;
  children[destination].children = index > 0 ? [...children[destination].children, ...children[index].children] : [...children[index].children, ...children[destination].children];
  children.splice(index, 1);
  columnTransaction(editor, () => {
    if (children.length === 1) editor.replaceBlocks([context.row], children[0].children);
    else editor.updateBlock(context.row, { children });
  });
  const focus = children[Math.max(0, index - 1)]?.children[0];
  if (focus) editor.setTextCursorPosition(focus, "start");
}

export function moveToAdjacentColumn(editor: PreshotBlockNoteEditor, anchor: string, direction: -1 | 1) {
  const context = activeColumn(editor, anchor); if (!context?.block) return false;
  const children = structuredClone(context.row.children);
  const source = children.findIndex(c => c.id === context.column.id);
  const target = children[source + direction]; if (!target) return false;
  children[source].children = children[source].children.filter(b => b.id !== context.block!.id);
  if (!children[source].children.length) children[source].children = [{ id: crypto.randomUUID(), type: "paragraph", props: { backgroundColor: "default", textColor: "default", textAlignment: "left" }, content: [], children: [] }];
  target.children.push(context.block);
  columnTransaction(editor, () => editor.updateBlock(context.row, { children }));
  return true;
}

export function setColumnWeights(editor: PreshotBlockNoteEditor, rowId: string, weights: readonly number[]) {
  const row = editor.getBlock(rowId);
  if (row?.type !== "columnList" || row.children.length !== weights.length || weights.some(w => !Number.isFinite(w) || w <= 0)) return;
  if (weights.every((weight, i) => weight === columnWeight(row.children[i]))) return;
  columnTransaction(editor, () => row.children.forEach((column, i) => editor.updateBlock(column, { props: { width: weights[i] } })));
}
