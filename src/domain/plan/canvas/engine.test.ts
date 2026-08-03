import { describe, expect, it } from "vitest";
import { contentSize, DEFAULT_PAGE_GEOMETRY } from "./geometry";
import { layoutPlan } from "./engine";
import type { PlanComponent, WidthFraction } from "./models";

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
