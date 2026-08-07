import { describe, expect, it } from "vitest";
import { layoutPlan } from "./engine";
import type { LegacyV6PlanComponent } from "./legacyV6";
import { migratePlan } from "./migrate";

const context = { projectName: "Editorial" };

describe("schema v6 migration adapter", () => {
  it("migrates v5 crop-era content without retaining crop metadata", () => {
    const migrated = migratePlan(
      {
        schemaVersion: 5,
        title: "Editorial",
        components: [{
          id: "reference",
          rowId: "legacy-row",
          name: "Looks",
          type: "reference",
          width: 1,
          description: "<p>Warm tones</p>",
          showCaptions: true,
          imageHeight: 135,
          images: [{
            id: "image",
            file: "references/look.png",
            caption: "Palette",
            aspectRatio: 1.5,
            crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
          }],
        }],
      },
      context,
    );

    expect(migrated).toMatchObject({
      schemaVersion: 7,
      components: [{
        id: "reference",
        type: "reference",
        description: "<p>Warm tones</p>",
        images: [{
          id: "image",
          caption: "Palette",
          frameWidth: 202.5,
          frameHeight: 135,
        }],
      }],
    });
    expect(migrated.components[0]).not.toHaveProperty("contentScale");
  });

  it("strictly validates v6 fields before migration", () => {
    const valid = {
      schemaVersion: 6,
      title: "Editorial",
      components: [{
        id: "reference",
        name: "Looks",
        type: "reference",
        width: 1,
        contentScale: 1,
        description: "",
        showDescription: true,
        imageHeight: 135,
        images: [{
          id: "image",
          file: "references/look.png",
          aspectRatio: 1,
          displayHeight: 200,
        }],
      }],
    };

    expect(migratePlan(valid, context)).toMatchObject({ schemaVersion: 7 });
    expect(() =>
      migratePlan({ ...valid, components: [{ ...valid.components[0], contentScale: 3 }] }, context),
    ).toThrow(/contentScale/i);
    expect(() =>
      migratePlan({
        ...valid,
        components: [{
          ...valid.components[0],
          images: [{ ...valid.components[0].images[0], crop: { x: 0, y: 0, width: 1, height: 1 } }],
        }],
      }, context),
    ).toThrow(/v6/i);
  });

  it("keeps legacy auto-packing available only to the migration and export adapters", () => {
    const legacy: LegacyV6PlanComponent[] = [
      { id: "a", name: "A", type: "plan", width: 0.6, contentScale: 1, html: "" },
      { id: "b", name: "B", type: "plan", width: 0.6, contentScale: 1, html: "" },
    ];
    const placements = layoutPlan(legacy).placements;
    expect(placements[1].rect.x).toBe(0);
    expect(placements[1].rect.y).toBeGreaterThan(placements[0].rect.y);
  });
});
