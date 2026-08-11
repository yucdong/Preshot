// @vitest-environment jsdom
import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "node:fs";
import {
  decodePDFRawStream,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
} from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import type { ProjectPlan } from "../../domain/plan/canvas/models";
import { createCanvasPdfExporter } from "./canvasPdfExporter";
import { imageDataFromDataUrl } from "./pdfImageOptimizer";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const loadFonts = async () => ({
  regular: new Uint8Array(readFileSync("src/infrastructure/pdf/fonts/NotoSansSC-Regular.ttf")),
  bold: new Uint8Array(readFileSync("src/infrastructure/pdf/fonts/NotoSansSC-Bold.ttf")),
});

const testExporter = () =>
  createCanvasPdfExporter(loadFonts, {
    optimizeImage: async (dataUrl) => imageDataFromDataUrl(dataUrl),
  });

const plan: ProjectPlan = {
  schemaVersion: 10,
  title: "Editorial",
  components: [
    {
      id: "p1",
      name: "Plan",
      type: "plan",
      x: 0,
      width: 500,
      height: 180,
      textRoot: { kind: "leaf", id: "p1:root", html: "<p>正文</p>" },
    },
    {
      id: "r1",
      name: "Reference",
      type: "reference",
      x: 0,
      width: 500,
      height: 260,
      description: "",
      images: [{
        id: "img1",
        file: "photo.png",
        caption: "preserved but not exported",
        aspectRatio: 1,
        frameWidth: 100,
        frameHeight: 100,
      }],
    },
  ],
};

function embeddedCidFontSubtypes(pdf: PDFDocument): string[] {
  return pdf.context
    .enumerateIndirectObjects()
    .flatMap(([, object]) => {
      if (!(object instanceof PDFDict)) {
        return [];
      }
      const type = object.get(PDFName.of("Type"));
      const subtype = object.get(PDFName.of("Subtype"));
      return type?.toString() === "/Font" && subtype?.toString().startsWith("/CIDFontType")
        ? [subtype.toString()]
        : [];
    });
}

function type0FontsUseUnicodeIdentityEncoding(pdf: PDFDocument): boolean {
  const type0Fonts = pdf.context
    .enumerateIndirectObjects()
    .flatMap(([, object]) =>
      object instanceof PDFDict && object.get(PDFName.of("Subtype"))?.toString() === "/Type0"
        ? [object]
        : [],
    );
  return (
    type0Fonts.length > 0 &&
    type0Fonts.every(
      (font) =>
        font.has(PDFName.of("ToUnicode")) &&
        font.get(PDFName.of("Encoding"))?.toString() === "/Identity-H",
    )
  );
}

function embeddedTrueTypeFonts(pdf: PDFDocument): Uint8Array[] {
  return pdf.context
    .enumerateIndirectObjects()
    .flatMap(([, object]) => {
      if (
        !(object instanceof PDFDict) ||
        object.get(PDFName.of("Type"))?.toString() !== "/FontDescriptor"
      ) {
        return [];
      }
      const stream = pdf.context.lookup(object.get(PDFName.of("FontFile2")));
      return stream instanceof PDFRawStream
        ? [decodePDFRawStream(stream).decode()]
        : [];
    });
}

describe("createCanvasPdfExporter", () => {
  it("keeps the temporary PDF path compiling for v7 cards", async () => {
    const bytes = await testExporter().export(plan, {
      "photo.png": TINY_PNG,
    });

    expect(Array.from(bytes.slice(0, 4))).toEqual([0x25, 0x50, 0x44, 0x46]);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
  }, 20000);

  it("embeds Chinese text as Android-compatible CID TrueType fonts", async () => {
    const bytes = await testExporter().export(
      {
        ...plan,
        title: "小清新人像拍摄",
        components: plan.components.map((component) => ({
          ...component,
          name: component.type === "plan" ? "拍摄计划" : "参考样图",
        })),
      },
      { "photo.png": TINY_PNG },
    );
    const pdf = await PDFDocument.load(bytes);

    expect(embeddedCidFontSubtypes(pdf)).toEqual([
      "/CIDFontType2",
      "/CIDFontType2",
    ]);
    expect(type0FontsUseUnicodeIdentityEncoding(pdf)).toBe(true);
    expect(bytes.length).toBeLessThan(2_000_000);
    const expectedText = "小清新人像拍摄计划参考样图";
    const embeddedFonts = embeddedTrueTypeFonts(pdf);
    expect(embeddedFonts).toHaveLength(2);
    for (const fontBytes of embeddedFonts) {
      const font = fontkit.create(fontBytes);
      for (const character of expectedText) {
        const glyph = font.glyphForCodePoint(character.codePointAt(0) ?? 0);
        expect(glyph.id).toBeGreaterThan(0);
        expect(glyph.path.toSVG().length).toBeGreaterThan(0);
      }
    }
  }, 20000);

  it("reports a missing image before attempting PDF rendering", async () => {
    await expect(testExporter().export(plan, {})).rejects.toThrow(
      /Missing reference image data/,
    );
  });

  it("exports nested title-free text leaves", async () => {
    const splitPlan: ProjectPlan = {
      schemaVersion: 10,
      title: "递归文案",
      components: [{
        id: "split-plan",
        name: "内部名称不导出",
        type: "plan",
        x: 0,
        width: 500,
        height: 360,
        textRoot: {
          kind: "split",
          id: "split-root",
          direction: "columns",
          gap: 12,
          children: [
            { kind: "leaf", id: "left", html: "<p>左侧内容</p>" },
            {
              kind: "split",
              id: "right",
              direction: "rows",
              gap: 12,
              children: [
                { kind: "leaf", id: "top", html: "<p>上方内容</p>" },
                { kind: "leaf", id: "bottom", html: "<p>下方内容</p>" },
              ],
            },
          ],
        },
      }],
    };

    const bytes = await testExporter().export(splitPlan, {});
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
    expect(bytes.length).toBeLessThan(2_000_000);
  }, 20000);

  it("optimizes each source image once for its largest PDF draw box", async () => {
    const optimizeImage = vi.fn(async (dataUrl: string) => {
      const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
      if (!match) throw new Error("Invalid test image");
      return {
        mime: match[1],
        bytes: Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0)),
      };
    });

    await createCanvasPdfExporter(loadFonts, { optimizeImage }).export(plan, {
      "photo.png": TINY_PNG,
    });

    expect(optimizeImage).toHaveBeenCalledTimes(1);
    expect(optimizeImage).toHaveBeenCalledWith(
      TINY_PNG,
      expect.objectContaining({ width: 100, height: 100 }),
    );
  }, 20000);
});
