import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE_GEOMETRY } from "../geometry";
import type { ProjectPlan } from "../models";
import {
  buildCanvasLayout,
  temporaryPagedExportPlan,
} from "./exportDocument";

const plan: ProjectPlan = {
  schemaVersion: 12,
  title: "Editorial",
  components: [
    {
      id: "p1",
      name: "Plan",
      type: "plan",
      x: 0,
      width: 500,
      height: 200,
      contentScale: 0.7,
      textRoot: { kind: "leaf", id: "p1:root", html: "<p>Text</p>" },
    },
    {
      id: "r1",
      name: "Reference",
      type: "reference",
      x: 40,
      width: 500,
      height: 300,
      description: "<p>Details</p>",
      images: [{
        id: "img1",
        file: "photo.jpg",
        caption: "Legacy only",
        aspectRatio: 4 / 3,
        frameWidth: 240,
        frameHeight: 120,
      }],
    },
  ],
};

describe("temporary PDF layout adapter", () => {
  it("adapts v8 components to the retained paged layout input", () => {
    const temporary = temporaryPagedExportPlan(plan);

    expect(temporary).toMatchObject({
      schemaVersion: 6,
      title: "Editorial",
      components: [
        { id: "p1", contentScale: 0.7, width: expect.any(Number) },
        {
          id: "r1",
          showDescription: true,
          imageHeight: 135,
          images: [{
            id: "img1",
            aspectRatio: 2,
            displayHeight: 120,
          }],
        },
      ],
    });
    expect(temporary.components[1]).not.toMatchObject({
      images: [expect.objectContaining({ caption: expect.anything() })],
    });
  });

  it("continues to produce pageable placements without changing v8 component persistence", () => {
    const temporary = temporaryPagedExportPlan(plan);
    const layout = buildCanvasLayout(
      temporary.components,
      DEFAULT_PAGE_GEOMETRY,
      {
        planHeights: new Map([["p1", 96]]),
        referenceDescriptionHeights: new Map([["r1", 20]]),
      },
    );

    expect(layout.pageCount).toBeGreaterThan(0);
    expect(layout.placements.map((placement) => placement.componentId)).toEqual(["p1", "r1"]);
    expect(layout.placements[0].rect.height).toBeCloseTo(96 * 0.7, 5);
    expect(layout.placements[1].rect.x).toBeCloseTo(40, 3);
    expect(layout.placements[1].rect.y).toBeGreaterThan(
      layout.placements[0].rect.y + layout.placements[0].rect.height,
    );
    expect(plan.components[0]).toMatchObject({ x: 0, width: 500, height: 200 });
    expect(plan.components[0]).not.toHaveProperty("y");
  });
});
