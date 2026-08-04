import { describe, expect, it } from "vitest";
import { resizeFromDrag } from "./useComponentResize";

describe("resizeFromDrag", () => {
  const contentWidth = 500; // points

  describe("width edge", () => {
    it("returns clamped continuous width", () => {
      const result = resizeFromDrag({
        width: 0.5,
        height: 200,
        edge: "width",
        dxPoints: 100,
        dyPoints: 0,
        currentWidthPoints: 250,
        contentWidth,
      });
      // currentWidth + dx = 250 + 100 = 350
      // 350 / 500 = 0.7
      expect(result.width).toBeCloseTo(0.7, 5);
      expect(result.height).toBeUndefined();
    });

    it("returns full width when dragged wide", () => {
      const result = resizeFromDrag({
        width: 0.5,
        height: 200,
        edge: "width",
        dxPoints: 250,
        dyPoints: 0,
        currentWidthPoints: 250,
        contentWidth,
      });
      // currentWidth + dx = 250 + 250 = 500
      // 500 / 500 = 1.0
      expect(result.width).toBe(1);
      expect(result.height).toBeUndefined();
    });

    it("clamps to MIN_WIDTH when dragged narrow", () => {
      const result = resizeFromDrag({
        width: 0.5,
        height: 200,
        edge: "width",
        dxPoints: -240,
        dyPoints: 0,
        currentWidthPoints: 250,
        contentWidth,
      });
      // currentWidth + dx = 250 - 240 = 10
      // 10 / 500 = 0.02 → clamps to MIN_WIDTH (0.15)
      expect(result.width).toBe(0.15);
      expect(result.height).toBeUndefined();
    });

    it("ignores dyPoints when resizing width only", () => {
      const result = resizeFromDrag({
        width: 0.5,
        height: 200,
        edge: "width",
        dxPoints: 0,
        dyPoints: 50,
        currentWidthPoints: 250,
        contentWidth,
      });
      // No width change: 250 / 500 = 0.5
      expect(result.width).toBe(0.5);
      expect(result.height).toBeUndefined();
    });
  });

  describe("height edge", () => {
    it("adds dyPoints to current height", () => {
      const result = resizeFromDrag({
        width: 0.5,
        height: 200,
        edge: "height",
        dxPoints: 0,
        dyPoints: 50,
        currentWidthPoints: 250,
        contentWidth,
      });
      expect(result.width).toBeUndefined();
      expect(result.height).toBe(250);
    });

    it("handles negative delta (shrinking)", () => {
      const result = resizeFromDrag({
        width: 0.5,
        height: 200,
        edge: "height",
        dxPoints: 0,
        dyPoints: -50,
        currentWidthPoints: 250,
        contentWidth,
      });
      expect(result.width).toBeUndefined();
      expect(result.height).toBe(150);
    });

    it("ignores dxPoints when resizing height only", () => {
      const result = resizeFromDrag({
        width: 0.5,
        height: 200,
        edge: "height",
        dxPoints: 100,
        dyPoints: 0,
        currentWidthPoints: 250,
        contentWidth,
      });
      expect(result.width).toBeUndefined();
      expect(result.height).toBe(200);
    });
  });

  describe("both edges", () => {
    it("resizes both width and height", () => {
      const result = resizeFromDrag({
        width: 0.5,
        height: 200,
        edge: "both",
        dxPoints: 100,
        dyPoints: 50,
        currentWidthPoints: 250,
        contentWidth,
      });
      // Width: 250 + 100 = 350 / 500 = 0.7
      // Height: 200 + 50 = 250
      expect(result.width).toBeCloseTo(0.7, 5);
      expect(result.height).toBe(250);
    });

    it("handles negative deltas on both edges", () => {
      const result = resizeFromDrag({
        width: 0.667,
        height: 300,
        edge: "both",
        dxPoints: -100,
        dyPoints: -80,
        currentWidthPoints: 333,
        contentWidth,
      });
      // Width: 333 - 100 = 233 / 500 = 0.466
      // Height: 300 - 80 = 220
      expect(result.width).toBeCloseTo(0.466, 3);
      expect(result.height).toBe(220);
    });
  });
});
