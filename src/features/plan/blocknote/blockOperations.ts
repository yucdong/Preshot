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
): PreshotEditorPartialBlock {
  const clone = structuredClone(block) as PreshotEditorBlock;
  const partial: Record<string, unknown> = {
    type: clone.type,
    props: clone.props,
    content: clone.content,
    children: clone.children.map(cloneForInsertion),
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
  return editor.insertBlocks(
    [cloneForInsertion(block)],
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
    block.type === "imageGroup" ||
    block.type === "shootingLocation" ||
    block.type === "modelCard" ||
    block.type === "clothing" ||
    block.type === "prop"
  ) return false;
  const context = blockContext(editor.document, block.id);
  if (!context || context.index === 0) return false;
  return context.siblings[context.index - 1].type !== "imageGroup";
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
  return block.type !== "imageGroup" &&
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
    if (!parent) return current;
    current = parent;
  }
}

export function moveBlockRelative(
  editor: PreshotBlockNoteEditor,
  source: PreshotEditorBlock,
  requestedTarget: PreshotEditorBlock,
  placement: BlockDropPlacement,
): boolean {
  let target = requestedTarget;
  if (
    source.type === "imageGroup" ||
    source.type === "shootingLocation" ||
    source.type === "modelCard" ||
    source.type === "clothing" ||
    source.type === "prop"
  ) {
    if (placement === "inside") return false;
    target = topLevelAncestor(editor, requestedTarget);
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
