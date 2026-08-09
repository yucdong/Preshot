import { describe, expect, it } from "vitest";
import { pdfImagePixelBounds } from "./pdfImageOptimizer";

describe("pdfImagePixelBounds", () => {
  it("converts the PDF draw box to a 144 DPI pixel budget", () => {
    expect(pdfImagePixelBounds({ width: 100, height: 75 })).toEqual({
      width: 200,
      height: 150,
    });
  });

  it("normalizes invalid and fractional point dimensions", () => {
    expect(pdfImagePixelBounds({ width: 40.2, height: Number.NaN })).toEqual({
      width: 81,
      height: 1,
    });
  });
});