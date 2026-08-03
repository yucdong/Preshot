import { describe, expect, it } from "vitest";
import { insertAfterFromRects } from "./canvasDropGeometry";

describe("insertAfterFromRects", () => {
  it("returns false when active center is before over center (vertical)", () => {
    const activeRect = { top: 100, left: 50, width: 200, height: 80 };
    const overRect = { top: 200, left: 50, width: 200, height: 80 };
    // Active center Y: 100 + 40 = 140
    // Over center Y: 200 + 40 = 240
    // 140 < 240, so insertAfter = false
    expect(insertAfterFromRects(activeRect, overRect)).toBe(false);
  });

  it("returns true when active center is past over center (vertical)", () => {
    const activeRect = { top: 250, left: 50, width: 200, height: 80 };
    const overRect = { top: 200, left: 50, width: 200, height: 80 };
    // Active center Y: 250 + 40 = 290
    // Over center Y: 200 + 40 = 240
    // 290 > 240, so insertAfter = true
    expect(insertAfterFromRects(activeRect, overRect)).toBe(true);
  });

  it("returns false when active center is exactly at over center", () => {
    const activeRect = { top: 200, left: 50, width: 200, height: 80 };
    const overRect = { top: 200, left: 100, width: 200, height: 80 };
    // Active center Y: 200 + 40 = 240
    // Over center Y: 200 + 40 = 240
    // 240 === 240, so insertAfter = false (not past)
    expect(insertAfterFromRects(activeRect, overRect)).toBe(false);
  });

  it("handles different heights correctly", () => {
    const activeRect = { top: 100, left: 50, width: 200, height: 120 };
    const overRect = { top: 200, left: 50, width: 200, height: 60 };
    // Active center Y: 100 + 60 = 160
    // Over center Y: 200 + 30 = 230
    // 160 < 230, so insertAfter = false
    expect(insertAfterFromRects(activeRect, overRect)).toBe(false);
  });

  it("returns true when dragging component down", () => {
    const activeRect = { top: 300, left: 50, width: 200, height: 100 };
    const overRect = { top: 200, left: 50, width: 200, height: 100 };
    // Active center Y: 300 + 50 = 350
    // Over center Y: 200 + 50 = 250
    // 350 > 250, so insertAfter = true (dragging down)
    expect(insertAfterFromRects(activeRect, overRect)).toBe(true);
  });
});
