import type { PreshotBlock } from "./blockDocument";

export function findDocumentBlock<T extends { id: string; children: readonly T[] }>(blocks: readonly T[], id: string): T | undefined {
  for (const block of blocks) {
    if (block.id === id) return block;
    const child = findDocumentBlock(block.children, id);
    if (child) return child;
  }
}

/** An ordinary nested text cursor belongs to its row; a column owns its rows. */
interface InsertionNode { id: string; type: string; children: readonly InsertionNode[] }

export function documentInsertionAnchor(blocks: readonly InsertionNode[], id: string): string | null {
  for (const block of blocks) {
    if (block.id === id) return id;
    if (!findDocumentBlock(block.children, id)) continue;
    if (block.type === "columnList" || block.type === "column") return documentInsertionAnchor(block.children, id);
    return block.id;
  }
  return null;
}

export function insertDocumentBlocks(
  blocks: readonly PreshotBlock[], additions: readonly PreshotBlock[], anchor: string | null,
): PreshotBlock[] {
  if (anchor === null) return [...additions, ...blocks];
  const resolved = documentInsertionAnchor(blocks, anchor);
  if (!resolved) throw new Error("Document insertion anchor no longer exists");
  const insert = (siblings: readonly PreshotBlock[]): PreshotBlock[] => siblings.flatMap(block => {
    if (block.id === resolved) {
      if (block.type === "column") return [{ ...block, children: [...block.children, ...additions] }];
      return [block, ...additions];
    }
    return [{ ...block, children: insert(block.children) }];
  });
  return insert(blocks);
}
