import { describe, expect, it } from "vitest";
import { A4, containSize, contentBox, MARGIN, squareSlotGrid } from "./geometry";

describe("pdf geometry", () => {
  it("computes the A4 content box inside the margins", () => {
    const box = contentBox();
    expect(box).toEqual({
      x: MARGIN,
      y: MARGIN,
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
    expect(grid.xOffsets[2]).toBeCloseTo(2 * (grid.slotSize + 10), 5);
  });

  it("contain-fits and centers landscape, portrait, and square images", () => {
    expect(containSize(100, 200, 100)).toEqual({ width: 100, height: 50, offsetX: 0, offsetY: 25 });
    expect(containSize(100, 100, 200)).toEqual({ width: 50, height: 100, offsetX: 25, offsetY: 0 });
    expect(containSize(100, 100, 100)).toEqual({ width: 100, height: 100, offsetX: 0, offsetY: 0 });
  });
});
