import { describe, expect, it } from "vitest";
import {
  A4,
  containSize,
  contentSize,
  DEFAULT_PAGE_GEOMETRY,
  packAspectRow,
  SPACING,
  squareSlotGrid,
} from "./geometry";

describe("canvas geometry", () => {
  it("computes the content size inside the margins", () => {
    expect(contentSize(DEFAULT_PAGE_GEOMETRY)).toEqual({
      width: A4.width - 2 * SPACING,
      height: A4.height - 2 * SPACING,
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

  it("containSize handles zero/negative image dimensions without division by zero", () => {
    expect(containSize(100, 100, 0, 0)).toEqual({ width: 0, height: 0, offsetX: 50, offsetY: 50 });
  });

  it("packs a single row when items fit", () => {
    // two 2:1 items at height 100 => width 200 each; gap 10; maxWidth 500 => fit one row
    const { rects, totalHeight } = packAspectRow(
      [{ aspectRatio: 2 }, { aspectRatio: 2 }], 100, 500, 10);
    expect(rects.map((r) => Math.round(r.width))).toEqual([200, 200]);
    expect(rects[0]).toMatchObject({ x: 0, y: 0, height: 100 });
    expect(Math.round(rects[1].x)).toBe(210); // 200 + gap
    expect(rects[1].y).toBe(0);
    expect(totalHeight).toBe(100);
  });

  it("wraps to the next row when the next item overflows", () => {
    const { rects, totalHeight } = packAspectRow(
      [{ aspectRatio: 2 }, { aspectRatio: 2 }, { aspectRatio: 2 }], 100, 500, 10);
    expect(rects[2].x).toBe(0);          // wrapped
    expect(rects[2].y).toBe(110);        // height + gap
    expect(totalHeight).toBe(210);
  });

  it("scales an oversized single item down to maxWidth (height drops for that item)", () => {
    const { rects } = packAspectRow([{ aspectRatio: 5 }], 100, 300, 10);
    expect(Math.round(rects[0].width)).toBe(300);
    expect(Math.round(rects[0].height)).toBe(60); // 300 / 5
  });

  it("SPACING is 24", () => { expect(SPACING).toBe(24); });
});
