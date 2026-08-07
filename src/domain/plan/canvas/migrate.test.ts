import { describe, expect, it } from "vitest";
import { contentSize, DEFAULT_PAGE_GEOMETRY } from "./geometry";
import { migratePlan } from "./migrate";

const context = { projectName: "Editorial" };
const canvasWidth = contentSize(DEFAULT_PAGE_GEOMETRY).width;

describe("migratePlan legacy schemas", () => {
  it("migrates v1 content into v7 cards and image frames", () => {
    const plan = migratePlan(
      {
        photographyPlan: "<p>Shot list</p>",
        referenceGroups: [
          {
            id: "ref",
            title: "Looks",
            description: "Warm",
            images: [{ id: "image", file: "references/look.png" }],
          },
        ],
      },
      context,
    );

    expect(plan).toMatchObject({
      schemaVersion: 7,
      title: "Editorial",
      components: [
        {
          type: "plan",
          x: 0,
          y: 60,
          width: canvasWidth,
          html: "<p>Shot list</p>",
        },
        {
          id: "ref",
          type: "reference",
          x: 0,
          width: canvasWidth,
          description: "Warm",
          images: [{
            id: "image",
            aspectRatio: 1,
            frameWidth: 135,
            frameHeight: 135,
          }],
        },
      ],
    });
  });

  it.each([3, 4, 5])("migrates v%s components through the v6 adapter into v7", (schemaVersion) => {
    const raw = schemaVersion === 5
      ? {
          schemaVersion,
          title: "Editorial",
          components: [{
            id: "plan",
            rowId: "row",
            name: "Plan",
            type: "plan",
            width: 1,
            html: "",
          }],
        }
      : {
          schemaVersion,
          components: [{
            id: "plan",
            type: "plan",
            width: 1,
            ...(schemaVersion === 4 ? { title: "Plan" } : {}),
            html: "",
          }],
        };

    const plan = migratePlan(raw, context);
    expect(plan).toMatchObject({
      schemaVersion: 7,
      components: [{ id: "plan", type: "plan", x: 0, y: 60, width: canvasWidth }],
    });
  });

  it("remaps duplicate v2 logical ids before producing v7", () => {
    const plan = migratePlan(
      {
        schemaVersion: 2,
        components: [
          {
            id: "duplicate",
            type: "reference",
            widthFraction: "1",
            title: "First",
            description: "",
            images: [{ id: "image", file: "references/one.png" }],
          },
          {
            id: "duplicate",
            type: "reference",
            widthFraction: "1",
            title: "Second",
            description: "",
            images: [{ id: "image", file: "references/two.png" }],
          },
        ],
      },
      context,
    );

    expect(plan.components.map((component) => component.id)).toEqual([
      "duplicate",
      "duplicate-2",
    ]);
    expect(
      plan.components.flatMap((component) =>
        component.type === "reference" ? component.images.map((image) => image.id) : [],
      ),
    ).toEqual(["image", "image-2"]);
  });

  it("rejects a future schema instead of modifying it", () => {
    expect(() => migratePlan({ schemaVersion: 8, title: "Future", components: [] }, context)).toThrow(
      /schema version/i,
    );
  });
});
