// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { PdfExportDocument } from "../../domain/plan/pdf/document";
import { createPdfLibExporter } from "./pdfLibExporter";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const loadFonts = async () => ({
  regular: new Uint8Array(readFileSync("src/infrastructure/pdf/fonts/NotoSansSC-Regular.otf")),
  bold: new Uint8Array(readFileSync("src/infrastructure/pdf/fonts/NotoSansSC-Bold.otf")),
});

describe("createPdfLibExporter", () => {
  it("produces a valid A4 PDF with CJK text and a letterboxed image", async () => {
    const exporter = createPdfLibExporter(loadFonts);
    const doc: PdfExportDocument = {
      title: "拍摄计划",
      sections: [
        { html: "<h1>山景</h1><p>晨雾 <strong>逆光</strong> and Latin</p><ul><li>晨曦</li></ul>" },
        { heading: "水景", html: "<p>日落倒影</p>", imageGrid: { columns: 2, files: ["references/0001.png"] } },
      ],
    };

    const bytes = await exporter.export(doc, { "references/0001.png": TINY_PNG });

    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBeGreaterThanOrEqual(1);
    const page = parsed.getPage(0);
    expect(Math.round(page.getWidth())).toBe(595);
    expect(Math.round(page.getHeight())).toBe(842);
  }, 20000);
});
