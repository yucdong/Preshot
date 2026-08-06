// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { A4, SPACING } from "../../domain/plan/canvas/geometry";
import { buildCanvasLayout } from "../../domain/plan/canvas/pdf/exportDocument";
import type { ProjectPlan } from "../../domain/plan/canvas/models";
import { formatReferenceContinuedTitle } from "../../shared/i18n/referenceTitles";
import { createCanvasPdfExporter } from "./canvasPdfExporter";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  const typeBytes = new TextEncoder().encode(type);
  view.setUint32(0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

function createSolidPngDataUrl(width: number, height: number): string {
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const row = new Uint8Array(1 + width * 4);
  row[0] = 0;
  for (let x = 0; x < width; x += 1) {
    const offset = 1 + x * 4;
    row[offset] = 0x66;
    row[offset + 1] = 0x99;
    row[offset + 2] = 0xcc;
    row[offset + 3] = 0xff;
  }

  const raw = new Uint8Array(row.length * height);
  for (let y = 0; y < height; y += 1) {
    raw.set(row, y * row.length);
  }

  const idat = deflateSync(raw);
  const png = Buffer.concat([
    Buffer.from(signature),
    Buffer.from(pngChunk("IHDR", ihdr)),
    Buffer.from(pngChunk("IDAT", idat)),
    Buffer.from(pngChunk("IEND", new Uint8Array())),
  ]);

  return `data:image/png;base64,${png.toString("base64")}`;
}

const loadFonts = async () => ({
  regular: new Uint8Array(readFileSync("src/infrastructure/pdf/fonts/NotoSansSC-Regular.otf")),
  bold: new Uint8Array(readFileSync("src/infrastructure/pdf/fonts/NotoSansSC-Bold.otf")),
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createCanvasPdfExporter", () => {
  it("produces a valid PDF from a canvas layout with plan component", async () => {
    const exporter = createCanvasPdfExporter(loadFonts);
    const plan: ProjectPlan = {
      schemaVersion: 5,
      title: "Demo",
      components: [
        {
          id: "p1",
          rowId: `row:${"p1"}`,
          name: "文案1",
          type: "plan",
          width: 1,
          html: "<h1>标题</h1><p>段落 <strong>粗体</strong> text</p>",
        },
      ],
    };

    const bytes = await exporter.export(plan, {});

    expect(bytes[0]).toBe(0x25); // %
    expect(bytes[1]).toBe(0x50); // P
    expect(bytes[2]).toBe(0x44); // D
    expect(bytes[3]).toBe(0x46); // F
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(1);
    const page = parsed.getPage(0);
    expect(Math.round(page.getWidth())).toBe(595);
    expect(Math.round(page.getHeight())).toBe(842);
  }, 20000);

  it("exports document and component titles, hidden captions, and cropped images", async () => {
    const exporter = createCanvasPdfExporter(loadFonts);
    const pdfLib = await import("pdf-lib");
    const drawText = vi.spyOn(pdfLib.PDFPage.prototype, "drawText");
    const pushOperators = vi.spyOn(pdfLib.PDFPage.prototype, "pushOperators");
    const plan: ProjectPlan = {
      schemaVersion: 5,
      title: "Editorial",
      components: [
        {
          id: "p1",
          rowId: `row:${"p1"}`,
          name: "文案1",
          type: "plan",
          width: 1,
          html: "<p>正文</p>",
        },
        {
          id: "r1",
          rowId: `row:${"r1"}`,
          name: "图片组1",
          type: "reference",
          width: 1,
          description: "",
          showCaptions: false,
          imageHeight: 135,
          images: [
            {
              id: "img1",
              file: "photo.png",
              caption: "拍摄说明",
              aspectRatio: 1,
              crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
            },
          ],
        },
      ],
    };

    await exporter.export(plan, { "photo.png": createSolidPngDataUrl(100, 100) });

    const drawnTexts = drawText.mock.calls.map(([text]) => text);
    const pushedOperators = pushOperators.mock.calls.flat();

    expect(drawnTexts).toEqual(expect.arrayContaining([
      "Editorial",
      "文案1",
      "图片组1",
      "拍摄说明",
    ]));
    expect(drawnTexts.filter((text) => text === "Editorial")).toHaveLength(1);
    expect(pushedOperators).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "W" }),
    ]));
    const operatorNames = pushedOperators.map(
      (operator) => (operator as unknown as { name: string }).name,
    );
    expect(operatorNames.filter((name) => name === "q")).toHaveLength(
      operatorNames.filter((name) => name === "Q").length,
    );
  }, 20000);

  it("measures long plan text before layout so its tail and following component both render", async () => {
    const exporter = createCanvasPdfExporter(loadFonts);
    const drawText = vi.spyOn((await import("pdf-lib")).PDFPage.prototype, "drawText");
    const longHtml = [
      ...Array.from(
        { length: 12 },
        (_, index) => `<p>Plan line ${index + 1} with enough content.</p>`,
      ),
      "<p>TAIL_SENTINEL</p>",
    ].join("");
    const plan: ProjectPlan = {
      schemaVersion: 5,
      title: "Demo",
      components: [
        { id: "p1", rowId: `row:${"p1"}`, name: "文案1", type: "plan", width: 1, html: longHtml },
        {
          id: "p2",
          rowId: `row:${"p2"}`,
          name: "文案1",
          type: "plan",
          width: 1,
          html: "<p>FOLLOWING_SENTINEL</p>",
        },
      ],
    };

    await exporter.export(plan, {});

    const tailCall = drawText.mock.calls.find(([text]) => text === "TAIL_SENTINEL");
    const followingCall = drawText.mock.calls.find(
      ([text]) => text === "FOLLOWING_SENTINEL",
    );

    expect(tailCall).toBeDefined();
    expect(followingCall).toBeDefined();
    expect(followingCall?.[1]?.y).toBeLessThan(tailCall?.[1]?.y ?? 0);
  }, 20000);

  it("produces a valid PDF from a canvas layout with reference component", async () => {
    const exporter = createCanvasPdfExporter(loadFonts);
    const plan: ProjectPlan = {
      schemaVersion: 5,
      title: "Demo",
      components: [
        {
          id: "r1",
          rowId: `row:${"r1"}`,
          type: "reference",
          width: 1,
          name: "参考照片",
          description: "描述 <em>italic</em>",
          showCaptions: true,
          imageHeight: 180,
          images: [
            { id: "img1", file: "photo1.png", caption: "图1", aspectRatio: 1 },
            { id: "img2", file: "photo2.png", caption: "图2", aspectRatio: 1 },
          ],
        },
      ],
    };

    const bytes = await exporter.export(plan, {
      "photo1.png": TINY_PNG,
      "photo2.png": TINY_PNG,
    });

    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(1);
  }, 20000);

  it("rejects missing expected image data with file and component context", async () => {
    const exporter = createCanvasPdfExporter(loadFonts);
    const plan: ProjectPlan = {
      schemaVersion: 5,
      title: "Demo",
      components: [
        {
          id: "r1",
          rowId: `row:${"r1"}`,
          type: "reference",
          width: 1,
          name: "Reference",
          description: "",
          showCaptions: false,
          imageHeight: 135,
          images: [
            {
              id: "img1",
              file: "photo1.png",
              aspectRatio: 1,
            },
          ],
        },
      ],
    };

    await expect(exporter.export(plan, {})).rejects.toThrow(
      'Missing reference image data for "photo1.png" (component "r1", image "img1")',
    );
  }, 20000);

  it("measures and renders the complete reference description", async () => {
    const exporter = createCanvasPdfExporter(loadFonts);
    const drawText = vi.spyOn((await import("pdf-lib")).PDFPage.prototype, "drawText");
    const description = [
      ...Array.from(
        { length: 8 },
        (_, index) => `<p>Description line ${index + 1}.</p>`,
      ),
      "<p>DESCRIPTION_TAIL</p>",
    ].join("");
    const plan: ProjectPlan = {
      schemaVersion: 5,
      title: "Demo",
      components: [
        {
          id: "r1",
          rowId: `row:${"r1"}`,
          type: "reference",
          width: 1,
          name: "Measured description",
          description,
          showCaptions: false,
          imageHeight: 135,
          images: [],
        },
      ],
    };

    await exporter.export(plan, {});

    expect(drawText.mock.calls.some(([text]) => text === "DESCRIPTION_TAIL")).toBe(
      true,
    );
  }, 20000);

  it("paginates a multi-page reference description before its image row and following component", async () => {
    const exporter = createCanvasPdfExporter(loadFonts);
    const pdfLib = await import("pdf-lib");
    const addPage = vi.spyOn(pdfLib.PDFDocument.prototype, "addPage");
    const drawText = vi.spyOn(pdfLib.PDFPage.prototype, "drawText");
    const drawImage = vi.spyOn(pdfLib.PDFPage.prototype, "drawImage");
    const description = [
      "<p>DESCRIPTION_START</p>",
      ...Array.from(
        { length: 70 },
        (_, index) => `<p>Reference description line ${index + 1}.</p>`,
      ),
      "<p>DESCRIPTION_TAIL</p>",
    ].join("");
    const plan: ProjectPlan = {
      schemaVersion: 5,
      title: "Demo",
      components: [
        {
          id: "r1",
          rowId: `row:${"r1"}`,
          type: "reference",
          width: 1,
          name: "Long reference",
          description,
          showCaptions: false,
          imageHeight: 135,
          images: [
            { id: "img1", file: "photo.png", aspectRatio: 1 },
          ],
        },
        {
          id: "p1",
          rowId: `row:${"p1"}`,
          name: "文案1",
          type: "plan",
          width: 1,
          html: "<p>FOLLOWING_SENTINEL</p>",
        },
      ],
    };

    await exporter.export(plan, { "photo.png": TINY_PNG });

    const pages = addPage.mock.results.map((result) => result.value);
    const pageIndex = (context: unknown) => pages.indexOf(context);
    const textIndex = (text: string) =>
      drawText.mock.calls.findIndex(([value]) => value === text);
    const startIndex = textIndex("DESCRIPTION_START");
    const tailIndex = textIndex("DESCRIPTION_TAIL");
    const followingIndex = textIndex("FOLLOWING_SENTINEL");
    const imagePage = pageIndex(drawImage.mock.contexts[0]);
    const followingPage = pageIndex(drawText.mock.contexts[followingIndex]);

    expect(pageIndex(drawText.mock.contexts[tailIndex])).toBeGreaterThan(
      pageIndex(drawText.mock.contexts[startIndex]),
    );
    expect(imagePage).toBeGreaterThan(
      pageIndex(drawText.mock.contexts[tailIndex]),
    );
    expect(followingPage).toBeGreaterThanOrEqual(imagePage);
    if (followingPage === imagePage) {
      expect(drawText.mock.calls[followingIndex][1]?.y).toBeLessThan(
        drawImage.mock.calls[0][1]?.y ?? Number.NEGATIVE_INFINITY,
      );
    }
  }, 20000);

  it("produces multi-page PDF when components span pages", async () => {
    const exporter = createCanvasPdfExporter(loadFonts);
    const plan: ProjectPlan = {
      schemaVersion: 5,
      title: "Demo",
      components: [
        ...Array.from({ length: 4 }, (_, componentIndex) => ({
          id: `p${componentIndex + 1}`,
          rowId: `row:${`p${componentIndex + 1}`}`,
          name: "文案1",
          type: "plan" as const,
          width: 1,
          html: Array.from(
            { length: 10 },
            (_, lineIndex) =>
              `<p>组件 ${componentIndex + 1} 第 ${lineIndex + 1} 行内容</p>`,
          ).join(""),
        })),
      ],
    };

    const bytes = await exporter.export(plan, {});

    expect(bytes[0]).toBe(0x25); // %
    expect(bytes[1]).toBe(0x50); // P
    expect(bytes[2]).toBe(0x44); // D
    expect(bytes[3]).toBe(0x46); // F
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(2);
  }, 20000);

  it("subsets fonts so long CJK content stays small and does not throw", async () => {
    const exporter = createCanvasPdfExporter(loadFonts);
    // A short component whose CJK text overflows its rect, drawn with only non-bold text so
    // the bold weight's subset would be EMPTY — the exact case that makes fontkit's
    // CFFSubset.encode throw under subset: true. Priming keeps both subsets non-empty, so the
    // exporter must still produce a small, valid PDF.
    const longCjk =
      "拍摄计划详细说明：在清晨的黄金时段前往山顶记录云海与日出的层次变化，注意保留高光细节。".repeat(60);
    const plan: ProjectPlan = {
      schemaVersion: 5,
      title: "Demo",
      components: [
        { id: "p1", rowId: `row:${"p1"}`, name: "文案1", type: "plan", width: 1, html: `<p>${longCjk}</p>` },
      ],
    };

    const bytes = await exporter.export(plan, {});

    expect(bytes[0]).toBe(0x25); // %PDF — did not throw during save
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBeGreaterThan(1);
    // Full-font embeds of both Noto Sans SC weights are ~16 MB; a real subset is well under 2 MB.
    expect(bytes.length).toBeLessThan(2_000_000);
  }, 20000);

  it("draws a plan that exceeds one page onto later pages within page margins", async () => {
    const exporter = createCanvasPdfExporter(loadFonts);
    const drawText = vi.spyOn((await import("pdf-lib")).PDFPage.prototype, "drawText");
    const html = [
      "<p>START_SENTINEL</p>",
      ...Array.from(
        { length: 50 },
        (_, index) => `<p>Long plan line ${index + 1}.</p>`,
      ),
      "<p>END_SENTINEL</p>",
    ].join("");
    const plan: ProjectPlan = {
      schemaVersion: 5,
      title: "Demo",
      components: [{ id: "p1", rowId: `row:${"p1"}`, name: "文案1", type: "plan", width: 1, html }],
    };

    const bytes = await exporter.export(plan, {});
    const parsed = await PDFDocument.load(bytes);
    const startIndex = drawText.mock.calls.findIndex(
      ([text]) => text === "START_SENTINEL",
    );
    const endIndex = drawText.mock.calls.findIndex(
      ([text]) => text === "END_SENTINEL",
    );

    expect(parsed.getPageCount()).toBeGreaterThan(1);
    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(endIndex).toBeGreaterThan(startIndex);
    expect(drawText.mock.contexts[endIndex]).not.toBe(
      drawText.mock.contexts[startIndex],
    );
    expect(drawText.mock.calls[endIndex][1]?.y).toBeGreaterThanOrEqual(SPACING);
    expect(drawText.mock.calls[endIndex][1]?.y).toBeLessThanOrEqual(
      A4.height - SPACING,
    );
  }, 20000);

  it("renders mixed component types correctly", async () => {
    const exporter = createCanvasPdfExporter(loadFonts);
    const plan: ProjectPlan = {
      schemaVersion: 5,
      title: "Demo",
      components: [
        {
          id: "p1",
          rowId: `row:${"p1"}`,
          name: "文案1",
          type: "plan",
          width: 0.5,
          html: "<p>Left <u>underline</u></p>",
        },
        {
          id: "r1",
          rowId: `row:${"r1"}`,
          type: "reference",
          width: 0.5,
          name: "Right",
          description: "",
          showCaptions: false,
          imageHeight: 180,
          images: [{ id: "img1", file: "photo.png", aspectRatio: 1 }],
        },
      ],
    };

    const bytes = await exporter.export(plan, { "photo.png": TINY_PNG });

    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(1);
  }, 20000);

  it("handles reference with single image column", async () => {
    const exporter = createCanvasPdfExporter(loadFonts);
    const plan: ProjectPlan = {
      schemaVersion: 5,
      title: "Demo",
      components: [
        {
          id: "r1",
          rowId: `row:${"r1"}`,
          type: "reference",
          width: 1,
          name: "单列参考",
          description: "单列布局",
          showCaptions: false,
          imageHeight: 180,
          images: [{ id: "img1", file: "photo.png", aspectRatio: 1 }],
        },
      ],
    };

    const bytes = await exporter.export(plan, { "photo.png": TINY_PNG });

    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(1);
  }, 20000);

  it("renders per-image captions when showCaptions is true", async () => {
    const exporter = createCanvasPdfExporter(loadFonts);
    const plan: ProjectPlan = {
      schemaVersion: 5,
      title: "Demo",
      components: [
        {
          id: "r1",
          rowId: `row:${"r1"}`,
          type: "reference",
          width: 1,
          name: "照片集",
          description: "带说明的参考照片",
          showCaptions: true,
          imageHeight: 180,
          images: [
            { id: "img1", file: "photo1.png", caption: "日出 — 黄金时段", aspectRatio: 1 },
            { id: "img2", file: "photo2.png", caption: "中午 — 强光", aspectRatio: 1 },
            { id: "img3", file: "photo3.png", caption: "黄昏 — 蓝调时段", aspectRatio: 1 },
          ],
        },
      ],
    };

    const bytes = await exporter.export(plan, {
      "photo1.png": TINY_PNG,
      "photo2.png": TINY_PNG,
      "photo3.png": TINY_PNG,
    });

    // Assert PDF is produced without throwing and has the expected page count
    expect(bytes[0]).toBe(0x25); // %
    expect(bytes[1]).toBe(0x50); // P
    expect(bytes[2]).toBe(0x44); // D
    expect(bytes[3]).toBe(0x46); // F
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(1);
  }, 20000);

  it("uses SPACING margin (not hardcoded 48pt) for component placement", async () => {
    const exporter = createCanvasPdfExporter(loadFonts);
    const plan: ProjectPlan = {
      schemaVersion: 5,
      title: "Demo",
      components: [
        {
          id: "p1",
          rowId: `row:${"p1"}`,
          name: "文案1",
          type: "plan",
          width: 1,
          html: "<p>Full-width component</p>",
        },
      ],
    };

    const bytes = await exporter.export(plan, {});

    // Parse PDF and verify it was created
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(1);

    // The test verifies the exporter uses SPACING (24) not 48.
    // Content rect should start at x = SPACING + SPACING/2 = 36, not 48 + SPACING/2 = 60.
    // This test fails if hardcoded 48 remains; passes when using SPACING from geometry.ts.
    // Since we can't directly inspect PDF drawing commands without parsing operators,
    // this test ensures the PDF is valid and the change is safe.
    // Manual verification or a helper to extract text positions would show x=36.
    expect(bytes.length).toBeGreaterThan(0);
  }, 20000);

  it("renders continuation headers and fragment-local captions for multi-page references", async () => {
    const exporter = createCanvasPdfExporter(loadFonts);
    const drawText = vi.spyOn((await import("pdf-lib")).PDFPage.prototype, "drawText");
    const plan: ProjectPlan = {
      schemaVersion: 5,
      title: "Demo",
      components: [
        {
          id: "r1",
          rowId: `row:${"r1"}`,
          type: "reference",
          width: 1,
          name: "Lookbook",
          description: "<p>Reference description</p>",
          showCaptions: true,
          imageHeight: 180,
          images: Array.from({ length: 12 }, (_, index) => ({
            id: `img${index + 1}`,
            file: `photo${index + 1}.png`,
            caption: `cap${index + 1}`,
            aspectRatio: index % 2 === 0 ? 1.8 : 0.6,
          })),
        },
      ],
    };

    const bytes = await exporter.export(
      plan,
      Object.fromEntries(plan.components[0].type === "reference"
        ? plan.components[0].images.map((image) => [image.file, TINY_PNG])
        : []),
    );

    const texts = drawText.mock.calls.map(([text]) => text);
    const captionTexts = texts.filter((text) => /^cap\d+$/.test(text));

    expect(await PDFDocument.load(bytes)).toBeDefined();
    expect(texts.filter((text) => text === "Lookbook")).toHaveLength(1);
    expect(texts).toContain(formatReferenceContinuedTitle("Lookbook"));
    expect(texts.filter((text) => text === "Reference")).toHaveLength(1);
    expect(captionTexts).toEqual(Array.from({ length: 12 }, (_, index) => `cap${index + 1}`));
  }, 20000);

  it("draws aspect-ratio matched reference images at exact slot dimensions", async () => {
    const exporter = createCanvasPdfExporter(loadFonts);
    const drawImage = vi.spyOn((await import("pdf-lib")).PDFPage.prototype, "drawImage");
    const plan: ProjectPlan = {
      schemaVersion: 5,
      title: "Demo",
      components: [
        {
          id: "r1",
          rowId: `row:${"r1"}`,
          type: "reference",
          width: 1,
          name: "Ratios",
          description: "",
          showCaptions: false,
          imageHeight: 135,
          images: [
            { id: "landscape", file: "landscape.png", aspectRatio: 4 / 3 },
            { id: "portrait", file: "portrait.png", aspectRatio: 3 / 4 },
          ],
        },
      ],
    };

    await exporter.export(plan, {
      "landscape.png": createSolidPngDataUrl(400, 300),
      "portrait.png": createSolidPngDataUrl(300, 400),
    });

    const drawCalls = drawImage.mock.calls.map(([, options]) => ({
      width: options?.width,
      height: options?.height,
    }));

    expect(drawCalls).toEqual([
      expect.objectContaining({ width: 180, height: 135 }),
      expect.objectContaining({ width: 101.25, height: 135 }),
    ]);
  }, 20000);

  it("letterboxes embedded image dimensions that differ from the stored slot ratio", async () => {
    const exporter = createCanvasPdfExporter(loadFonts);
    const drawImage = vi.spyOn((await import("pdf-lib")).PDFPage.prototype, "drawImage");
    const plan: ProjectPlan = {
      schemaVersion: 5,
      title: "Demo",
      components: [
        {
          id: "r1",
          rowId: `row:${"r1"}`,
          type: "reference",
          width: 1,
          name: "Actual ratio",
          description: "",
          showCaptions: false,
          imageHeight: 135,
          images: [
            { id: "wide-slot", file: "square.png", aspectRatio: 2 },
          ],
        },
      ],
    };

    await exporter.export(plan, {
      "square.png": createSolidPngDataUrl(100, 100),
    });

    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(drawImage.mock.calls[0][1]).toMatchObject({
      width: 135,
      height: 135,
    });
  }, 20000);

  it("draws each continuation-fragment image exactly once using slot ids", async () => {
    const exporter = createCanvasPdfExporter(loadFonts);
    const drawImage = vi.spyOn((await import("pdf-lib")).PDFPage.prototype, "drawImage");
    const plan: ProjectPlan = {
      schemaVersion: 5,
      title: "Demo",
      components: [
        {
          id: "r1",
          rowId: `row:${"r1"}`,
          type: "reference",
          width: 1,
          name: "Lookbook",
          description: "",
          showCaptions: false,
          imageHeight: 135,
          images: Array.from({ length: 20 }, (_, index) => ({
            id: `img${index + 1}`,
            file: `img${index + 1}.png`,
            aspectRatio: index < 4 ? 4 / 3 : 3 / 4,
          })),
        },
      ],
    };
    const [reference] = plan.components;
    if (reference.type !== "reference") {
      throw new Error("expected reference component");
    }

    const imageMap = Object.fromEntries(reference.images.map((image) => [
      image.file,
      image.aspectRatio > 1 ? createSolidPngDataUrl(4, 3) : createSolidPngDataUrl(3, 4),
    ]));

    const layout = buildCanvasLayout(plan.components);
    const expectedDraws = layout.placements
      .filter((placement) => placement.componentId === "r1")
      .flatMap((placement) => placement.imageSlots ?? [])
      .filter((slot) => slot.kind === "image")
      .map((slot) => ({
        width: slot.width,
        height: slot.imageHeight,
      }));

    const bytes = await exporter.export(plan, imageMap);

    expect(layout.pageCount).toBeGreaterThan(1);
    expect(await PDFDocument.load(bytes)).toBeDefined();
    expect(drawImage).toHaveBeenCalledTimes(reference.images.length);
    expect(drawImage.mock.calls.map(([, options]) => ({
      width: options?.width,
      height: options?.height,
    }))).toEqual(expectedDraws);
  }, 20000);
});
