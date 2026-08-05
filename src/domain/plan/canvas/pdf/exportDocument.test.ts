import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE_GEOMETRY } from "../geometry";
import type { PlanComponent, PlanTextComponent, ReferenceComponent } from "../models";
import { buildCanvasLayout } from "./exportDocument";

function measurements(planHeights: Record<string, number> = {}) {
  return {
    planHeights: new Map(Object.entries(planHeights)),
    referenceDescriptionHeights: new Map<string, number>(),
  };
}

describe("buildCanvasLayout", () => {
  it("returns page count 1 and a single placement for one component", () => {
    const component: PlanTextComponent = {
      id: "c1",
      type: "plan",
      width: 1,
      html: "<p>Text</p>",
    };

    const layout = buildCanvasLayout([component], DEFAULT_PAGE_GEOMETRY, measurements({ c1: 96 }));

    expect(layout.pageCount).toBe(1);
    expect(layout.placements).toHaveLength(1);
    expect(layout.placements[0]).toMatchObject({
      fragmentId: "c1::0",
      fragmentIndex: 0,
      kind: "whole",
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
      html: "<p>Left</p>",
    };
    const c2: PlanTextComponent = {
      id: "c2",
      type: "plan",
      width: 0.5,
      html: "<p>Right</p>",
    };

    const layout = buildCanvasLayout([c1, c2], DEFAULT_PAGE_GEOMETRY, measurements({ c1: 96, c2: 96 }));

    expect(layout.pageCount).toBe(1);
    expect(layout.placements).toHaveLength(2);
    expect(layout.placements[0].componentId).toBe("c1");
    expect(layout.placements[0].pageIndex).toBe(0);
    expect(layout.placements[1].componentId).toBe("c2");
    expect(layout.placements[1].pageIndex).toBe(0);
  });

  it("returns multiple pages when components overflow page height", () => {
    const components: PlanTextComponent[] = [
      { id: "c1", type: "plan", width: 1, html: "<p>Page 1A</p>" },
      { id: "c2", type: "plan", width: 1, html: "<p>Page 1B</p>" },
      { id: "c3", type: "plan", width: 1, html: "<p>Page 1C</p>" },
      { id: "c4", type: "plan", width: 1, html: "<p>Page 2</p>" },
    ];

    const layout = buildCanvasLayout(components, DEFAULT_PAGE_GEOMETRY, measurements({
      c1: 260,
      c2: 260,
      c3: 260,
      c4: 260,
    }));

    expect(layout.pageCount).toBe(2);
    expect(layout.placements[0].pageIndex).toBe(0);
    expect(layout.placements[3].pageIndex).toBe(1);
  });

  it("includes fragment metadata and slot ids for reference components", () => {
    const ref: ReferenceComponent = {
      id: "r1",
      type: "reference",
      width: 1,
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
    expect(layout.placements[0]).toMatchObject({ fragmentId: "r1::0", fragmentIndex: 0, kind: "whole" });
    expect(layout.placements[0].imageSlots?.map((slot) => slot.id)).toEqual(["img1", "img2", "__add__"]);
  });

  it("forwards plan measurements into the domain layout", () => {
    const component: PlanTextComponent = {
      id: "p1",
      type: "plan",
      width: 1,
      html: "<p>Measured</p>",
    };

    const layout = buildCanvasLayout([component], DEFAULT_PAGE_GEOMETRY, measurements({ p1: 123 }));

    expect(layout.placements[0].rect.height).toBe(123);
  });

  it("returns continuation fragments for overflowing references", () => {
    const components: PlanComponent[] = [
      {
        id: "r1",
        type: "reference",
        width: 1,
        title: "Photos",
        description: "",
        showCaptions: false,
        imageHeight: 180,
        images: Array.from({ length: 12 }, (_, index) => ({
          id: `img${index + 1}`,
          file: `${index + 1}.jpg`,
          aspectRatio: 1,
        })),
      },
    ];
    const geometry = {
      ...DEFAULT_PAGE_GEOMETRY,
      page: { ...DEFAULT_PAGE_GEOMETRY.page, height: 540 },
    };

    const layout = buildCanvasLayout(components, geometry);
    const fragments = layout.placements.filter((placement) => placement.componentId === "r1");

    expect(layout.pageCount).toBeGreaterThan(1);
    expect(fragments).toHaveLength(layout.pageCount);
    expect(fragments[0]).toMatchObject({ fragmentId: "r1::0", kind: "first", pageIndex: 0 });
    expect(fragments[1]).toMatchObject({ fragmentId: "r1::1", kind: "continuation", pageIndex: 1 });
  });

  it("keeps continuation fragment slots aligned to later image ids", () => {
    const components: PlanComponent[] = [
      {
        id: "r1",
        type: "reference",
        width: 1,
        title: "Photos",
        description: "",
        showCaptions: false,
        imageHeight: 135,
        images: [
          { id: "img1", file: "1.jpg", aspectRatio: 4 / 3 },
          { id: "img2", file: "2.jpg", aspectRatio: 4 / 3 },
          { id: "img3", file: "3.jpg", aspectRatio: 4 / 3 },
          { id: "img4", file: "4.jpg", aspectRatio: 4 / 3 },
          { id: "img5", file: "5.jpg", aspectRatio: 3 / 4 },
          { id: "img6", file: "6.jpg", aspectRatio: 3 / 4 },
          { id: "img7", file: "7.jpg", aspectRatio: 3 / 4 },
          { id: "img8", file: "8.jpg", aspectRatio: 3 / 4 },
          { id: "img9", file: "9.jpg", aspectRatio: 3 / 4 },
          { id: "img10", file: "10.jpg", aspectRatio: 3 / 4 },
          { id: "img11", file: "11.jpg", aspectRatio: 3 / 4 },
          { id: "img12", file: "12.jpg", aspectRatio: 3 / 4 },
        ],
      },
    ];
    const geometry = {
      ...DEFAULT_PAGE_GEOMETRY,
      page: { ...DEFAULT_PAGE_GEOMETRY.page, height: 540 },
    };

    const [reference] = components;
    if (reference.type !== "reference") {
      throw new Error("expected reference component");
    }

    const layout = buildCanvasLayout(components, geometry);
    const fragments = layout.placements.filter((placement) => placement.componentId === "r1");
    const imageSlotIds = fragments.map((placement) =>
      placement.imageSlots?.filter((slot) => slot.kind === "image").map((slot) => slot.id) ?? [],
    );

    expect(fragments).toHaveLength(2);
    expect(imageSlotIds[0]).toEqual(["img1", "img2", "img3", "img4", "img5"]);
    expect(imageSlotIds[1]).toEqual(["img6", "img7", "img8", "img9", "img10", "img11", "img12"]);
    expect(imageSlotIds.flat()).toEqual(reference.images.map((image) => image.id));
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
      html: "<p>Text</p>",
    };

    const layout = buildCanvasLayout([component], customGeometry, measurements({ c1: 96 }));

    expect(layout.pageCount).toBe(1);
    expect(layout.placements).toHaveLength(1);
  });
});
