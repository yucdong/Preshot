import { describe, expect, it } from "vitest";
import { contentSize, DEFAULT_PAGE_GEOMETRY } from "./geometry";
import { migratePlan } from "./migrate";

const context = { projectName: "Editorial" };
const canvasWidth = contentSize(DEFAULT_PAGE_GEOMETRY).width;

describe("schema v7", () => {
  it("reloads saved v7 card coordinates without changing their order or dimensions", () => {
    const saved = {
      schemaVersion: 7,
      title: "Editorial",
      components: [
        {
          id: "back",
          name: "Back",
          type: "plan",
          x: 20,
          y: 60,
          width: 300,
          height: 140,
          html: "<p>Back</p>",
        },
        {
          id: "front",
          name: "Front",
          type: "plan",
          x: 100,
          y: 240,
          width: 220,
          height: 100,
          html: "<p>Front</p>",
        },
      ],
    };

    expect(migratePlan(saved, context)).toEqual(saved);
  });

  it("migrates v6 positions, image frames, and legacy captions into the continuous canvas", () => {
    const migrated = migratePlan(
      {
        schemaVersion: 6,
        title: "Editorial",
        components: [
          {
            id: "plan",
            name: "Shot list",
            type: "plan",
            width: 1,
            contentScale: 1,
            html: "<p>Golden hour</p>",
          },
          {
            id: "reference",
            name: "Looks",
            type: "reference",
            width: 1,
            contentScale: 1,
            description: "",
            showDescription: true,
            imageHeight: 135,
            images: [
              {
                id: "image",
                file: "references/look.png",
                caption: "Palette",
                aspectRatio: 1.5,
                displayHeight: 99,
              },
            ],
          },
        ],
      },
      context,
    );

    expect(migrated).toMatchObject({
      schemaVersion: 7,
      title: "Editorial",
      components: [
        {
          id: "plan",
          type: "plan",
          x: 0,
          y: 60,
          width: canvasWidth,
          height: 84,
          html: "<p>Golden hour</p>",
        },
        {
          id: "reference",
          type: "reference",
          x: 0,
          width: canvasWidth,
          description: "",
          images: [
            {
              id: "image",
              caption: "Palette",
              aspectRatio: 1.5,
              frameWidth: 148.5,
              frameHeight: 99,
            },
          ],
        },
      ],
    });
  });

  it("stores a single continuous card spanning all v6 reference fragments", () => {
    const migrated = migratePlan(
      {
        schemaVersion: 6,
        title: "Editorial",
        components: [
          {
            id: "reference",
            name: "Looks",
            type: "reference",
            width: 1,
            contentScale: 1,
            description: "",
            showDescription: true,
            imageHeight: 180,
            images: Array.from({ length: 12 }, (_, index) => ({
              id: `image-${index}`,
              file: `references/${index}.png`,
              aspectRatio: 1,
            })),
          },
        ],
      },
      context,
    );

    expect(migrated.components[0]).toMatchObject({
      id: "reference",
      x: 0,
      y: 60,
      width: canvasWidth,
      height: 1349.89,
    });
  });

  it.each([
    [
      "missing card height",
      {
        schemaVersion: 7,
        title: "Editorial",
        components: [{ id: "plan", name: "Plan", type: "plan", x: 0, y: 0, width: 120, html: "" }],
      },
    ],
    [
      "unsupported legacy field",
      {
        schemaVersion: 7,
        title: "Editorial",
        components: [{
          id: "plan",
          name: "Plan",
          type: "plan",
          x: 0,
          y: 0,
          width: 120,
          height: 80,
          contentScale: 1,
          html: "",
        }],
      },
    ],
    [
      "invalid horizontal range",
      {
        schemaVersion: 7,
        title: "Editorial",
        components: [{
          id: "plan",
          name: "Plan",
          type: "plan",
          x: canvasWidth - 100,
          y: 0,
          width: 120,
          height: 80,
          html: "",
        }],
      },
    ],
    [
      "legacy display height",
      {
        schemaVersion: 7,
        title: "Editorial",
        components: [{
          id: "reference",
          name: "Reference",
          type: "reference",
          x: 0,
          y: 0,
          width: 120,
          height: 80,
          description: "",
          images: [{
            id: "image",
            file: "references/a.png",
            aspectRatio: 1,
            frameWidth: 80,
            frameHeight: 80,
            displayHeight: 80,
          }],
        }],
      },
    ],
  ])("fails closed for v7 %s", (_description, raw) => {
    expect(() => migratePlan(raw, context)).toThrow(/v7|height|field|range/i);
  });
});
