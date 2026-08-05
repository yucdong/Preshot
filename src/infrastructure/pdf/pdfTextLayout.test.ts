import { describe, expect, it, vi } from "vitest";
import type { Block } from "./htmlToBlocks";
import {
  layoutPdfRichText,
  paginatePdfTextLayout,
  PDF_BODY_SIZE,
  PDF_LINE_HEIGHT,
  PDF_PARAGRAPH_GAP,
} from "./pdfTextLayout";

function metricFont(multiplier = 1) {
  return {
    widthOfTextAtSize: vi.fn(
      (text: string, size: number) => text.length * size * multiplier,
    ),
  };
}

describe("layoutPdfRichText", () => {
  it("uses the same wrapped commands to report rendered height", () => {
    const regular = metricFont();
    const bold = metricFont();
    const blocks: Block[] = [
      { type: "paragraph", runs: [{ text: "aa bb" }] },
    ];

    const layout = layoutPdfRichText(blocks, 25, { regular, bold });
    const textCommands = layout.commands.filter((command) => !command.isSpace);

    expect(textCommands.map((command) => command.text)).toEqual(["aa", "bb"]);
    expect(new Set(textCommands.map((command) => command.baselineFromTop)).size).toBe(2);
    expect(layout.height).toBeCloseTo(
      PDF_BODY_SIZE * PDF_LINE_HEIGHT * 2 + PDF_PARAGRAPH_GAP,
      5,
    );
  });

  it("uses bold metrics for marked runs during both wrapping and drawing commands", () => {
    const regular = metricFont();
    const bold = metricFont(2);
    const blocks: Block[] = [
      {
        type: "paragraph",
        runs: [{ text: "plain " }, { text: "bold", bold: true }],
      },
    ];

    const layout = layoutPdfRichText(blocks, 200, { regular, bold });
    const boldCommand = layout.commands.find((command) => command.text === "bold");

    expect(boldCommand?.font).toBe(bold);
    expect(bold.widthOfTextAtSize).toHaveBeenCalledWith("bold", PDF_BODY_SIZE);
  });

  it("adds page-margin spacers and assigns commands to their rendered pages", () => {
    const regular = metricFont();
    const bold = metricFont();
    const blocks: Block[] = Array.from({ length: 6 }, (_, index) => ({
      type: "paragraph" as const,
      runs: [{ text: `line${index + 1}` }],
    }));
    const rawLayout = layoutPdfRichText(blocks, 200, { regular, bold });

    const paginated = paginatePdfTextLayout(rawLayout, {
      textStartFromDocumentTop: 20,
      pageHeight: 100,
      pageMargin: 10,
    });

    expect(paginated.height).toBeGreaterThan(rawLayout.height);
    expect(new Set(paginated.commands.map((command) => command.pageIndex)).size).toBeGreaterThan(1);
    expect(
      paginated.commands.every(
        (command) =>
          command.baselineFromPageTop >= 10 &&
          command.baselineFromPageTop <= 90,
      ),
    ).toBe(true);
  });
});
