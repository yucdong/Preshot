import { describe, expect, it } from "vitest";
import { contentSize, DEFAULT_PAGE_GEOMETRY } from "./geometry";
import type { PlanComponent } from "./models";
import { layoutDocumentFlow } from "./documentFlow";

const content = contentSize(DEFAULT_PAGE_GEOMETRY);

function planComponent(
  id: string,
  rect: { x: number; y: number; width: number; height: number },
): PlanComponent {
  return {
    id,
    name: `文案${id}`,
    type: "plan",
    ...rect,
    html: `<p>${id}</p>`,
  };
}

describe("layoutDocumentFlow", () => {
  it("keeps an empty document as one printable page", () => {
    expect(layoutDocumentFlow([])).toEqual({ pageCount: 1, placements: [] });
  });

  it("places ordered components on separate rows while retaining adjustable width and height", () => {
    const result = layoutDocumentFlow([
      planComponent("a", { x: 40, y: 500, width: 220, height: 100 }),
      planComponent("b", { x: 280, y: 20, width: 180, height: 120 }),
    ]);

    expect(result.placements).toEqual([
      {
        componentId: "a",
        pageIndex: 0,
        rect: { x: 40, y: 60, width: 220, height: 100 },
      },
      {
        componentId: "b",
        pageIndex: 0,
        rect: { x: 280, y: 184, width: 180, height: 120 },
      },
    ]);
  });

  it("moves a whole component to the next A4 page when the current page cannot contain it", () => {
    const result = layoutDocumentFlow([
      planComponent("a", { x: 0, y: 0, width: content.width, height: 300 }),
      planComponent("b", { x: 0, y: 0, width: content.width, height: 300 }),
      planComponent("c", { x: 0, y: 0, width: content.width, height: 200 }),
    ]);

    expect(result.pageCount).toBe(2);
    expect(result.placements[2]).toEqual({
      componentId: "c",
      pageIndex: 1,
      rect: { x: 0, y: 0, width: content.width, height: 200 },
    });
    expect(result.placements.every(({ rect }) => rect.y + rect.height <= content.height)).toBe(true);
  });

  it("keeps compact consecutive reference-height cards on the same page", () => {
    const result = layoutDocumentFlow(
      [
        planComponent("yanan", { x: 0, y: 0, width: content.width, height: 297.77 }),
        planComponent("summer", { x: 0, y: 0, width: content.width, height: 397.38 }),
      ],
      DEFAULT_PAGE_GEOMETRY,
      { includeDocumentTitle: false },
    );

    expect(result.pageCount).toBe(1);
    expect(result.placements.map((placement) => placement.pageIndex)).toEqual([0, 0]);
    expect(result.placements[1].rect.y).toBeCloseTo(297.77 + DEFAULT_PAGE_GEOMETRY.rowGap, 2);
  });

  it("moves the first component to page two when the document title leaves insufficient room", () => {
    const result = layoutDocumentFlow([
      planComponent("a", { x: 0, y: 0, width: content.width, height: 750 }),
    ]);

    expect(result).toMatchObject({
      pageCount: 2,
      placements: [{ componentId: "a", pageIndex: 1, rect: { x: 0, y: 0, height: 750 } }],
    });
  });

  it("rejects an oversized component until overflow normalization splits it", () => {
    expect(() =>
      layoutDocumentFlow([
        planComponent("too-tall", {
          x: 0,
          y: 0,
          width: content.width,
          height: content.height + 1,
        }),
      ]),
    ).toThrow(/must be split before layout/);
  });
});