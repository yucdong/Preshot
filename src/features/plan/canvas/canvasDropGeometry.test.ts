import { describe, expect, it } from "vitest";
import { insertAfterFromRects } from "./canvasDropGeometry";

describe("insertAfterFromRects", () => {
  it("returns false when the active center is left of the over center", () => {
    const activeRect = { top: 200, left: 50, width: 200, height: 80 };
    const overRect = { top: 200, left: 300, width: 200, height: 80 };

    expect(insertAfterFromRects(activeRect, overRect)).toBe(false);
  });

  it("returns true when the active center is right of the over center in the same row", () => {
    const activeRect = { top: 200, left: 550, width: 200, height: 80 };
    const overRect = { top: 200, left: 300, width: 200, height: 80 };

    expect(insertAfterFromRects(activeRect, overRect)).toBe(true);
  });

  it("returns false when active center is exactly at over center", () => {
    const activeRect = { top: 200, left: 100, width: 200, height: 80 };
    const overRect = { top: 200, left: 100, width: 200, height: 80 };

    expect(insertAfterFromRects(activeRect, overRect)).toBe(false);
  });

  it("uses horizontal centers when components have different widths", () => {
    const activeRect = { top: 200, left: 480, width: 80, height: 120 };
    const overRect = { top: 200, left: 200, width: 200, height: 60 };

    expect(insertAfterFromRects(activeRect, overRect)).toBe(true);
  });
});
