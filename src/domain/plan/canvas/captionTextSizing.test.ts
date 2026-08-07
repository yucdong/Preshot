import { describe, expect, it } from "vitest";
import { calculateCaptionTextSizing } from "./captionTextSizing";

describe("calculateCaptionTextSizing", () => {
  it("uses the normal font size when a caption fits its available band", () => {
    const sizing = calculateCaptionTextSizing({
      caption: "Palette",
      width: 160,
      imageHeight: 120,
    });

    expect(sizing).toMatchObject({
      fontSize: 9,
      imageHeight: 120,
      lines: ["Palette"],
    });
    expect(sizing.captionHeight).toBeLessThanOrEqual(sizing.totalHeight / 3);
  });

  it("shrinks to five points and grows the image height when needed", () => {
    const sizing = calculateCaptionTextSizing({
      caption: "A caption that needs several wrapped lines",
      width: 24,
      imageHeight: 12,
    });

    expect(sizing.fontSize).toBe(5);
    expect(sizing.imageHeight).toBeGreaterThan(12);
    expect(sizing.captionHeight).toBeLessThanOrEqual(sizing.totalHeight / 3);
  });

  it("does not create a caption band for blank captions", () => {
    expect(
      calculateCaptionTextSizing({
        caption: "  ",
        width: 160,
        imageHeight: 120,
      }),
    ).toMatchObject({ captionHeight: 0, lines: [] });
  });
});
