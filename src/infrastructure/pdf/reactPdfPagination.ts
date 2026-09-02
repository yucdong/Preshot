import type { PreshotPdfExportContext } from "../../domain/plan/blocknote/pdfExportPreflight";

function samePath(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

export function hasImmediateAuthoredPageBreak(
  context: Pick<PreshotPdfExportContext, "blocks" | "blocksById">,
  blockId: string,
): boolean {
  const block = context.blocksById[blockId];
  const siblingIndex = block?.path.at(-1);
  if (!block || siblingIndex === undefined || siblingIndex === 0) return false;

  const previousPath = [...block.path.slice(0, -1), siblingIndex - 1];
  return context.blocks.some(
    (candidate) =>
      candidate.parentBlockId === block.parentBlockId &&
      candidate.blockType === "pageBreak" &&
      samePath(candidate.path, previousPath),
  );
}

export function freshPagePresenceAhead(
  context: Pick<
    PreshotPdfExportContext,
    "blocks" | "blocksById" | "page"
  >,
  blockId: string,
): number | undefined {
  return hasImmediateAuthoredPageBreak(context, blockId)
    ? undefined
    : context.page.contentHeight;
}
