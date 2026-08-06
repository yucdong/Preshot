import { describe, expect, it } from "vitest";
import { componentFrameChromeHeight, DEFAULT_PAGE_GEOMETRY } from "../geometry";
import { layoutPlan } from "../engine";
import {
  DOCUMENT_TITLE_HEIGHT,
  type PlanComponent,
  type PlanTextComponent,
  type ReferenceComponent,
} from "../models";
import { buildCanvasLayout, PDF_COMPONENT_FRAME_CHROME } from "./exportDocument";

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
      rowId: `row:${"c1"}`,
      name: "文案1",
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
      rect: { x: 0, y: DOCUMENT_TITLE_HEIGHT + DEFAULT_PAGE_GEOMETRY.rowGap },
    });
  });

  it("returns multiple placements for components on same page", () => {
    const c1: PlanTextComponent = {
      id: "c1",
      rowId: `row:${"c1"}`,
      name: "文案1",
      type: "plan",
      width: 0.5,
      html: "<p>Left</p>",
    };
    const c2: PlanTextComponent = {
      id: "c2",
      rowId: `row:${"c2"}`,
      name: "文案1",
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
      { id: "c1", rowId: `row:${"c1"}`, name: "文案1", type: "plan", width: 1, html: "<p>Page 1A</p>" },
      { id: "c2", rowId: `row:${"c2"}`, name: "文案1", type: "plan", width: 1, html: "<p>Page 1B</p>" },
      { id: "c3", rowId: `row:${"c3"}`, name: "文案1", type: "plan", width: 1, html: "<p>Page 1C</p>" },
      { id: "c4", rowId: `row:${"c4"}`, name: "文案1", type: "plan", width: 1, html: "<p>Page 2</p>" },
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
      rowId: `row:${"r1"}`,
      type: "reference",
      width: 1,
      name: "Reference",
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
    expect(layout.placements[0].imageSlots?.map((slot) => slot.id)).toEqual([
      "img1",
      "img2",
    ]);
  });

  it("reserves component-name and non-empty caption bands using cropped image ratios", () => {
    const reference: ReferenceComponent = {
      id: "r1",
      rowId: `row:${"r1"}`,
      type: "reference",
      width: 1,
      name: "图片组1",
      description: "",
      showCaptions: false,
      imageHeight: 135,
      images: [
        {
          id: "img1",
          file: "photo1.jpg",
          caption: "拍摄说明",
          aspectRatio: 1,
          crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
        },
      ],
    };

    const layout = buildCanvasLayout([reference]);
    const [placement] = layout.placements;
    const [slot] = placement.imageSlots ?? [];

    expect(placement.rect.height).toBeGreaterThan(135 + 24);
    expect(slot).toMatchObject({
      width: 67.5,
      imageHeight: 135,
      captionHeight: 45,
    });
  });

  it("preserves a component whose id matches the document-title spacer id", () => {
    const component: PlanTextComponent = {
      id: "__pdf_document_title__",
      rowId: `row:${"__pdf_document_title__"}`,
      name: "文案1",
      type: "plan",
      width: 1,
      html: "<p>Text</p>",
    };

    const layout = buildCanvasLayout(
      [component],
      DEFAULT_PAGE_GEOMETRY,
      measurements({ [component.id]: 96 }),
      "Editorial",
    );

    expect(layout.placements).toEqual([
      expect.objectContaining({ componentId: component.id }),
    ]);
  });

  it("reserves only the document-title band before the first component row", () => {
    const component: PlanTextComponent = {
      id: "c1",
      rowId: "row:c1",
      name: "文案1",
      type: "plan",
      width: 1,
      html: "<p>Text</p>",
    };

    const layout = buildCanvasLayout(
      [component],
      DEFAULT_PAGE_GEOMETRY,
      measurements({ c1: 96 }),
      "Editorial",
    );

    expect(layout.placements[0]).toMatchObject({
      componentId: "c1",
      rect: {
        y: DOCUMENT_TITLE_HEIGHT + DEFAULT_PAGE_GEOMETRY.rowGap,
        height: 96 + componentFrameChromeHeight(PDF_COMPONENT_FRAME_CHROME),
      },
    });
  });

  it("reserves the same title band for an empty PDF title as the screen canvas", () => {
    const component: PlanTextComponent = {
      id: "c1",
      rowId: "row:c1",
      name: "文案1",
      type: "plan",
      width: 1,
      html: "<p>Text</p>",
    };
    const layoutMeasurements = measurements({ c1: 96 });
    const screen = layoutPlan(
      [component],
      DEFAULT_PAGE_GEOMETRY,
      layoutMeasurements,
      { frameChrome: PDF_COMPONENT_FRAME_CHROME, includeDocumentTitle: true },
    );
    const pdf = buildCanvasLayout(
      [component],
      DEFAULT_PAGE_GEOMETRY,
      layoutMeasurements,
      "",
    );

    expect(pdf.placements[0]?.rect.y).toBe(screen.placements[0]?.rect.y);
  });

  it("forwards plan measurements into the domain layout", () => {
    const component: PlanTextComponent = {
      id: "p1",
      rowId: `row:${"p1"}`,
      name: "文案1",
      type: "plan",
      width: 1,
      html: "<p>Measured</p>",
    };

    const layout = buildCanvasLayout([component], DEFAULT_PAGE_GEOMETRY, measurements({ p1: 123 }));

    expect(layout.placements[0].rect.height).toBe(
      123 + componentFrameChromeHeight(PDF_COMPONENT_FRAME_CHROME),
    );
  });

  it("returns continuation fragments for overflowing references", () => {
    const components: PlanComponent[] = [
      {
        id: "r1",
        rowId: `row:${"r1"}`,
        type: "reference",
        width: 1,
        name: "Photos",
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
        rowId: `row:${"r1"}`,
        type: "reference",
        width: 1,
        name: "Photos",
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

  it("excludes the UI add tile so it cannot create an otherwise empty PDF page", () => {
    const reference: ReferenceComponent = {
      id: "r1",
      rowId: `row:${"r1"}`,
      type: "reference",
      width: 1,
      name: "Only image",
      description: "",
      showCaptions: false,
      imageHeight: 100,
      images: [{ id: "img1", file: "1.jpg", aspectRatio: 1 }],
    };
    const geometry = {
      ...DEFAULT_PAGE_GEOMETRY,
      page: { width: 200, height: 226 },
    };

    const layout = buildCanvasLayout([reference], geometry);

    expect(layout.pageCount).toBe(1);
    expect(layout.placements).toHaveLength(1);
    expect(layout.placements[0].imageSlots?.map((slot) => slot.id)).toEqual(["img1"]);
  });

  it("keeps a header-only PDF placement for a reference with no images", () => {
    const reference: ReferenceComponent = {
      id: "r1",
      rowId: `row:${"r1"}`,
      type: "reference",
      width: 1,
      name: "Empty reference",
      description: "",
      showCaptions: false,
      imageHeight: 100,
      images: [],
    };

    const layout = buildCanvasLayout([reference]);

    expect(layout.pageCount).toBe(1);
    expect(layout.placements).toHaveLength(1);
    expect(layout.placements[0]).toMatchObject({
      componentId: "r1",
      kind: "whole",
      pageIndex: 0,
    });
    expect(layout.placements[0].imageSlots).toEqual([]);
  });

  it("respects custom geometry", () => {
    const customGeometry = {
      ...DEFAULT_PAGE_GEOMETRY,
      margin: 24,
      gutter: 8,
    };
    const component: PlanTextComponent = {
      id: "c1",
      rowId: `row:${"c1"}`,
      name: "文案1",
      type: "plan",
      width: 1,
      html: "<p>Text</p>",
    };

    const layout = buildCanvasLayout([component], customGeometry, measurements({ c1: 96 }));

    expect(layout.pageCount).toBe(1);
    expect(layout.placements).toHaveLength(1);
  });
});
