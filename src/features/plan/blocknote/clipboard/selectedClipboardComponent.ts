import type { PreshotBlockNoteEditor } from "../preshotBlockNoteSchema";

export function selectedClipboardComponent(editor: PreshotBlockNoteEditor, root: HTMLElement): HTMLElement | null {
  const view = editor.prosemirrorView;
  if (!view.hasFocus()) return null;
  const selection = view.state.selection;
  if (selection.toJSON().type !== "node") return null;
  const node = view.state.doc.nodeAt(selection.from);
  let blockId: unknown;
  if (node?.type.name === "blockContainer") {
    if (node.childCount !== 1) return null;
    blockId = node.attrs.id;
  } else {
    for (let depth = selection.$from.depth; depth > 0; depth--) {
      const ancestor = selection.$from.node(depth);
      if (ancestor.type.name === "blockContainer") {
        blockId = ancestor.attrs.id;
        break;
      }
    }
  }
  if (typeof blockId !== "string") return null;
  return Array.from(root.querySelectorAll<HTMLElement>("[data-clipboard-component]"))
    .find((component) => component.closest<HTMLElement>("[data-id]")?.dataset.id === blockId) ?? null;
}
