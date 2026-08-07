import { describe, expect, it } from "vitest";
import { layoutPlan } from "./engine";
import { migratePlan } from "./migrate";
import type { PlanComponent } from "./models";

const migrationContext = { projectName: "Editorial" };

describe("schema v6", () => {
  it("migrates a v5 plan without logical rows or crop metadata", () => {
    const migrated = migratePlan(
      {
        schemaVersion: 5,
        title: "Editorial",
        components: [
          {
            id: "plan",
            rowId: "legacy-row-a",
            name: "Shot list",
            type: "plan",
            width: 0.4,
            html: "<p>Golden hour</p>",
          },
          {
            id: "reference",
            rowId: "legacy-row-b",
            name: "Looks",
            type: "reference",
            width: 0.5,
            description: "<p>Warm tones</p>",
            showCaptions: true,
            imageHeight: 135,
            images: [
              {
                id: "image",
                file: "references/look.png",
                caption: "Palette",
                aspectRatio: 1.5,
                crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
              },
            ],
          },
        ],
      },
      migrationContext,
    );

    expect(migrated).toEqual({
      schemaVersion: 6,
      title: "Editorial",
      components: [
        {
          id: "plan",
          name: "Shot list",
          type: "plan",
          width: 0.4,
          contentScale: 1,
          html: "<p>Golden hour</p>",
        },
        {
          id: "reference",
          name: "Looks",
          type: "reference",
          width: 0.5,
          contentScale: 1,
          description: "<p>Warm tones</p>",
          showDescription: true,
          imageHeight: 135,
          images: [
            {
              id: "image",
              file: "references/look.png",
              caption: "Palette",
              aspectRatio: 1.5,
            },
          ],
        },
      ],
    });
  });

  it("strictly validates v6 component, image, and schema fields", () => {
    const valid = {
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
          imageHeight: 135,
          images: [
            {
              id: "image",
              file: "references/look.png",
              aspectRatio: 1,
              displayHeight: 200,
            },
          ],
        },
      ],
    };

    expect(migratePlan(valid, migrationContext)).toEqual(valid);
    expect(() =>
      migratePlan(
        {
          ...valid,
          components: [{ ...valid.components[0], contentScale: 3 }],
        },
        migrationContext,
      ),
    ).toThrow(/contentScale/i);
    expect(() =>
      migratePlan(
        {
          ...valid,
          components: [
            {
              ...valid.components[0],
              images: [{ ...valid.components[0].images[0], crop: { x: 0, y: 0, width: 1, height: 1 } }],
            },
          ],
        },
        migrationContext,
      ),
    ).toThrow(/v6/i);
    expect(() => migratePlan({ ...valid, schemaVersion: 7 }, migrationContext)).toThrow(
      /schema version/i,
    );
    expect(() =>
      migratePlan(
        {
          ...valid,
          components: [{ ...valid.components[0], showCaptions: true }],
        },
        migrationContext,
      ),
    ).toThrow(/v6/i);
  });

  it("packs flat component order after a width change even when old row ids differ", () => {
    const legacyRowComponents = [
      {
        id: "a",
        rowId: "old-a",
        name: "A",
        type: "plan" as const,
        width: 0.4,
        contentScale: 1,
        html: "",
      },
      {
        id: "b",
        rowId: "old-b",
        name: "B",
        type: "plan" as const,
        width: 0.4,
        contentScale: 1,
        html: "",
      },
    ] as unknown as PlanComponent[];

    const before = layoutPlan(legacyRowComponents).placements;
    const after = layoutPlan(
      legacyRowComponents.map((component) =>
        component.id === "a" ? { ...component, width: 0.6 } : component,
      ),
    ).placements;

    expect(before[0].rect.y).toBe(before[1].rect.y);
    expect(after[1].rect.x).toBe(0);
    expect(after[1].rect.y).toBeGreaterThan(after[0].rect.y);
  });
});
