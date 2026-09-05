import { describe, expect, it } from "vitest";
import type {
  PreshotPdfBlockContext,
  PreshotPdfExportContext,
} from "../../domain/plan/blocknote/pdfExportPreflight";
import {
  PDF_VISUAL_CONTRACT,
  editorLogicalUnits,
} from "../../domain/plan/blocknote/pdfVisualContract";
import {
  freshPagePresenceAhead,
  hasImmediateAuthoredPageBreak,
} from "./reactPdfPagination";

function block(
  blockId: string,
  blockType: PreshotPdfBlockContext["blockType"],
  path: readonly number[],
): PreshotPdfBlockContext {
  return {
    order: path.at(-1) ?? 0,
    blockId,
    blockType,
    path,
    parentBlockId: null,
    logicalParentWidth: editorLogicalUnits(1_008),
    pdfParentWidth: PDF_VISUAL_CONTRACT.page.contentWidth,
    logicalToPdfScale:
      PDF_VISUAL_CONTRACT.editor.rootLogicalToPdfScale,
  };
}

function context(
  blocks: readonly PreshotPdfBlockContext[],
): Pick<PreshotPdfExportContext, "blocks" | "blocksById" | "page"> {
  return {
    blocks,
    blocksById: Object.fromEntries(
      blocks.map((entry) => [entry.blockId, entry]),
    ),
    page: PDF_VISUAL_CONTRACT.page,
  };
}

describe("React-PDF fresh-page presence", () => {
  it("requests full-page presence for first and naturally flowed blocks", () => {
    const first = block("first", "imageGroup", [0]);
    const second = block("second", "imageGroup", [1]);
    const current = context([first, second]);

    expect(freshPagePresenceAhead(current, first.blockId)).toBe(
      PDF_VISUAL_CONTRACT.page.contentHeight,
    );
    expect(freshPagePresenceAhead(current, second.blockId)).toBe(
      PDF_VISUAL_CONTRACT.page.contentHeight,
    );
  });

  it("suppresses the sentinel only for an immediate authored page break", () => {
    const lead = block("lead", "paragraph", [0]);
    const pageBreak = block("page-break", "pageBreak", [1]);
    const group = block("group", "imageGroup", [2]);
    const current = context([lead, pageBreak, group]);

    expect(hasImmediateAuthoredPageBreak(current, group.blockId)).toBe(true);
    expect(freshPagePresenceAhead(current, group.blockId)).toBeUndefined();
  });
});
