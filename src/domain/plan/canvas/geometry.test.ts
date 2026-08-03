import { describe, expect, it } from "vitest";
import {
  A4,
  containSize,
  contentSize,
  DEFAULT_PAGE_GEOMETRY,
  MARGIN,
  squareSlotGrid,
} from "./geometry";

describe("canvas geometry", () => {
  it("computes the content size inside the margins", () => {
    expect(contentSize(DEFAULT_PAGE_GEOMETRY)).toEqual({
      width: A4.width - 2 * MARGIN,
      height: A4.height - 2 * MARGIN,
    });
  });

  it("splits a row into equal square slots with gaps", () => {
    const grid = squareSlotGrid(500, 3, 10);
    expect(grid.slotSize).toBeCloseTo((500 - 2 * 10) / 3, 5);
    expect(grid.xOffsets).toHaveLength(3);
    expect(grid.xOffsets[0]).toBe(0);
    expect(grid.xOffsets[1]).toBeCloseTo(grid.slotSize + 10, 5);
  });

  it("contain-fits and centers an image within a rectangular slot", () => {
    // wide slot, square image -> limited by height
    expect(containSize(200, 100, 100, 100)).toEqual({ width: 100, height: 100, offsetX: 50, offsetY: 0 });
    // tall slot, landscape image -> limited by width
    expect(containSize(100, 200, 200, 100)).toEqual({ width: 100, height: 50, offsetX: 0, offsetY: 75 });
  });
});
