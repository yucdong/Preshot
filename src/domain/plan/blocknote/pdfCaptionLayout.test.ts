import { describe, expect, it } from "vitest";
import {
  fitPdfImageCaptionToPage,
  layoutPdfCaption,
} from "./pdfCaptionLayout";

const measureText = (text: string, fontSize: number): number =>
  Array.from(text).reduce(
    (width, character) =>
      width + (/[\u3000-\u9fff]/u.test(character) ? fontSize : fontSize * 0.5),
    0,
  );

describe("PDF native image caption layout", () => {
  it("wraps CJK and Latin text with the PDF font metrics", () => {
    const input = {
      fontSize: 10,
      lineHeight: 13.5,
      gap: 3,
      measureText,
    };

    expect(layoutPdfCaption("甲乙丙丁", 30, input).lines).toEqual([
      "甲乙丙",
      "丁",
    ]);
    expect(layoutPdfCaption("one two three", 30, input).lines).toEqual([
      "one",
      "two",
      "three",
    ]);
  });

  it("uses a wider caption block for a true 100x1000 image", () => {
    const caption = Array.from(
      { length: 80 },
      (_, index) => `word${index + 1}`,
    ).join(" ");
    const fitted = fitPdfImageCaptionToPage({
      imageWidth: 400,
      imageHeight: 4_000,
      maxWidth: 400,
      captionWidth: 400,
      maxHeight: 793.89,
      blockSpacing: 6,
      caption,
      captionFontSize: 9.35,
      captionLineHeight: 12.6225,
      captionGap: 3,
      measureText,
    });

    expect(fitted.caption.lines.length).toBeGreaterThan(1);
    expect(fitted.captionWidth).toBe(400);
    expect(fitted.captionWidth).toBeGreaterThan(fitted.width);
    expect(fitted.width / fitted.height).toBeCloseTo(0.1, 5);
    expect(fitted.totalHeight).toBeLessThanOrEqual(793.8901);
    expect(
      layoutPdfCaption(caption, fitted.captionWidth, {
        fontSize: 9.35,
        lineHeight: 12.6225,
        gap: 3,
        measureText,
      }).lines,
    ).toEqual(fitted.caption.lines);
  });

  it("reserves only block spacing when there is no caption", () => {
    const fitted = fitPdfImageCaptionToPage({
      imageWidth: 200,
      imageHeight: 2_000,
      maxWidth: 547.28,
      captionWidth: 547.28,
      maxHeight: 793.89,
      blockSpacing: 6,
      caption: "",
      captionFontSize: 9.35,
      captionLineHeight: 12.6225,
      captionGap: 3,
      measureText,
    });

    expect(fitted.caption).toEqual({ lines: [], height: 0 });
    expect(fitted.height + 6).toBeCloseTo(793.89, 5);
    expect(fitted.width / fitted.height).toBeCloseTo(0.1, 5);
  });
});
