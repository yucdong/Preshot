import { describe, expect, it } from "vitest";
import {
  PDF_VISUAL_CONTRACT,
  PdfVisualContractError,
  fitKeepTogetherGroupScaleToPage,
  pdfPoints,
  scaleRootEditorLogicalUnits,
} from "./pdfVisualContract";

describe("BlockNote PDF visual contract", () => {
  it("maps the exact editor content width to the exact A4 content width", () => {
    expect(
      scaleRootEditorLogicalUnits(
        PDF_VISUAL_CONTRACT.editor.contentWidth,
      ),
    ).toBe(PDF_VISUAL_CONTRACT.page.contentWidth);
  });

  it("does not enlarge a normal keep-together group", () => {
    expect(
      fitKeepTogetherGroupScaleToPage({
        width: pdfPoints(400),
        height: pdfPoints(500),
      }),
    ).toBe(1);
  });

  it("scales an oversized keep-together group down to the page", () => {
    const scale = fitKeepTogetherGroupScaleToPage({
      width: pdfPoints(900),
      height: pdfPoints(1_200),
    });

    expect(scale).toBeLessThan(1);
    expect(900 * scale).toBeLessThanOrEqual(
      PDF_VISUAL_CONTRACT.page.contentWidth,
    );
    expect(1_200 * scale).toBeLessThanOrEqual(
      PDF_VISUAL_CONTRACT.page.contentHeight,
    );
  });

  it.each([
    { width: pdfPoints(0), height: pdfPoints(100) },
    { width: pdfPoints(100), height: pdfPoints(Number.NaN) },
    { width: pdfPoints(100), height: pdfPoints(-1) },
  ])("rejects invalid dimensions explicitly: %o", (size) => {
    expect(() => fitKeepTogetherGroupScaleToPage(size)).toThrow(
      new PdfVisualContractError(
        "INVALID_DIMENSION",
        "Keep-together group width and height must be finite positive PDF points.",
      ),
    );
  });
});
