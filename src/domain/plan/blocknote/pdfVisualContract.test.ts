import { describe, expect, it } from "vitest";
import {
  PDF_VISUAL_CONTRACT,
  PdfVisualContractError,
  calculatePdfColumnWidths,
  editorLogicalUnits,
  fitKeepTogetherGroupScaleToPage,
  pdfPoints,
  scaleColumnEditorLogicalUnits,
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

  it("allocates weighted two-thirds and one-third columns after the gap", () => {
    const widths = calculatePdfColumnWidths([2, 1]);
    const usableWidth =
      PDF_VISUAL_CONTRACT.page.contentWidth -
      PDF_VISUAL_CONTRACT.columns.gap;

    expect(widths[0]).toBeCloseTo(usableWidth * 2 / 3, 4);
    expect(widths[1]).toBeCloseTo(usableWidth / 3, 4);
    expect(
      widths[0] + PDF_VISUAL_CONTRACT.columns.gap + widths[1],
    ).toBe(PDF_VISUAL_CONTRACT.page.contentWidth);
    expect(
      scaleColumnEditorLogicalUnits(
        editorLogicalUnits(200),
        editorLogicalUnits(300),
        widths[0],
      ),
    ).toBeCloseTo(widths[0] * 2 / 3, 4);
  });

  it("keeps rounded column allocation stable and width-conserving", () => {
    const first = calculatePdfColumnWidths([1, 1, 1]);
    const second = calculatePdfColumnWidths([1, 1, 1]);
    const total =
      first.reduce((sum, width) => sum + width, 0) +
      PDF_VISUAL_CONTRACT.columns.gap * 2;

    expect(second).toEqual(first);
    expect(total).toBe(PDF_VISUAL_CONTRACT.page.contentWidth);
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
