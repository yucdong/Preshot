import { describe, expect, it } from "vitest";
import type { Rect } from "../../domain/plan/canvas/geometry";
import { slotToPageRect } from "./slotPageRect";

describe("slotToPageRect", () => {
  it("converts top-down component coordinates to y-up page coordinates", () => {
    // Content area in page coordinates (y-up)
    const contentRect: Rect = { x: 100, y: 200, width: 400, height: 600 };

    // Two image boxes in component coordinates (y-down): row 0 at y=24, row 1 below
    const tileHeight = 120;
    const gap = 10;
    const row0Box: Rect = { x: 10, y: 24, width: 100, height: tileHeight };
    const row1Box: Rect = { x: 10, y: 24 + tileHeight + gap, width: 100, height: tileHeight };

    const row0Page = slotToPageRect(contentRect, row0Box);
    const row1Page = slotToPageRect(contentRect, row1Box);

    // (a) Row 0 should map to a GREATER y-up value than row 1 (row 0 is higher on the page)
    expect(row0Page.y).toBeGreaterThan(row1Page.y);

    // (b) Row 0's top (rect.y + rect.height) should be at or below the content top (contentRect.y + contentRect.height)
    const row0Top = row0Page.y + row0Page.height;
    const contentTop = contentRect.y + contentRect.height;
    expect(row0Top).toBeLessThanOrEqual(contentTop);

    // (c) The two mapped boxes should not overlap
    // Row 0 bottom: row0Page.y
    // Row 1 top: row1Page.y + row1Page.height
    // For non-overlap: row1 top <= row0 bottom
    const row1Top = row1Page.y + row1Page.height;
    expect(row1Top).toBeLessThanOrEqual(row0Page.y);
  });

  it("preserves x-coordinate and dimensions", () => {
    const contentRect: Rect = { x: 50, y: 100, width: 300, height: 400 };
    const box: Rect = { x: 20, y: 15, width: 80, height: 60 };

    const result = slotToPageRect(contentRect, box);

    expect(result.x).toBe(contentRect.x + box.x); // 70
    expect(result.width).toBe(box.width);
    expect(result.height).toBe(box.height);
  });

  it("maps y=0 component box to content top", () => {
    const contentRect: Rect = { x: 0, y: 100, width: 400, height: 600 };
    const topBox: Rect = { x: 0, y: 0, width: 100, height: 50 };

    const result = slotToPageRect(contentRect, topBox);

    // Top of component (y=0) should map to top of content area (y + height)
    const resultTop = result.y + result.height;
    const contentTop = contentRect.y + contentRect.height;
    expect(resultTop).toBe(contentTop);
  });
});
