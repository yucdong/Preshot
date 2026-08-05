import { describe, expect, it } from "vitest";
import { resizeFromDrag } from "./useComponentResize";

describe("resizeFromDrag", () => {
  const contentWidth = 500;

  it("returns clamped continuous width", () => {
    const result = resizeFromDrag({
      dxPoints: 100,
      currentWidthPoints: 250,
      contentWidth,
    });

    expect(result.width).toBeCloseTo(0.7, 5);
  });

  it("returns full width when dragged wide", () => {
    const result = resizeFromDrag({
      dxPoints: 250,
      currentWidthPoints: 250,
      contentWidth,
    });

    expect(result.width).toBe(1);
  });

  it("clamps to MIN_WIDTH when dragged narrow", () => {
    const result = resizeFromDrag({
      dxPoints: -240,
      currentWidthPoints: 250,
      contentWidth,
    });

    expect(result.width).toBe(0.15);
  });

  it("does not compound width across incremental drags", () => {
    const currentWidthPoints = 250;

    const first = resizeFromDrag({
      dxPoints: 50,
      currentWidthPoints,
      contentWidth,
    });
    const second = resizeFromDrag({
      dxPoints: 100,
      currentWidthPoints,
      contentWidth,
    });

    expect(first.width).toBeCloseTo(0.6, 5);
    expect(second.width).toBeCloseTo(0.7, 5);
  });
});
