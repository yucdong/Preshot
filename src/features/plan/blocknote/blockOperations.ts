import { closeHistory } from "prosemirror-history";
import type {
  PreshotBlockNoteEditor,
  PreshotEditorBlock,
  PreshotEditorPartialBlock,
} from "./preshotBlockNoteSchema";

export type {
  PreshotBlockNoteEditor,
  PreshotEditorBlock,
} from "./preshotBlockNoteSchema";

export interface BlockTreeContext {
  block: PreshotEditorBlock;
  parent?: PreshotEditorBlock;
  siblings: readonly PreshotEditorBlock[];
  index: number;
  depth: number;
}

export interface BlockGroupCloner {
  cloneGroup(groupId: string): string | null;
  cloneArtifact?(artifactId: string): string | null;
}

export type ConvertibleBlockType =
  | "paragraph"
  | "heading"
  | "bulletListItem"
  | "numberedListItem"
  | "checkListItem"
  | "quote";
export type BlockDropPlacement =
  | "before"
  | "after"
  | "left"
  | "right"
  | "inside";

export function blockContext(
  blocks: readonly PreshotEditorBlock[],
  blockId: string,
  parent?: PreshotEditorBlock,
  depth = 0,
): BlockTreeContext | undefined {
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.id === blockId) {
      return { block, parent, siblings: blocks, index, depth };
    }
    const nested = blockContext(block.children, blockId, block, depth + 1);
    if (nested) return nested;
  }
  return undefined;
}

function cloneForInsertion(
  block: PreshotEditorBlock,
  cloner: BlockGroupCloner,
): PreshotEditorPartialBlock | null {
  const clone = structuredClone(block) as PreshotEditorBlock;
  if (clone.type === "imageGroup") {
    const groupId = cloner.cloneGroup(clone.props.groupId);
    if (!groupId) return null;
    (clone.props as { groupId: string }).groupId = groupId;
  } else if (["shootingLocation", "modelCard", "clothing", "prop"].includes(clone.type)) {
    const artifactId = cloner.cloneArtifact?.((clone.props as { artifactId: string }).artifactId);
    if (!artifactId) return null;
    (clone.props as { artifactId: string }).artifactId = artifactId;
  }
  const children = clone.children.map(child => cloneForInsertion(child, cloner));
  if (children.some(child => child === null)) return null;
  const partial: Record<string, unknown> = {
    type: clone.type,
    props: clone.props,
    content: clone.content,
    children,
  };
  if (clone.type === "table" && clone.content.type === "tableContent") {
    partial.content = {
      ...clone.content,
      columnWidths: clone.content.columnWidths.map((width) =>
        width === null ? undefined : width),
    };
  }
  return partial as PreshotEditorPartialBlock;
}

export function duplicateBlockTree(
  editor: PreshotBlockNoteEditor,
  block: PreshotEditorBlock,
  groupCloner: BlockGroupCloner,
): PreshotEditorBlock[] {
  if (block.type === "imageGroup") {
    const groupId = groupCloner.cloneGroup(block.props.groupId);
    if (!groupId) return [];
    return editor.insertBlocks(
      [{ type: "imageGroup", props: { groupId } }],
      block,
      "after",
    ) as PreshotEditorBlock[];
  }
  if (
    block.type === "shootingLocation" ||
    block.type === "modelCard" ||
    block.type === "clothing" ||
    block.type === "prop"
  ) {
    const artifactId = groupCloner.cloneArtifact?.(block.props.artifactId);
    if (!artifactId) return [];
    return editor.insertBlocks(
      [{
        type: block.type,
        props: { artifactId },
      } as PreshotEditorPartialBlock],
      block,
      "after",
    ) as PreshotEditorBlock[];
  }
  const copy = cloneForInsertion(block, groupCloner);
  if (!copy) return [];
  return editor.insertBlocks(
    [copy],
    block,
    "after",
  ) as PreshotEditorBlock[];
}

export function insertParagraphRelativeToBlock(
  editor: PreshotBlockNoteEditor,
  block: PreshotEditorBlock,
  placement: "before" | "after",
): PreshotEditorBlock[] {
  return editor.insertBlocks(
    [{ type: "paragraph", content: "" }],
    block,
    placement,
  ) as PreshotEditorBlock[];
}

export function canNestSpecificBlock(
  editor: PreshotBlockNoteEditor,
  block: PreshotEditorBlock,
): boolean {
  if (
    block.type === "columnList" || block.type === "column" ||
    block.type === "imageGroup" ||
    block.type === "shootingLocation" ||
    block.type === "modelCard" ||
    block.type === "clothing" ||
    block.type === "prop"
  ) return false;
  const context = blockContext(editor.document, block.id);
  if (!context || context.index === 0) return false;
  return !["imageGroup", "shootingLocation", "modelCard", "clothing", "prop", "column", "columnList"].includes(context.siblings[context.index - 1].type);
}

export function nestSpecificBlock(
  editor: PreshotBlockNoteEditor,
  block: PreshotEditorBlock,
): boolean {
  if (!canNestSpecificBlock(editor, block)) return false;
  editor.setTextCursorPosition(block, "start");
  if (!editor.canNestBlock()) return false;
  editor.nestBlock();
  return true;
}

export function canUnnestSpecificBlock(
  editor: PreshotBlockNoteEditor,
  block: PreshotEditorBlock,
): boolean {
  const parent = blockContext(editor.document, block.id)?.parent;
  return parent !== undefined && parent.type !== "column" && parent.type !== "columnList" &&
    block.type !== "column" && block.type !== "columnList" && block.type !== "imageGroup" &&
    block.type !== "shootingLocation" &&
    block.type !== "modelCard" &&
    block.type !== "clothing" &&
    block.type !== "prop" &&
    blockContext(editor.document, block.id)?.parent !== undefined;
}

export function unnestSpecificBlock(
  editor: PreshotBlockNoteEditor,
  block: PreshotEditorBlock,
): boolean {
  if (!canUnnestSpecificBlock(editor, block)) return false;
  editor.setTextCursorPosition(block, "start");
  if (!editor.canUnnestBlock()) return false;
  editor.unnestBlock();
  return true;
}

export function moveSpecificBlock(
  editor: PreshotBlockNoteEditor,
  block: PreshotEditorBlock,
  direction: "up" | "down",
): boolean {
  const context = blockContext(editor.document, block.id);
  if (!context) return false;
  const targetIndex = direction === "up"
    ? context.index - 1
    : context.index + 1;
  const target = context.siblings[targetIndex];
  if (!target) return false;
  editor.transact(() => {
    editor.removeBlocks([block]);
    editor.insertBlocks(
      [block],
      target,
      direction === "up" ? "before" : "after",
    );
  });
  return true;
}

function containsBlock(
  block: PreshotEditorBlock,
  blockId: string,
): boolean {
  return block.children.some((child) =>
    child.id === blockId || containsBlock(child, blockId));
}

function topLevelAncestor(
  editor: PreshotBlockNoteEditor,
  block: PreshotEditorBlock,
): PreshotEditorBlock {
  let current = block;
  for (;;) {
    const parent = editor.getParentBlock(current) as
      | PreshotEditorBlock
      | undefined;
    if (!parent || parent.type === "column") return current;
    current = parent;
  }
}

export function moveBlockRelative(
  editor: PreshotBlockNoteEditor,
  source: PreshotEditorBlock,
  requestedTarget: PreshotEditorBlock,
  placement: BlockDropPlacement,
): boolean {
  if (source.type === "column") return false;
  if (source.type === "columnList" &&
      (placement !== "before" && placement !== "after" || editor.getParentBlock(requestedTarget))) return false;
  if (requestedTarget.type === "columnList" && placement === "inside") return false;
  if (requestedTarget.type === "columnList" && (placement === "left" || placement === "right")) return false;
  let target = requestedTarget;
  if (
    source.type === "imageGroup" ||
    source.type === "shootingLocation" ||
    source.type === "modelCard" ||
    source.type === "clothing" ||
    source.type === "prop"
  ) {
    if (placement === "inside" && target.type !== "column") return false;
    if (requestedTarget.type !== "column") target = topLevelAncestor(editor, requestedTarget);
  }
  if (
    source.id === target.id ||
    containsBlock(source, target.id) ||
    (
      placement === "inside" &&
      (
        target.type === "imageGroup" ||
        target.type === "shootingLocation" ||
        target.type === "modelCard" ||
        target.type === "clothing" ||
        target.type === "prop" ||
        target.type === "divider"
      )
    )
  ) {
    return false;
  }
  const inColumn = (block: PreshotEditorBlock): boolean => {
    let parent = editor.getParentBlock(block);
    while (parent) { if (parent.type === "column") return true; parent = editor.getParentBlock(parent); }
    return block.type === "column";
  };
  if (placement === "left" || placement === "right" || inColumn(source) || inColumn(target)) {
    const blocks = structuredClone(editor.document);
    const remove = (siblings: PreshotEditorBlock[]): void => {
      const index = siblings.findIndex(block => block.id === source.id);
      if (index >= 0) siblings.splice(index, 1);
      else siblings.forEach(block => remove(block.children));
    };
    remove(blocks);
    let destination = blockContext(blocks, target.id);
    if (!destination) return false;
    if (placement === "left" || placement === "right") {
      while (destination.parent && destination.block.type !== "column") destination = blockContext(blocks, destination.parent.id)!;
      const column = (children: PreshotEditorBlock[]): PreshotEditorBlock => ({ id: crypto.randomUUID(), type: "column", props: { width: 1 }, content: undefined, children });
      const siblings = destination.siblings as PreshotEditorBlock[];
      if (destination.block.type === "column") siblings.splice(destination.index + (placement === "right" ? 1 : 0), 0, column([source]));
      else siblings.splice(destination.index, 1, {
        id: crypto.randomUUID(), type: "columnList", props: {}, content: undefined,
        children: placement === "left" ? [column([source]), column([destination.block])] : [column([destination.block]), column([source])],
      });
    } else if (target.type === "column") {
      destination.block.children.push(source);
    } else if (placement === "inside") {
      destination.block.children.push(source);
    } else {
      (destination.siblings as PreshotEditorBlock[]).splice(destination.index + (placement === "after" ? 1 : 0), 0, source);
    }
    // A completed move owns the vacated column. Remove it instead of leaving
    // a placeholder that would require a separate layout-management button.
    for (let index = blocks.length - 1; index >= 0; index--) {
      const row = blocks[index];
      if (row.type !== "columnList") continue;
      row.children = row.children.filter(column => column.children.length > 0);
      if (row.children.length === 1) blocks.splice(index, 1, ...row.children[0].children);
      else if (row.children.length === 0) blocks.splice(index, 1);
    }
    editor.prosemirrorView.dispatch(closeHistory(editor.prosemirrorView.state.tr));
    editor.transact(() => editor.replaceBlocks(editor.document, blocks));
    editor.prosemirrorView.dispatch(closeHistory(editor.prosemirrorView.state.tr));
    return true;
  }
  editor.transact(() => {
    editor.removeBlocks([source]);
    editor.insertBlocks(
      [source],
      target,
      placement === "before" ? "before" : "after",
    );
    if (placement === "inside") {
      const inserted = editor.getBlock(source.id);
      if (!inserted) return;
      editor.setTextCursorPosition(inserted, "start");
      if (editor.canNestBlock()) editor.nestBlock();
    }
  });
  return true;
}

export function convertBlock(
  editor: PreshotBlockNoteEditor,
  block: PreshotEditorBlock,
  type: ConvertibleBlockType,
): PreshotEditorBlock {
  if (block.type === "column" || block.type === "columnList") return block;
  const update: PreshotEditorPartialBlock = type === "heading"
    ? { type, props: { level: 2 } }
    : { type };
  return editor.updateBlock(block, update) as PreshotEditorBlock;
}

export function deleteBlockOrSelection(
  editor: PreshotBlockNoteEditor,
  block: PreshotEditorBlock,
): void {
  const selectedBlocks = editor.getSelection()?.blocks;
  const blocksToRemove =
    selectedBlocks?.some((selected) => selected.id === block.id)
      ? selectedBlocks
      : [block];
  editor.prosemirrorView.dispatch(
    closeHistory(editor.prosemirrorView.state.tr),
  );
  editor.removeBlocks(blocksToRemove);
}
