import { describe, expect, it } from "vitest";
import { contentSize, DEFAULT_PAGE_GEOMETRY } from "./geometry";
import { layoutPlan, referenceImageSlots, slotCaptionSplit, TITLE_BAND } from "./engine";
import type { PlanComponent, WidthFraction, ReferenceComponent } from "./models";

const content = contentSize(DEFAULT_PAGE_GEOMETRY);

function plan(id: string, widthFraction: WidthFraction, height: number): PlanComponent {
  return { id, type: "plan", widthFraction, height, html: "" };
}

describe("layoutPlan placement", () => {
  it("places a single full-width component at the origin of page 0", () => {
    const { pageCount, placements } = layoutPlan([plan("a", "1", 100)]);
    expect(pageCount).toBe(1);
    expect(placements).toHaveLength(1);
    expect(placements[0]).toMatchObject({ componentId: "a", pageIndex: 0 });
    expect(placements[0].rect).toEqual({ x: 0, y: 0, width: content.width, height: 100 });
  });

  it("flows two half-width components side by side on one row", () => {
    const { placements } = layoutPlan([plan("a", "1/2", 100), plan("b", "1/2", 120)]);
    expect(placements[0].rect).toMatchObject({ x: 0, y: 0, width: content.width / 2 });
    expect(placements[1].rect).toMatchObject({ x: content.width / 2, y: 0, width: content.width / 2 });
  });

  it("wraps to the next row when the next component does not fit the row", () => {
    const third = content.width / 3;
    const [a, b, c] = layoutPlan([
      plan("a", "2/3", 100),
      plan("b", "1/2", 100),
      plan("c", "1/3", 100),
    ]).placements;
    expect(a.rect).toMatchObject({ x: 0, y: 0 });
    // b (1/2) does not fit next to a (2/3): 2/3 + 1/2 > 1 -> new row
    expect(b.rect.x).toBe(0);
    expect(b.rect.y).toBeCloseTo(100 + DEFAULT_PAGE_GEOMETRY.rowGap, 5);
    // c (1/3) fits next to b (1/2) on the same row
    expect(c.rect.y).toBeCloseTo(b.rect.y, 5);
    expect(c.rect.x).toBeCloseTo(content.width / 2, 5);
    expect(third).toBeGreaterThan(0);
  });

  it("moves a component wholly to the next page when the page is full", () => {
    const tall = content.height - 20; // nearly a full page
    const { pageCount, placements } = layoutPlan([plan("a", "1", tall), plan("b", "1", 100)]);
    expect(pageCount).toBe(2);
    expect(placements[0]).toMatchObject({ pageIndex: 0 });
    expect(placements[1]).toMatchObject({ pageIndex: 1 });
    expect(placements[1].rect).toEqual({ x: 0, y: 0, width: content.width, height: 100 });
  });

  it("clamps a component taller than a page to the page content height", () => {
    const { pageCount, placements } = layoutPlan([plan("a", "1", content.height + 500)]);
    expect(pageCount).toBe(1);
    expect(placements[0].rect.height).toBeCloseTo(content.height, 5);
  });

  it("returns one empty page for no components", () => {
    expect(layoutPlan([])).toEqual({ pageCount: 1, placements: [] });
  });
});

function reference(overrides: Partial<ReferenceComponent> = {}): ReferenceComponent {
  return {
    id: "r",
    type: "reference",
    widthFraction: "1",
    height: 300,
    title: "T",
    description: "",
    columnsPerRow: 3,
    showCaptions: false,
    images: [
      { id: "i1", file: "references/0001.png" },
      { id: "i2", file: "references/0002.png" },
      { id: "i3", file: "references/0003.png" },
      { id: "i4", file: "references/0004.png" },
    ],
    ...overrides,
  };
}

describe("reference image slots", () => {
  it("lays out square slots row-major below the title band", () => {
    const rect = { x: 0, y: 0, width: 300, height: 300 };
    const slots = referenceImageSlots(rect, reference());
    expect(slots).toHaveLength(4);
    // three columns on the first row, all at the same y (>= title band)
    expect(slots[0].y).toBeGreaterThanOrEqual(TITLE_BAND);
    expect(slots[0].y).toBe(slots[1].y);
    expect(slots[1].x).toBeGreaterThan(slots[0].x);
    expect(slots[0].width).toBeCloseTo(slots[0].height, 5); // square when captions off
    // fourth image wraps to the next row
    expect(slots[3].x).toBe(slots[0].x);
    expect(slots[3].y).toBeGreaterThan(slots[0].y);
  });

  it("adds a caption band to each tile when captions are on", () => {
    const rect = { x: 0, y: 0, width: 300, height: 400 };
    const slots = referenceImageSlots(rect, reference({ showCaptions: true }));
    const { image, caption } = slotCaptionSplit(slots[0], true);
    expect(caption.height).toBeCloseTo(slots[0].height - image.height, 5);
    expect(caption.height).toBeGreaterThan(0);
    expect(image.width).toBe(slots[0].width);
    expect(caption.y).toBeCloseTo(image.y + image.height, 5);
  });

  it("returns the whole slot as the image when captions are off", () => {
    const slot = { x: 1, y: 2, width: 10, height: 10 };
    expect(slotCaptionSplit(slot, false)).toEqual({ image: slot, caption: { x: 1, y: 12, width: 10, height: 0 } });
  });

  it("splits a square slot so the image portion is larger and ~square when captions are on", () => {
    // For a tile with slotSize width, when captions are on, referenceImageSlots makes
    // the tile height = round(slotSize*4/3), then slotCaptionSplit gives caption ~1/4
    // of that tile height, so the image portion gets ~3/4 and stays ~square.
    const slotSize = 120;
    const tileHeight = Math.round((slotSize * 4) / 3); // 160
    const slot = { x: 0, y: 0, width: slotSize, height: tileHeight };
    const { image, caption } = slotCaptionSplit(slot, true);
    // Caption reserves ~1/4 of the tile height; image gets the rest
    expect(caption.height).toBeGreaterThan(0);
    expect(image.height).toBeGreaterThan(caption.height); // image is the dominant band
    expect(image.height + caption.height).toBe(slot.height); // bands fill the slot
    // Caption band starts directly below the image band
    expect(caption.y).toBe(image.y + image.height);
    expect(caption.x).toBe(image.x);
    expect(caption.width).toBe(image.width);
    // With tile height = slotSize*4/3 and caption = round(height/4),
    // image height should be ~slotSize (stays ~square with width)
    expect(Math.abs(image.width - image.height)).toBeLessThanOrEqual(1);
  });

  it("populates imageSlots on reference placements via layoutPlan", () => {
    const result = layoutPlan([reference()]);
    expect(result.placements[0].imageSlots).toBeDefined();
    expect(result.placements[0].imageSlots).toHaveLength(4);
  });

  it("fits all slots inside the gutter-inset content box (no horizontal overflow)", () => {
    const rect = { x: 0, y: 0, width: 300, height: 300 };
    const slots = referenceImageSlots(rect, reference());
    // The rightmost slot's right edge must not exceed the content width (rect.width - gutter)
    const contentWidth = rect.width - DEFAULT_PAGE_GEOMETRY.gutter;
    const maxRight = Math.max(...slots.map((slot) => slot.x + slot.width));
    expect(maxRight).toBeLessThanOrEqual(contentWidth);
  });
});
