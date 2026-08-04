import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE_GEOMETRY } from "../geometry";
import type { PlanComponent, PlanTextComponent, ReferenceComponent } from "../models";
import { buildCanvasLayout } from "./exportDocument";

describe("buildCanvasLayout", () => {
  it("returns page count 1 and a single placement for one component", () => {
    const component: PlanTextComponent = {
      id: "c1",
      type: "plan",
      width: 1,
      height: 200,
      html: "<p>Text</p>",
    };

    const layout = buildCanvasLayout([component]);

    expect(layout.pageCount).toBe(1);
    expect(layout.placements).toHaveLength(1);
    expect(layout.placements[0]).toMatchObject({
      componentId: "c1",
      pageIndex: 0,
      rect: { x: 0, y: 0 },
    });
  });

  it("returns multiple placements for components on same page", () => {
    const c1: PlanTextComponent = {
      id: "c1",
      type: "plan",
      width: 0.5,
      height: 200,
      html: "<p>Left</p>",
    };
    const c2: PlanTextComponent = {
      id: "c2",
      type: "plan",
      width: 0.5,
      height: 200,
      html: "<p>Right</p>",
    };

    const layout = buildCanvasLayout([c1, c2]);

    expect(layout.pageCount).toBe(1);
    expect(layout.placements).toHaveLength(2);
    expect(layout.placements[0].componentId).toBe("c1");
    expect(layout.placements[0].pageIndex).toBe(0);
    expect(layout.placements[1].componentId).toBe("c2");
    expect(layout.placements[1].pageIndex).toBe(0);
  });

  it("returns multiple pages when components overflow page height", () => {
    const contentHeight = DEFAULT_PAGE_GEOMETRY.page.height - 2 * DEFAULT_PAGE_GEOMETRY.margin;
    const c1: PlanTextComponent = {
      id: "c1",
      type: "plan",
      width: 1,
      height: contentHeight,
      html: "<p>Page 1</p>",
    };
    const c2: PlanTextComponent = {
      id: "c2",
      type: "plan",
      width: 1,
      height: 200,
      html: "<p>Page 2</p>",
    };

    const layout = buildCanvasLayout([c1, c2]);

    expect(layout.pageCount).toBe(2);
    expect(layout.placements[0].pageIndex).toBe(0);
    expect(layout.placements[1].pageIndex).toBe(1);
  });

  it("includes imageSlots for reference components", () => {
    const ref: ReferenceComponent = {
      id: "r1",
      type: "reference",
      width: 1,
      height: 320,
      title: "Reference",
      description: "",
      showCaptions: false, imageHeight: 180, images: [
        { id: "img1", file: "photo1.jpg", aspectRatio: 1 },
        { id: "img2", file: "photo2.jpg", aspectRatio: 1 },
      ],
    };

    const layout = buildCanvasLayout([ref]);

    expect(layout.pageCount).toBe(1);
    expect(layout.placements).toHaveLength(1);
    expect(layout.placements[0].imageSlots).toBeDefined();
    expect(layout.placements[0].imageSlots).toHaveLength(2);
  });

  it("handles multi-page layout with mixed component types", () => {
    const contentHeight = DEFAULT_PAGE_GEOMETRY.page.height - 2 * DEFAULT_PAGE_GEOMETRY.margin;
    const components: PlanComponent[] = [
      {
        id: "p1",
        type: "plan",
        width: 1,
        height: contentHeight - 50,
        html: "<p>Intro</p>",
      },
      {
        id: "r1",
        type: "reference",
        width: 1,
        height: 320,
        title: "Photos",
        description: "Description text",
        showCaptions: true, imageHeight: 180, images: [
          { id: "img1", file: "a.jpg", caption: "Caption A", aspectRatio: 1 },
          { id: "img2", file: "b.jpg", caption: "Caption B", aspectRatio: 1 },
          { id: "img3", file: "c.jpg", aspectRatio: 1 },
        ],
      },
      {
        id: "p2",
        type: "plan",
        width: 0.5,
        height: 200,
        html: "<p>Notes left</p>",
      },
      {
        id: "p3",
        type: "plan",
        width: 0.5,
        height: 200,
        html: "<p>Notes right</p>",
      },
    ];

    const layout = buildCanvasLayout(components);

    expect(layout.pageCount).toBeGreaterThanOrEqual(2);
    expect(layout.placements).toHaveLength(4);
    expect(layout.placements[0].componentId).toBe("p1");
    expect(layout.placements[0].pageIndex).toBe(0);
    expect(layout.placements[1].componentId).toBe("r1");
    expect(layout.placements[1].imageSlots).toHaveLength(3);
  });

  it("respects custom geometry", () => {
    const customGeometry = {
      ...DEFAULT_PAGE_GEOMETRY,
      margin: 24,
      gutter: 8,
    };
    const component: PlanTextComponent = {
      id: "c1",
      type: "plan",
      width: 1,
      height: 200,
      html: "<p>Text</p>",
    };

    const layout = buildCanvasLayout([component], customGeometry);

    expect(layout.pageCount).toBe(1);
    expect(layout.placements).toHaveLength(1);
  });
});
