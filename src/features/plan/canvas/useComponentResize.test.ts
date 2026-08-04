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

  describe("incremental drag moves (no compounding)", () => {
    it("computes width correctly with growing cumulative deltas from same committed base", () => {
      const committedWidth = 1.0; // full width
      const committedHeight = 200;
      const currentWidthPoints = contentWidth * committedWidth; // 500

      // Simulate incremental pointer moves with cumulative dx: 10, 30, 60
      // Each call should base off the SAME committed width, not compound
      const moves = [
        { dxPoints: 10, expectedWidth: (currentWidthPoints + 10) / contentWidth }, // 510/500 = 1.02 → clamped to 1.0
        { dxPoints: 30, expectedWidth: (currentWidthPoints + 30) / contentWidth }, // 530/500 = 1.06 → clamped to 1.0
        { dxPoints: 60, expectedWidth: (currentWidthPoints + 60) / contentWidth }, // 560/500 = 1.12 → clamped to 1.0
      ];

      for (const move of moves) {
        const result = resizeFromDrag({
          width: committedWidth, // ALWAYS the committed base
          height: committedHeight,
          edge: "width",
          dxPoints: move.dxPoints, // cumulative delta from pointer-down
          dyPoints: 0,
          currentWidthPoints, // recalculated from committedWidth each time
          contentWidth,
        });

        // Width should NOT compound; each call bases off committedWidth + cumulative delta
        expect(result.width).toBeCloseTo(Math.min(move.expectedWidth, 1.0), 5);
      }
    });

    it("does not overshoot when dragging right multiple times", () => {
      const committedWidth = 0.5;
      const committedHeight = 200;
      const currentWidthPoints = contentWidth * committedWidth; // 250

      // First move: dx = 50
      let result = resizeFromDrag({
        width: committedWidth,
        height: committedHeight,
        edge: "width",
        dxPoints: 50,
        dyPoints: 0,
        currentWidthPoints,
        contentWidth,
      });
      expect(result.width).toBeCloseTo((250 + 50) / 500, 5); // 0.6

      // Second move: cumulative dx = 100 (from same committedWidth base)
      result = resizeFromDrag({
        width: committedWidth,
        height: committedHeight,
        edge: "width",
        dxPoints: 100,
        dyPoints: 0,
        currentWidthPoints,
        contentWidth,
      });
      expect(result.width).toBeCloseTo((250 + 100) / 500, 5); // 0.7 (NOT 0.6 + 0.1 = 0.7 compounded)
    });
  });
});
