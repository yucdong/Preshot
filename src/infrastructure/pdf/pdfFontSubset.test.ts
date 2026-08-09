import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { subsetPdfFont } from "./pdfFontSubset";

describe("subsetPdfFont", () => {
  it("writes a compact TTF whose Chinese glyph outlines all remain readable", () => {
    const source = new Uint8Array(
      readFileSync("src/infrastructure/pdf/fonts/NotoSansSC-Regular.ttf"),
    );
    const text = "中文字体兼容性测试拍摄计划参考样图 0123456789.•";
    const subset = subsetPdfFont(source, text);
    const font = fontkit.create(subset);

    expect(subset.length).toBeLessThan(500_000);
    for (const character of text.replace(/\s/g, "")) {
      const glyph = font.glyphForCodePoint(character.codePointAt(0) ?? 0);
      expect(glyph.id).toBeGreaterThan(0);
      expect(glyph.path.toSVG().length).toBeGreaterThan(0);
    }
  });
});