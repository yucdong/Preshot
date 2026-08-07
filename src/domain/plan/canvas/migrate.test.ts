import { describe, expect, it } from "vitest";
import { migratePlan } from "./migrate";
import { DEFAULT_CONTENT_SCALE, DEFAULT_IMAGE_HEIGHT } from "./models";

const context = { projectName: "Editorial" };

describe("migratePlan legacy schemas", () => {
  it("migrates v1 content to v6 defaults", () => {
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
      schemaVersion: 6,
      title: "Editorial",
      components: [
        {
          type: "plan",
          contentScale: DEFAULT_CONTENT_SCALE,
          html: "<p>Shot list</p>",
        },
        {
          id: "ref",
          type: "reference",
          contentScale: DEFAULT_CONTENT_SCALE,
          showDescription: true,
          imageHeight: DEFAULT_IMAGE_HEIGHT,
          images: [{ id: "image", aspectRatio: 1 }],
        },
      ],
    });
  });

  it.each([3, 4])("migrates v%s components to v6 without persisted rows", (schemaVersion) => {
    const plan = migratePlan(
      {
        schemaVersion,
        components: [
          { id: "plan", type: "plan", width: 1, html: "" },
          {
            id: "reference",
            type: "reference",
            width: 1,
            title: "Looks",
            description: "Details",
            showCaptions: false,
            imageHeight: 180,
            images: [],
          },
        ],
      },
      context,
    );

    expect(plan.components).toEqual([
      {
        id: "plan",
        name: "文案1",
        type: "plan",
        width: 1,
        contentScale: 1,
        html: "",
      },
      {
        id: "reference",
        name: "Looks",
        type: "reference",
        width: 1,
        contentScale: 1,
        description: "Details",
        showDescription: true,
        imageHeight: schemaVersion === 3 ? 135 : 180,
        images: [],
      },
    ]);
  });

  it("remaps duplicate v2 logical ids before producing v6", () => {
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
    expect(() => migratePlan({ schemaVersion: 7, title: "Future", components: [] }, context)).toThrow(
      /schema version/i,
    );
  });
});
