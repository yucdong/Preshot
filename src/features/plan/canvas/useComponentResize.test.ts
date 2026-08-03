import { describe, expect, it } from "vitest";
import { resizeFromDrag } from "./useComponentResize";

describe("resizeFromDrag", () => {
  const contentWidth = 500; // points

  describe("width edge", () => {
    it("snaps to the nearest width fraction", () => {
      const result = resizeFromDrag({
        widthFraction: "1/2",
        height: 200,
        edge: "width",
        dxPoints: 100,
        dyPoints: 0,
        currentWidthPoints: 250,
        contentWidth,
      });
      // currentWidth + dx = 250 + 100 = 350
      // 350 / 500 = 0.7 → snaps to 2/3 (0.666...)
      expect(result.widthFraction).toBe("2/3");
      expect(result.height).toBeUndefined();
    });

    it("snaps to full width when dragged wide", () => {
      const result = resizeFromDrag({
        widthFraction: "1/2",
        height: 200,
        edge: "width",
        dxPoints: 250,
        dyPoints: 0,
        currentWidthPoints: 250,
        contentWidth,
      });
      // currentWidth + dx = 250 + 250 = 500
      // 500 / 500 = 1.0 → snaps to "1"
      expect(result.widthFraction).toBe("1");
      expect(result.height).toBeUndefined();
    });

    it("snaps to 1/4 when dragged narrow", () => {
      const result = resizeFromDrag({
        widthFraction: "1/2",
        height: 200,
        edge: "width",
        dxPoints: -150,
        dyPoints: 0,
        currentWidthPoints: 250,
        contentWidth,
      });
      // currentWidth + dx = 250 - 150 = 100
      // 100 / 500 = 0.2 → snaps to 1/4 (0.25)
      expect(result.widthFraction).toBe("1/4");
      expect(result.height).toBeUndefined();
    });

    it("ignores dyPoints when resizing width only", () => {
      const result = resizeFromDrag({
        widthFraction: "1/2",
        height: 200,
        edge: "width",
        dxPoints: 0,
        dyPoints: 50,
        currentWidthPoints: 250,
        contentWidth,
      });
      // No width change: 250 / 500 = 0.5 → snaps to 1/2
      expect(result.widthFraction).toBe("1/2");
      expect(result.height).toBeUndefined();
    });
  });

  describe("height edge", () => {
    it("adds dyPoints to current height", () => {
      const result = resizeFromDrag({
        widthFraction: "1/2",
        height: 200,
        edge: "height",
        dxPoints: 0,
        dyPoints: 50,
        currentWidthPoints: 250,
        contentWidth,
      });
      expect(result.widthFraction).toBeUndefined();
      expect(result.height).toBe(250);
    });

    it("handles negative delta (shrinking)", () => {
      const result = resizeFromDrag({
        widthFraction: "1/2",
        height: 200,
        edge: "height",
        dxPoints: 0,
        dyPoints: -50,
        currentWidthPoints: 250,
        contentWidth,
      });
      expect(result.widthFraction).toBeUndefined();
      expect(result.height).toBe(150);
    });

    it("ignores dxPoints when resizing height only", () => {
      const result = resizeFromDrag({
        widthFraction: "1/2",
        height: 200,
        edge: "height",
        dxPoints: 100,
        dyPoints: 0,
        currentWidthPoints: 250,
        contentWidth,
      });
      expect(result.widthFraction).toBeUndefined();
      expect(result.height).toBe(200);
    });
  });

  describe("both edges", () => {
    it("resizes both width and height", () => {
      const result = resizeFromDrag({
        widthFraction: "1/2",
        height: 200,
        edge: "both",
        dxPoints: 100,
        dyPoints: 50,
        currentWidthPoints: 250,
        contentWidth,
      });
      // Width: 250 + 100 = 350 / 500 = 0.7 → snaps to 2/3
      // Height: 200 + 50 = 250
      expect(result.widthFraction).toBe("2/3");
      expect(result.height).toBe(250);
    });

    it("handles negative deltas on both edges", () => {
      const result = resizeFromDrag({
        widthFraction: "2/3",
        height: 300,
        edge: "both",
        dxPoints: -100,
        dyPoints: -80,
        currentWidthPoints: 333,
        contentWidth,
      });
      // Width: 333 - 100 = 233 / 500 = 0.466 → snaps to 1/2 (0.5)
      // Height: 300 - 80 = 220
      expect(result.widthFraction).toBe("1/2");
      expect(result.height).toBe(220);
    });
  });
});
