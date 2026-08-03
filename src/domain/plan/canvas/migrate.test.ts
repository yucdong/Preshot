import { describe, expect, it } from "vitest";
import { migratePlan } from "./migrate";
import { EMPTY_PLAN, type ReferenceComponent } from "./models";

describe("migratePlan", () => {
  it("passes a valid v2 plan through, normalizing fields", () => {
    const v2 = {
      schemaVersion: 2,
      components: [
        { id: "a", type: "plan", widthFraction: "1/2", height: 150, html: "<p>x</p>" },
        { id: "b", type: "reference", widthFraction: "1", height: 300, title: "T", description: "", columnsPerRow: 9, showCaptions: false, images: [{ id: "i", file: "references/0001.png" }] },
      ],
    };
    const migrated = migratePlan(v2);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.components).toHaveLength(2);
    expect((migrated.components[1] as ReferenceComponent).columnsPerRow).toBe(6); // clamped
  });

  it("drops invalid components in a v2 plan", () => {
    const migrated = migratePlan({
      schemaVersion: 2,
      components: [null, { id: "a", type: "plan", widthFraction: "1", height: 100, html: "" }, { type: "bogus" }],
    });
    expect(migrated.components).toHaveLength(1);
    expect(migrated.components[0].id).toBe("a");
  });

  it("converts a v1 plan (photographyPlan + referenceGroups) to v2 components", () => {
    const v1 = {
      photographyPlan: "<h2>Sunset</h2>",
      referenceGroups: [
        { id: "g1", title: "Lookbook", description: "mood", columnsPerRow: 3, images: [{ id: "i1", file: "references/0001.png" }] },
      ],
    };
    const migrated = migratePlan(v1);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.components[0]).toMatchObject({ type: "plan", widthFraction: "1", html: "<h2>Sunset</h2>" });
    expect(migrated.components[1]).toMatchObject({ type: "reference", title: "Lookbook", columnsPerRow: 3, showCaptions: false });
    expect((migrated.components[1] as ReferenceComponent).images[0].id).toBe("i1");
  });

  it("omits the plan component when the v1 photographyPlan is empty", () => {
    const migrated = migratePlan({ photographyPlan: "", referenceGroups: [] });
    expect(migrated.components).toHaveLength(0);
  });

  it("returns an empty plan for null / malformed input", () => {
    expect(migratePlan(null)).toEqual(EMPTY_PLAN);
    expect(migratePlan(42)).toEqual(EMPTY_PLAN);
    expect(migratePlan({ nonsense: true })).toEqual(EMPTY_PLAN);
  });
});
