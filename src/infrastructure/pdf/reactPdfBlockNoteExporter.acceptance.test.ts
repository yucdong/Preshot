import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { Font } from "@react-pdf/renderer";
import {
  decodePDFRawStream,
  PDFArray,
  PDFDocument,
  PDFRawStream,
} from "pdf-lib";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectPlanV14 } from "../../domain/plan/canvas/blockDocument";
import { PreshotPdfPreflightError } from "../../domain/plan/blocknote/pdfExportPreflight";
import { PDF_VISUAL_CONTRACT } from "../../domain/plan/blocknote/pdfVisualContract";
import { createReactPdfBlockNoteExporter } from "./reactPdfBlockNoteExporter";
import { imageDataFromDataUrl } from "./pdfImageOptimizer";

const TEST_PNG = `data:image/png;base64,${
  readFileSync("src-tauri/icons/32x32.png").toString("base64")
}`;
const FONT_SOURCES = {
  regular: resolve("src/infrastructure/pdf/fonts/NotoSansSC-Regular.ttf"),
  bold: resolve("src/infrastructure/pdf/fonts/NotoSansSC-Bold.ttf"),
};

type DocumentBlock = ProjectPlanV14["document"]["blocks"][number];

function text(value: string, styles: Record<string, unknown> = {}) {
  return { type: "text", text: value, styles };
}

function block(
  id: string,
  type: string,
  props: Record<string, unknown>,
  content: unknown,
  children: DocumentBlock[] = [],
): DocumentBlock {
  return { id, type, props, content, children } as unknown as DocumentBlock;
}

function paragraph(id: string, value: string): DocumentBlock {
  return block(id, "paragraph", {
    textAlignment: "left",
    textColor: "default",
    backgroundColor: "default",
  }, [text(value)]);
}

function image(
  id: string,
  file: string,
  frameWidth: number,
  frameHeight: number,
  crop?: { x: number; y: number; width: number; height: number },
) {
  return {
    id,
    file,
    aspectRatio: frameWidth / frameHeight,
    sourceWidth: 1200,
    sourceHeight: 800,
    frameWidth,
    frameHeight,
    crop: crop ?? { x: 0, y: 0, width: 1, height: 1 },
  };
}

function imageGroup(
  id: string,
  options: {
    width: number;
    height: number;
    images: ReturnType<typeof image>[];
    x?: number;
    frameOffsetY?: number;
  },
): ProjectPlanV14["imageGroups"][number] {
  return {
    id,
    name: id,
    type: "reference",
    x: options.x ?? 0,
    width: options.width,
    height: options.height,
    frameOffsetY: options.frameOffsetY,
    description: "",
    images: options.images,
  };
}

function plan(
  blocks: DocumentBlock[],
  imageGroups: ProjectPlanV14["imageGroups"] = [],
): ProjectPlanV14 {
  return {
    schemaVersion: 15,
    artifacts: [],
    title: "React-PDF acceptance",
    document: { format: "preshot-blocks", version: 3, blocks },
    imageGroups,
  };
}

function assetsFor(value: ProjectPlanV14): Record<string, string> {
  const sources = new Set<string>();
  const visit = (blocks: readonly DocumentBlock[]) => {
    for (const current of blocks) {
      if (current.type === "image") {
        const source = String(current.props.url ?? "");
        if (source.startsWith("media/")) sources.add(source);
      }
      visit(current.children);
    }
  };
  visit(value.document.blocks);
  for (const group of value.imageGroups) {
    for (const entry of group.images) sources.add(entry.file);
  }
  return Object.fromEntries([...sources].map((source) => [source, TEST_PNG]));
}

function exporter(
  dimensions: { width: number; height: number } = {
    width: 1200,
    height: 800,
  },
) {
  return createReactPdfBlockNoteExporter({
    fontSources: FONT_SOURCES,
    optimizeImage: async (dataUrl) => imageDataFromDataUrl(dataUrl),
    measureImage: async () => dimensions,
  });
}

function emergencyRowGroup(id: string, requiredScale: number) {
  const pdfScale = PDF_VISUAL_CONTRACT.editor.rootLogicalToPdfScale;
  const availableRowHeight =
    PDF_VISUAL_CONTRACT.page.contentHeight -
    PDF_VISUAL_CONTRACT.imageGroup.inset * 2 -
    0.1;
  const frameHeight = Number(
    (availableRowHeight / requiredScale).toFixed(4),
  ) / pdfScale;
  return imageGroup(id, {
    width: 1_008,
    height: frameHeight + 18,
    images: [
      image(`${id}-row`, `references/${id}.png`, 900, frameHeight),
    ],
  });
}

function pageContent(pdf: PDFDocument, pageIndex: number): string {
  const contents = pdf.getPages()[pageIndex].node.normalizedEntries().Contents;
  if (!(contents instanceof PDFArray)) return "";
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  for (let index = 0; index < contents.size(); index += 1) {
    const stream = pdf.context.lookup(contents.get(index));
    if (stream instanceof PDFRawStream) {
      chunks.push(decoder.decode(decodePDFRawStream(stream).decode()));
    }
  }
  return chunks.join("\n");
}

function imageDrawCount(pdf: PDFDocument, pageIndex: number): number {
  return pageContent(pdf, pageIndex).match(/\/I\d+\s+Do/g)?.length ?? 0;
}

interface PdfImageDraw {
  readonly resource: string;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

type Matrix = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
];

function multiply(first: Matrix, second: Matrix): Matrix {
  const [a, b, c, d, e, f] = first;
  const [g, h, i, j, k, l] = second;
  return [
    a * g + c * h,
    b * g + d * h,
    a * i + c * j,
    b * i + d * j,
    a * k + c * l + e,
    b * k + d * l + f,
  ];
}

function imageDraws(pdf: PDFDocument, pageIndex: number): PdfImageDraw[] {
  const identity: Matrix = [1, 0, 0, 1, 0, 0];
  let matrix = identity;
  const stack: Matrix[] = [];
  const draws: PdfImageDraw[] = [];
  for (const rawLine of pageContent(pdf, pageIndex).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "q") {
      stack.push(matrix);
      continue;
    }
    if (line === "Q") {
      matrix = stack.pop() ?? identity;
      continue;
    }
    const concat = /^(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+cm$/.exec(
      line,
    );
    if (concat) {
      matrix = multiply(
        matrix,
        concat.slice(1).map(Number) as unknown as Matrix,
      );
      continue;
    }
    const draw = /^\/(I\d+)\s+Do$/.exec(line);
    if (!draw) continue;
    const [a, b, c, d, e, f] = matrix;
    const corners = [
      [e, f],
      [a + e, b + f],
      [c + e, d + f],
      [a + c + e, b + d + f],
    ];
    draws.push({
      resource: draw[1],
      minX: Math.min(...corners.map(([x]) => x)),
      minY: Math.min(...corners.map(([, y]) => y)),
      maxX: Math.max(...corners.map(([x]) => x)),
      maxY: Math.max(...corners.map(([, y]) => y)),
    });
  }
  return draws;
}

function renderedImageCount(pdf: PDFDocument): number {
  return pdf.getPages().reduce(
    (total, _page, index) => total + imageDrawCount(pdf, index),
    0,
  );
}

function expectNoBlankPages(pdf: PDFDocument): void {
  for (let pageIndex = 0; pageIndex < pdf.getPageCount(); pageIndex += 1) {
    const content = pageContent(pdf, pageIndex);
    expect(
      imageDrawCount(pdf, pageIndex) > 0 || /\bT[Jj]\b/.test(content),
      `page ${pageIndex + 1} should contain text or an image`,
    ).toBe(true);
  }
}

function annotationCount(pdf: PDFDocument): number {
  return pdf.getPages().reduce(
    (total, page) => total + (page.node.Annots()?.size() ?? 0),
    0,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  Font.reset();
});

describe("production React-PDF acceptance", () => {
  it("renders the full ordinary BlockNote contract with CJK, links, media, and A4 structure", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const value = plan([
      ...([1, 2, 3, 4, 5, 6] as const).map((level) =>
        block(`h${level}`, "heading", {
          level,
          textAlignment: "left",
          textColor: "default",
          backgroundColor: "default",
        }, [text(`中文标题 H${level}`)])
      ),
      block("styled", "paragraph", {
        textAlignment: "center",
        textColor: "default",
        backgroundColor: "default",
      }, [
        text("粗体", { bold: true }),
        text("斜体", { italic: true }),
        text("下划线", { underline: true }),
        text("删除线", { strike: true }),
        text("彩色代码", {
          code: true,
          textColor: "#123456",
          backgroundColor: "yellow",
        }),
        {
          type: "link",
          href: "https://example.com/reference",
          content: [text("链接")],
        },
      ]),
      block("bullet", "bulletListItem", {}, [text("项目符号")]),
      block("number", "numberedListItem", {}, [text("编号项目")]),
      block("check", "checkListItem", { checked: true }, [text("检查项目")]),
      block("toggle", "toggleListItem", {}, [text("折叠项目")]),
      block("quote", "quote", {}, [text("引用文本")]),
      block("code", "codeBlock", { language: "text" }, [
        text("const 机位 = 1;\n机位 += 1;"),
      ]),
      block("divider", "divider", {}, undefined),
      block("table", "table", {}, {
        type: "tableContent",
        columnWidths: [2, 1],
        headerRows: 1,
        headerCols: 0,
        rows: [{
          cells: [
            [text("镜头", { bold: true })],
            [text("说明")],
          ],
        }, {
          cells: [
            [text("主视觉")],
            [text("低机位")],
          ],
        }],
      }),
      block("native-image", "image", {
        url: "media/native.png",
        name: "原生图片",
        caption: "图片说明",
        showPreview: true,
        previewWidth: 180,
      }, undefined),
      block("video", "video", {
        url: "https://example.com/video",
        name: "访谈视频",
        caption: "",
        showPreview: true,
      }, undefined),
      block("audio", "audio", {
        url: "media/audio.wav",
        name: "现场声",
        caption: "",
        showPreview: false,
      }, undefined),
      block("file", "file", {
        url: "",
        name: "",
        caption: "",
        showPreview: false,
      }, undefined),
    ]);

    const bytes = await exporter().export(value, assetsFor(value));
    const pdf = await PDFDocument.load(bytes);

    expect(new TextDecoder().decode(bytes.slice(0, 8))).toMatch(/^%PDF-/);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
    for (const page of pdf.getPages()) {
      expect(page.getWidth()).toBeCloseTo(PDF_VISUAL_CONTRACT.page.width, 1);
      expect(page.getHeight()).toBeCloseTo(PDF_VISUAL_CONTRACT.page.height, 1);
    }
    expect(renderedImageCount(pdf)).toBe(1);
    expect(annotationCount(pdf)).toBe(2);
    expect(fetchSpy.mock.calls.map(([input]) => String(input))).not
      .toContainEqual(expect.stringMatching(/^https?:\/\//i));
    expect(bytes.length).toBeGreaterThan(10_000);
    expect(new TextDecoder().decode(bytes)).not.toMatch(
      /添加图片|删除图片组|打开菜单|data-image-resize-edge/i,
    );
  }, 30_000);

  it("moves an image-heavy wrapped group wholly to the next page", async () => {
    const images = Array.from({ length: 8 }, (_, index) =>
      image(
        `image-${index + 1}`,
        `references/image-${index + 1}.png`,
        120,
        80,
        index === 0
          ? { x: 0.2, y: 0.1, width: 0.6, height: 0.8 }
          : undefined,
      )
    );
    const group = imageGroup("group", {
      x: 24,
      width: 500,
      height: 260,
      images,
    });
    const value = plan([
      ...Array.from({ length: 36 }, (_, index) =>
        paragraph(`lead-${index}`, `前置正文 ${index + 1}`)
      ),
      block("group-block", "imageGroup", { groupId: group.id }, undefined),
    ], [group]);

    const pdf = await PDFDocument.load(
      await exporter().export(value, assetsFor(value)),
    );
    const draws = pdf.getPages().map((_, index) => imageDrawCount(pdf, index));

    expect(pdf.getPageCount()).toBe(2);
    expect(draws[0]).toBe(0);
    expect(draws[1]).toBe(images.length);
    expect(draws.reduce((sum, count) => sum + count, 0)).toBe(images.length);
  }, 30_000);

  it("counts a positive root offset when keeping a near-bottom group together", async () => {
    const lead = Array.from({ length: 34 }, (_, index) =>
      paragraph(`lead-${index}`, `前置正文 ${index + 1}`)
    );
    const makePlan = (frameOffsetY: number) => {
      const group = imageGroup(`root-${frameOffsetY}`, {
        width: 300,
        height: 100,
        frameOffsetY,
        images: [
          image(
            `root-image-${frameOffsetY}`,
            `references/root-${frameOffsetY}.png`,
            120,
            80,
          ),
        ],
      });
      return plan([
        ...lead,
        block(
          `root-block-${frameOffsetY}`,
          "imageGroup",
          { groupId: group.id },
          undefined,
        ),
      ], [group]);
    };
    const zero = await PDFDocument.load(
      await exporter().export(makePlan(0), assetsFor(makePlan(0))),
    );
    const positivePlan = makePlan(200);
    const positive = await PDFDocument.load(
      await exporter().export(positivePlan, assetsFor(positivePlan)),
    );

    expect(zero.getPageCount()).toBe(1);
    expect(imageDrawCount(zero, 0)).toBe(1);
    expect(positive.getPageCount()).toBe(2);
    expect(imageDrawCount(positive, 0)).toBe(0);
    expect(imageDrawCount(positive, 1)).toBe(1);
  }, 30_000);

  it("renders an exact full-content-page group without clipping or an extra page", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const scale = PDF_VISUAL_CONTRACT.editor.rootLogicalToPdfScale;
    const frameHeight = PDF_VISUAL_CONTRACT.page.contentHeight / scale - 18;
    const group = imageGroup("exact-page", {
      width: 1_008,
      height: frameHeight + 18,
      images: [
        image("exact", "references/exact.png", 100, frameHeight),
      ],
    });
    const value = plan([
      block("group-block", "imageGroup", { groupId: group.id }, undefined),
    ], [group]);
    const pdf = await PDFDocument.load(
      await exporter().export(value, assetsFor(value)),
    );

    expect(pdf.getPageCount()).toBe(1);
    expect(imageDrawCount(pdf, 0)).toBe(1);
    const draw = imageDraws(pdf, 0)[0];
    expect(draw.minX).toBeGreaterThanOrEqual(
      PDF_VISUAL_CONTRACT.page.margin - 0.01,
    );
    expect(draw.maxX).toBeLessThanOrEqual(
      PDF_VISUAL_CONTRACT.page.width -
        PDF_VISUAL_CONTRACT.page.margin +
        0.01,
    );
    expect(draw.minY).toBeGreaterThanOrEqual(
      PDF_VISUAL_CONTRACT.page.margin - 0.01,
    );
    expect(draw.maxY).toBeLessThanOrEqual(
      PDF_VISUAL_CONTRACT.page.height -
        PDF_VISUAL_CONTRACT.page.margin +
        0.01,
    );
    expect(warning.mock.calls.flat().join(" ")).not.toContain(
      "can't wrap between pages",
    );
  }, 30_000);

  it.each([
    { rowCount: 3, expectedPages: 2, expectedDraws: [2, 1] },
    { rowCount: 5, expectedPages: 3, expectedDraws: [2, 2, 1] },
  ])("starts a first-block $rowCount-row group on page 1 and splits it across $expectedPages pages", async ({
    rowCount,
    expectedPages,
    expectedDraws,
  }) => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const images = Array.from({ length: rowCount }, (_, index) =>
      image(
        `row-${index + 1}`,
        `references/row-${index + 1}.png`,
        900,
        600,
        index === 0
          ? { x: 0.2, y: 0.1, width: 0.6, height: 0.8 }
          : undefined,
      )
    );
    const group = imageGroup(`oversized-${rowCount}`, {
      width: 1_008,
      height: 18 + rowCount * 600 + (rowCount - 1) * 7,
      images,
    });
    const value = plan([
      block("group-block", "imageGroup", { groupId: group.id }, undefined),
    ], [group]);
    const pdf = await PDFDocument.load(
      await exporter().export(value, assetsFor(value)),
    );

    expect(pdf.getPageCount()).toBe(expectedPages);
    expect(pdf.getPages().map((_, index) => imageDrawCount(pdf, index))).toEqual(
      expectedDraws,
    );
    expect(renderedImageCount(pdf)).toBe(rowCount);
    expectNoBlankPages(pdf);
    for (let pageIndex = 0; pageIndex < pdf.getPageCount(); pageIndex += 1) {
      for (const draw of imageDraws(pdf, pageIndex)) {
        expect(draw.minX).toBeGreaterThanOrEqual(
          PDF_VISUAL_CONTRACT.page.margin - 0.01,
        );
        expect(draw.maxX).toBeLessThanOrEqual(
          PDF_VISUAL_CONTRACT.page.width -
            PDF_VISUAL_CONTRACT.page.margin +
            0.01,
        );
        expect(draw.minY).toBeGreaterThanOrEqual(
          PDF_VISUAL_CONTRACT.page.margin - 0.01,
        );
        expect(draw.maxY).toBeLessThanOrEqual(
          PDF_VISUAL_CONTRACT.page.height -
            PDF_VISUAL_CONTRACT.page.margin +
            0.01,
        );
      }
    }
    expect(warning.mock.calls.flat().join(" ")).not.toContain(
      "can't wrap between pages",
    );
  }, 30_000);

  it("preserves paired-row image order exactly once across page fragments", async () => {
    const scale = PDF_VISUAL_CONTRACT.editor.rootLogicalToPdfScale;
    const widths = [300, 500, 320, 480, 340, 460];
    const images = widths.map((width, index) =>
      image(
        `paired-${index + 1}`,
        `references/paired-${index + 1}.png`,
        width,
        600,
        index === 0
          ? { x: 0.2, y: 0.1, width: 0.6, height: 0.8 }
          : undefined,
      )
    );
    const group = imageGroup("paired-rows", {
      width: 1_008,
      height: 1_832,
      images,
    });
    const value = plan([
      block("group-block", "imageGroup", { groupId: group.id }, undefined),
    ], [group]);
    const pdf = await PDFDocument.load(
      await exporter().export(value, assetsFor(value)),
    );
    const draws = pdf.getPages().map((_, index) => imageDraws(pdf, index));

    expect(draws.map((pageDraws) => pageDraws.length)).toEqual([4, 2]);
    expect(draws.flat()).toHaveLength(images.length);
    expect(draws.flat().map((draw) => draw.maxX - draw.minX)).toEqual(
      widths.map((width) => expect.closeTo(width * scale, 1)),
    );
  }, 30_000);

  it("starts an oversized group on a fresh page after preceding text", async () => {
    const group = imageGroup("preceded", {
      width: 1_008,
      height: 1_832,
      images: [
        image("row-1", "references/preceded-1.png", 900, 600),
        image("row-2", "references/preceded-2.png", 900, 600),
        image("row-3", "references/preceded-3.png", 900, 600),
      ],
    });
    const value = plan([
      paragraph("lead", "前置正文"),
      block("group-block", "imageGroup", { groupId: group.id }, undefined),
    ], [group]);
    const pdf = await PDFDocument.load(
      await exporter().export(value, assetsFor(value)),
    );

    expect(pdf.getPageCount()).toBe(3);
    expect(pdf.getPages().map((_, index) => imageDrawCount(pdf, index))).toEqual(
      [0, 2, 1],
    );
    expectNoBlankPages(pdf);
  }, 30_000);

  it("uses one transition for paragraph, authored page break, and an oversized group", async () => {
    const group = imageGroup("after-page-break", {
      width: 1_008,
      height: 1_832,
      images: [
        image("break-row-1", "references/break-row-1.png", 900, 600),
        image("break-row-2", "references/break-row-2.png", 900, 600),
        image("break-row-3", "references/break-row-3.png", 900, 600),
      ],
    });
    const value = plan([
      paragraph("lead", "分页前正文"),
      block("page-break", "pageBreak", {}, undefined),
      block("group-block", "imageGroup", { groupId: group.id }, undefined),
    ], [group]);
    const pdf = await PDFDocument.load(
      await exporter().export(value, assetsFor(value)),
    );

    expect(pdf.getPageCount()).toBe(3);
    expect(pdf.getPages().map((_, index) => imageDrawCount(pdf, index))).toEqual(
      [0, 2, 1],
    );
    expect(renderedImageCount(pdf)).toBe(3);
    expectNoBlankPages(pdf);
  }, 30_000);

  it("does not add a blank page after an exact full-page predecessor", async () => {
    const scale = PDF_VISUAL_CONTRACT.editor.rootLogicalToPdfScale;
    const exactFrameHeight =
      PDF_VISUAL_CONTRACT.page.contentHeight / scale - 18;
    const exact = imageGroup("exact-predecessor", {
      width: 1_008,
      height: exactFrameHeight + 18,
      images: [
        image(
          "exact-predecessor-image",
          "references/exact-predecessor.png",
          100,
          exactFrameHeight,
        ),
      ],
    });
    const oversized = imageGroup("after-exact-page", {
      width: 1_008,
      height: 1_832,
      images: [
        image("exact-row-1", "references/exact-row-1.png", 900, 600),
        image("exact-row-2", "references/exact-row-2.png", 900, 600),
        image("exact-row-3", "references/exact-row-3.png", 900, 600),
      ],
    });
    const value = plan([
      block(
        "exact-group-block",
        "imageGroup",
        { groupId: exact.id },
        undefined,
      ),
      block(
        "oversized-group-block",
        "imageGroup",
        { groupId: oversized.id },
        undefined,
      ),
    ], [exact, oversized]);
    const pdf = await PDFDocument.load(
      await exporter().export(value, assetsFor(value)),
    );

    expect(pdf.getPageCount()).toBe(3);
    expect(pdf.getPages().map((_, index) => imageDrawCount(pdf, index))).toEqual(
      [1, 2, 1],
    );
    expect(renderedImageCount(pdf)).toBe(4);
    expectNoBlankPages(pdf);
  }, 30_000);

  it("applies positive group offset only before the first oversized fragment", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const group = imageGroup("offset-fragments", {
      width: 1_008,
      height: 1_832,
      frameOffsetY: 250,
      images: [
        image("offset-row-1", "references/offset-row-1.png", 900, 600),
        image("offset-row-2", "references/offset-row-2.png", 900, 600),
        image("offset-row-3", "references/offset-row-3.png", 900, 600),
      ],
    });
    const value = plan([
      block("group-block", "imageGroup", { groupId: group.id }, undefined),
    ], [group]);
    const pdf = await PDFDocument.load(
      await exporter().export(value, assetsFor(value)),
    );

    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getPages().map((_, index) => imageDrawCount(pdf, index))).toEqual(
      [1, 2],
    );
    expect(imageDraws(pdf, 0)[0].maxY).toBeLessThan(
      imageDraws(pdf, 1)[0].maxY,
    );
    expect(warning.mock.calls.flat().join(" ")).not.toContain(
      "can't wrap between pages",
    );
  }, 30_000);

  it("preserves a negative offset without changing flow or leaving page bounds", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const makePlan = (frameOffsetY: number) => {
      const group = imageGroup(`negative-${frameOffsetY}`, {
        width: 300,
        height: 180,
        frameOffsetY,
        images: [
          image(
            `negative-image-${frameOffsetY}`,
            `references/negative-${frameOffsetY}.png`,
            120,
            80,
          ),
        ],
      });
      return plan([
        paragraph(`lead-${frameOffsetY}`, "前置正文"),
        block(
          `group-block-${frameOffsetY}`,
          "imageGroup",
          { groupId: group.id },
          undefined,
        ),
      ], [group]);
    };
    const zeroPlan = makePlan(0);
    const negativePlan = makePlan(-24);
    const zero = await PDFDocument.load(
      await exporter().export(zeroPlan, assetsFor(zeroPlan)),
    );
    const negative = await PDFDocument.load(
      await exporter().export(negativePlan, assetsFor(negativePlan)),
    );
    const zeroDraw = imageDraws(zero, 0)[0];
    const negativeDraw = imageDraws(negative, 0)[0];

    expect(zero.getPageCount()).toBe(1);
    expect(negative.getPageCount()).toBe(1);
    expect(renderedImageCount(negative)).toBe(1);
    expect(negativeDraw.maxY).toBeGreaterThan(zeroDraw.maxY);
    expect(negativeDraw.maxY - negativeDraw.minY).toBeCloseTo(
      zeroDraw.maxY - zeroDraw.minY,
      2,
    );
    expect(negativeDraw.minX).toBeGreaterThanOrEqual(0);
    expect(negativeDraw.minY).toBeGreaterThanOrEqual(0);
    expect(negativeDraw.maxX).toBeLessThanOrEqual(
      PDF_VISUAL_CONTRACT.page.width,
    );
    expect(negativeDraw.maxY).toBeLessThanOrEqual(
      PDF_VISUAL_CONTRACT.page.height,
    );
    expect(warning.mock.calls.flat().join(" ")).not.toContain(
      "can't wrap between pages",
    );
  }, 30_000);

  it("applies emergency scaling to one overheight row only", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const group = imageGroup("emergency", {
      width: 1_008,
      height: 2_325,
      images: [
        image("overheight", "references/overheight.png", 900, 1_800),
        image("normal", "references/normal.png", 900, 500),
      ],
    });
    const value = plan([
      block("group-block", "imageGroup", { groupId: group.id }, undefined),
    ], [group]);
    const pdf = await PDFDocument.load(
      await exporter().export(value, assetsFor(value)),
    );

    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getPages().map((_, index) => imageDrawCount(pdf, index))).toEqual(
      [1, 1],
    );
    const first = imageDraws(pdf, 0)[0];
    const second = imageDraws(pdf, 1)[0];
    expect(first.maxY - first.minY).toBeLessThan(
      PDF_VISUAL_CONTRACT.page.contentHeight,
    );
    expect(second.maxY - second.minY).toBeCloseTo(
      500 * PDF_VISUAL_CONTRACT.editor.rootLogicalToPdfScale,
      1,
    );
    expect(warning.mock.calls.flat().join(" ")).not.toContain(
      "can't wrap between pages",
    );
  }, 30_000);

  it.each([0.25, 0.250001])(
    "renders an indivisible row accepted at emergency scale %s",
    async (requiredScale) => {
      const group = emergencyRowGroup("boundary", requiredScale);
      const value = plan([
        block("group-block", "imageGroup", { groupId: group.id }, undefined),
      ], [group]);
      const pdf = await PDFDocument.load(
        await exporter().export(value, assetsFor(value)),
      );

      expect(pdf.getPageCount()).toBe(1);
      expect(renderedImageCount(pdf)).toBe(1);
      const draw = imageDraws(pdf, 0)[0];
      expect(draw.minY).toBeGreaterThanOrEqual(
        PDF_VISUAL_CONTRACT.page.margin - 0.01,
      );
      expect(draw.maxY).toBeLessThanOrEqual(
        PDF_VISUAL_CONTRACT.page.height -
          PDF_VISUAL_CONTRACT.page.margin +
          0.01,
      );
    },
    30_000,
  );

  it.each([0.24475, 0.24])(
    "rejects emergency scale %s before rendering any PDF bytes",
    async (requiredScale) => {
      const group = emergencyRowGroup("below-floor", requiredScale);
      const value = plan([
        block(
          "below-floor-block",
          "imageGroup",
          { groupId: group.id },
          undefined,
        ),
      ], [group]);
      const renderDocument = vi.fn();
      const boundaryExporter = createReactPdfBlockNoteExporter({
        fontSources: FONT_SOURCES,
        optimizeImage: async (dataUrl) => imageDataFromDataUrl(dataUrl),
        measureImage: async () => ({ width: 1200, height: 800 }),
        renderDocument,
      });

      await expect(boundaryExporter.export(value, assetsFor(value))).rejects
        .toSatisfy((error) => {
          expect(error).toBeInstanceOf(PreshotPdfPreflightError);
          const issue = (error as PreshotPdfPreflightError).fatalErrors[0];
          expect(issue).toMatchObject({
            code: "IMAGE_GROUP_ROW_SCALE_BELOW_MINIMUM",
            blockId: "below-floor-block",
            groupId: "below-floor",
            rowIndex: 0,
            minimumScale: 0.25,
          });
          expect(issue.requiredScale).toBeCloseTo(requiredScale, 7);
          return true;
        });
      expect(renderDocument).not.toHaveBeenCalled();
    });

  it("keeps oversized fragments row-atomic in a preceded weighted two-thirds column row", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const group = imageGroup("column-oversized", {
      width: 1_008,
      height: 1_832,
      images: [
        image("column-row-1", "references/column-row-1.png", 600, 600),
        image("column-row-2", "references/column-row-2.png", 600, 600),
        image("column-row-3", "references/column-row-3.png", 600, 600),
      ],
    });
    const value = plan([
      paragraph("lead", "列布局前置正文"),
      block("columns", "columnList", {}, undefined, [
        block("wide", "column", { width: 2 }, undefined, [
          block(
            "group-block",
            "imageGroup",
            { groupId: group.id },
            undefined,
          ),
        ]),
        block("narrow", "column", { width: 1 }, undefined, [
          ...Array.from({ length: 50 }, (_, index) =>
            paragraph(`copy-${index}`, `混排正文 ${index + 1}`)
          ),
        ]),
      ]),
    ], [group]);
    const pdf = await PDFDocument.load(
      await exporter().export(value, assetsFor(value)),
    );
    const draws = pdf.getPages().map((_, index) => imageDrawCount(pdf, index));

    expect(draws[0]).toBe(0);
    expect(draws.filter((count) => count > 0)).toEqual([2, 1]);
    expect(draws.reduce((total, count) => total + count, 0)).toBe(3);
    expect(warning.mock.calls.flat().join(" ")).not.toContain(
      "can't wrap between pages",
    );
  }, 30_000);

  it("uses one transition for an authored page break before a fragmented column row", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const group = imageGroup("column-after-page-break", {
      width: 1_008,
      height: 1_832,
      images: [
        image("column-break-1", "references/column-break-1.png", 600, 600),
        image("column-break-2", "references/column-break-2.png", 600, 600),
        image("column-break-3", "references/column-break-3.png", 600, 600),
      ],
    });
    const value = plan([
      paragraph("lead", "列分页前正文"),
      block("page-break", "pageBreak", {}, undefined),
      block("columns", "columnList", {}, undefined, [
        block("wide", "column", { width: 2 }, undefined, [
          block(
            "group-block",
            "imageGroup",
            { groupId: group.id },
            undefined,
          ),
        ]),
        block("narrow", "column", { width: 1 }, undefined, [
          paragraph("copy", "同页列正文"),
        ]),
      ]),
    ], [group]);
    const pdf = await PDFDocument.load(
      await exporter().export(value, assetsFor(value)),
    );

    expect(pdf.getPageCount()).toBe(3);
    expect(pdf.getPages().map((_, index) => imageDrawCount(pdf, index))).toEqual(
      [0, 2, 1],
    );
    expect(renderedImageCount(pdf)).toBe(3);
    expectNoBlankPages(pdf);
    expect(warning.mock.calls.flat().join(" ")).not.toContain(
      "can't wrap between pages",
    );
  }, 30_000);

  it("fits a true 100x1000 image with an 80-word caption without rejection or oversize warning", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const value = plan([
      block("native", "image", {
        name: "tall.png",
        url: "media/tall.png",
        caption: Array.from(
          { length: 80 },
          (_, index) => `caption${index + 1}`,
        ).join(" "),
        showPreview: true,
        previewWidth: 400,
      }, undefined),
    ]);
    const pdf = await PDFDocument.load(
      await exporter({ width: 100, height: 1_000 }).export(
        value,
        assetsFor(value),
      ),
    );

    expect(pdf.getPageCount()).toBe(1);
    expect(imageDrawCount(pdf, 0)).toBe(1);
    expect(warning.mock.calls.flat().join(" ")).not.toContain(
      "can't wrap between pages",
    );
  }, 30_000);

  it("keeps a weighted-column image group atomic while long sibling text paginates", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const group = imageGroup("column-group", {
      width: 500,
      height: 220,
      images: [
        image("column-1", "references/column-1.png", 200, 120),
        image("column-2", "references/column-2.png", 200, 120),
      ],
    });
    const longText = Array.from({ length: 80 }, (_, index) =>
      paragraph(`copy-${index}`, `左栏长文 ${index + 1}`)
    );
    const value = plan([
      block("columns", "columnList", {}, undefined, [
        block("wide", "column", { width: 2 }, undefined, longText),
        block("narrow", "column", { width: 1 }, undefined, [
          block(
            "group-block",
            "imageGroup",
            { groupId: group.id },
            undefined,
          ),
        ]),
      ]),
    ], [group]);

    const pdf = await PDFDocument.load(
      await exporter().export(value, assetsFor(value)),
    );
    const draws = pdf.getPages().map((_, index) => imageDrawCount(pdf, index));

    expect(pdf.getPageCount()).toBeGreaterThan(1);
    expect(draws.filter((count) => count > 0)).toHaveLength(1);
    expect(draws.reduce((sum, count) => sum + count, 0)).toBe(2);
    expect(warning.mock.calls.flat().join(" ")).not.toContain(
      "can't wrap between pages",
    );
  }, 30_000);
});
