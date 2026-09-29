import { describe, expect, it } from "vitest";
import { pdfWordBreaks } from "./pdfWordBreaks";

describe("PDF Chinese word breaks", () => {
  it("keeps copyable text, Latin tokens and punctuation without visible hyphens", () => {
    const source = "用“图片组”与block（示例）拍摄📷。";
    const result = pdfWordBreaks(source);
    expect(result.join("")).toBe(source);
    expect(result).toContain("");
    expect(result).toContain("block（示");
    for (const part of result.filter(Boolean)) {
      expect(part).not.toMatch(/^[”，。）]/u);
      expect(part).not.toMatch(/[“（]$/u);
    }
  });
  it("preserves the renderer's existing Latin hyphenation", () => {
    expect(pdfWordBreaks("photography", () => ["photo", "graphy"])).toEqual(["photo", "graphy"]);
  });
});
