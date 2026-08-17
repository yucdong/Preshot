import { describe, expect, it, vi } from "vitest";
import type { Block } from "./htmlToBlocks";
import {
  layoutPdfRichText,
  paginatePdfTextLayout,
  PDF_BODY_SIZE,
  PDF_COLUMN_GAP,
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

  it("fits image blocks to the text width and keeps their aspect ratio", () => {
    const regular = metricFont();
    const bold = metricFont();
    const layout = layoutPdfRichText(
      [{ type: "image", src: "references/portrait.png", alt: "", width: 1200, height: 800 }],
      300,
      { regular, bold },
    );

    expect(layout.images).toEqual([
      {
        src: "references/portrait.png",
        x: 0,
        topFromTop: 0,
        width: 300,
        height: 200,
      },
    ]);
    expect(layout.height).toBe(200 + PDF_PARAGRAPH_GAP);
  });

  it("lays out weighted columns side-by-side", () => {
    const regular = metricFont();
    const bold = metricFont();
    const layout = layoutPdfRichText(
      [{
        type: "columns",
        columns: [
          {
            weight: 1,
            blocks: [{ type: "paragraph", runs: [{ text: "left" }] }],
          },
          {
            weight: 1,
            blocks: [{ type: "paragraph", runs: [{ text: "right" }] }],
          },
        ],
      }],
      300,
      { regular, bold },
    );

    const left = layout.commands.find((command) => command.text === "left");
    const right = layout.commands.find((command) => command.text === "right");
    expect(left?.x).toBe(0);
    expect(right?.x).toBe((300 - PDF_COLUMN_GAP) / 2 + PDF_COLUMN_GAP);
    expect(right?.baselineFromTop).toBe(left?.baselineFromTop);
  });

  it("moves a complete column row to the next page", () => {
    const regular = metricFont();
    const bold = metricFont();
    const rawLayout = layoutPdfRichText(
      [
        {
          type: "image",
          src: "references/spacer.png",
          alt: "",
          width: 50,
          height: 50,
        },
        {
          type: "columns",
          columns: [
            {
              weight: 1,
              blocks: [{ type: "paragraph", runs: [{ text: "left" }] }],
            },
            {
              weight: 1,
              blocks: [{ type: "paragraph", runs: [{ text: "right" }] }],
            },
          ],
        },
      ],
      300,
      { regular, bold },
    );
    const paginated = paginatePdfTextLayout(rawLayout, {
      textStartFromDocumentTop: 20,
      pageHeight: 100,
      pageMargin: 10,
    });
    const columnCommands = paginated.commands.filter((command) =>
      command.text === "left" || command.text === "right");

    expect(columnCommands).toHaveLength(2);
    expect(new Set(columnCommands.map((command) => command.pageIndex)))
      .toEqual(new Set([1]));
  });

  it("offsets image groups into their assigned column", () => {
    const regular = metricFont();
    const bold = metricFont();
    const groups = new Map([[
      "looks",
      {
        id: "looks",
        name: "Looks",
        type: "reference" as const,
        x: 0,
        width: 300,
        height: 160,
        description: "",
        images: [{
          id: "image",
          file: "references/look.png",
          aspectRatio: 1,
          frameWidth: 100,
          frameHeight: 100,
        }],
      },
    ]]);
    const layout = layoutPdfRichText(
      [{
        type: "columns",
        columns: [
          {
            weight: 1,
            blocks: [{ type: "paragraph", runs: [{ text: "copy" }] }],
          },
          {
            weight: 1,
            blocks: [{ type: "imageGroup", groupId: "looks" }],
          },
        ],
      }],
      300,
      { regular, bold },
      { imageGroups: groups },
    );

    expect(layout.images[0].x).toBeGreaterThan(150);
    expect(layout.images[0].keepTogetherGroup).toMatch(/^columns-/);
  });

  it("moves an image block to the next page when it does not fit", () => {
    const regular = metricFont();
    const bold = metricFont();
    const rawLayout = layoutPdfRichText(
      [
        { type: "paragraph", runs: [{ text: "line" }] },
        { type: "image", src: "references/portrait.png", alt: "", width: 60, height: 30 },
      ],
      100,
      { regular, bold },
    );
    const paginated = paginatePdfTextLayout(rawLayout, {
      textStartFromDocumentTop: 65,
      pageHeight: 100,
      pageMargin: 10,
    });

    expect(paginated.images[0]).toMatchObject({
      pageIndex: 1,
      topFromPageTop: 10,
      width: 60,
      height: 30,
    });
  });

  it("lays out image-group frames inside the persisted group rectangle", () => {
    const regular = metricFont();
    const bold = metricFont();
    const groups = new Map([[
      "looks",
      {
        id: "looks",
        name: "图片组1",
        type: "reference" as const,
        x: 40,
        width: 300,
        height: 200,
        description: "",
        images: [
          {
            id: "first",
            file: "references/first.png",
            aspectRatio: 2,
            frameWidth: 120,
            frameHeight: 60,
            crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
          },
          {
            id: "second",
            file: "references/second.png",
            aspectRatio: 1,
            frameWidth: 60,
            frameHeight: 60,
          },
        ],
      },
    ]]);

    const layout = layoutPdfRichText(
      [{ type: "imageGroup", groupId: "looks" }],
      300,
      { regular, bold },
      { imageGroups: groups },
    );

    const documentToPdf = 300 / (595.28 - 48);
    expect(layout.images[0]).toMatchObject({
      src: "references/first.png",
      crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
    });
    expect(layout.images[0].x).toBeCloseTo((40 + 9) * documentToPdf);
    expect(layout.images[0].topFromTop).toBeCloseTo(9 * documentToPdf);
    expect(layout.images[0].width).toBeCloseTo(120 * documentToPdf);
    expect(layout.images[0].height).toBeCloseTo(60 * documentToPdf);
    expect(layout.images[1]).toMatchObject({ src: "references/second.png" });
    expect(layout.images[1].x).toBeCloseTo((40 + 9 + 120 + 7) * documentToPdf);
    expect(layout.images[1].topFromTop).toBeCloseTo(9 * documentToPdf);
    expect(layout.images[1].width).toBeCloseTo(60 * documentToPdf);
    expect(layout.images[1].height).toBeCloseTo(60 * documentToPdf);
    expect(layout.height).toBeCloseTo(200 * documentToPdf + PDF_PARAGRAPH_GAP);
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
