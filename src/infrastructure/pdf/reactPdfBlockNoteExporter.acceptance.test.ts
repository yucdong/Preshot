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
    schemaVersion: 14,
    title: "React-PDF acceptance",
    document: { format: "preshot-blocks", version: 2, blocks },
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

function renderedImageCount(pdf: PDFDocument): number {
  return pdf.getPages().reduce(
    (total, _page, index) => total + imageDrawCount(pdf, index),
    0,
  );
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

  it("uniformly fits a group taller than the usable page onto one page", async () => {
    const group = imageGroup("oversized", {
      x: 30,
      width: 400,
      height: 2_000,
      frameOffsetY: 12,
      images: [
        image("tall", "references/tall.png", 200, 1_900),
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
  }, 30_000);
});
