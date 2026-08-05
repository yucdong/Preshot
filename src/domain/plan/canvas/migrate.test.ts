import { describe, expect, it } from "vitest";
import { migratePlan } from "./migrate";
import { DEFAULT_IMAGE_HEIGHT, type ReferenceComponent } from "./models";

describe("migratePlan", () => {
  describe("v3 schema", () => {
    it("migrates v3 to v4 by dropping component height and reducing image height once", () => {
      const v3 = {
        schemaVersion: 3,
        components: [
          { id: "p", type: "plan", width: 1, height: 220, html: "<p>x</p>" },
          {
            id: "r",
            type: "reference",
            width: 1,
            height: 320,
            title: "T",
            description: "",
            imageHeight: 180,
            showCaptions: false,
            images: [{ id: "i", file: "a.png", aspectRatio: 4 / 3 }],
          },
        ],
      };

      const migrated = migratePlan(v3);

      expect(migrated.schemaVersion).toBe(4);
      expect(migrated.components[0]).not.toHaveProperty("height");
      expect(migrated.components[1]).not.toHaveProperty("height");
      expect((migrated.components[1] as ReferenceComponent).imageHeight).toBe(135);
    });

    it("does not reduce v4 image height a second time", () => {
      const v4 = {
        schemaVersion: 4,
        components: [
          {
            id: "r",
            type: "reference",
            width: 1,
            title: "T",
            description: "",
            imageHeight: 135,
            showCaptions: false,
            images: [],
          },
        ],
      };

      expect((migratePlan(v4).components[0] as ReferenceComponent).imageHeight).toBe(135);
    });

    it("passes a valid v3 plan through, normalizing and clamping fields", () => {
      const v3 = {
        schemaVersion: 3,
        components: [
          { id: "a", type: "plan", width: 0.5, height: 150, html: "<p>x</p>" },
          { id: "b", type: "reference", width: 1, height: 300, title: "T", description: "", imageHeight: 200, showCaptions: false, images: [{ id: "i", file: "references/0001.png", aspectRatio: 1.5 }] },
        ],
      };
      const migrated = migratePlan(v3);
      expect(migrated.schemaVersion).toBe(4);
      expect(migrated.components).toHaveLength(2);
      expect(migrated.components[0]).toMatchObject({ id: "a", type: "plan", width: 0.5, html: "<p>x</p>" });
      expect(migrated.components[1]).toMatchObject({ id: "b", type: "reference", width: 1, title: "T", imageHeight: 150, showCaptions: false });
      expect(migrated.components[0]).not.toHaveProperty("height");
      expect(migrated.components[1]).not.toHaveProperty("height");
      expect((migrated.components[1] as ReferenceComponent).images[0]).toEqual({ id: "i", file: "references/0001.png", aspectRatio: 1.5 });
    });

    it("clamps width to (0.15, 1] in v3", () => {
      const v3 = {
        schemaVersion: 3,
        components: [
          { id: "a", type: "plan", width: 2, height: 100, html: "" }, // > 1
          { id: "b", type: "plan", width: 0.05, height: 100, html: "" }, // < MIN
        ],
      };
      const migrated = migratePlan(v3);
      expect(migrated.components[0].width).toBe(1); // clamped
      expect(migrated.components[1].width).toBe(0.15); // clamped
    });

    it("clamps imageHeight to [80, 400] in v3", () => {
      const v3 = {
        schemaVersion: 3,
        components: [
          { id: "a", type: "reference", width: 1, height: 200, title: "", description: "", imageHeight: 50, showCaptions: false, images: [] },
          { id: "b", type: "reference", width: 1, height: 200, title: "", description: "", imageHeight: 500, showCaptions: false, images: [] },
        ],
      };
      const migrated = migratePlan(v3);
      expect((migrated.components[0] as ReferenceComponent).imageHeight).toBe(80); // clamped
      expect((migrated.components[1] as ReferenceComponent).imageHeight).toBe(375); // reduced once, then clamped
    });

    it("preserves valid images and defaults invalid aspect ratios to 1 in v3", () => {
      const v3 = {
        schemaVersion: 3,
        components: [
          {
            id: "a",
            type: "reference",
            width: 1,
            height: 200,
            title: "",
            description: "",
            imageHeight: 180,
            showCaptions: false,
            images: [
              { id: "i1", file: "a.png", caption: "missing" },
              { id: "i2", file: "b.png", aspectRatio: 0 },
              { id: "i3", file: "c.png", aspectRatio: -1 },
              { id: "i4", file: "d.png", aspectRatio: Number.NaN },
              { id: "i5", file: "e.png", aspectRatio: Number.POSITIVE_INFINITY },
            ],
          },
        ],
      };
      const migrated = migratePlan(v3);
      const images = (migrated.components[0] as ReferenceComponent).images;
      expect(images).toHaveLength(5);
      expect(images.map((image) => image.aspectRatio)).toEqual([1, 1, 1, 1, 1]);
      expect(images[0].caption).toBe("missing");
    });

    it("rejects a v3 plan instead of partially dropping malformed components", () => {
      const v3 = {
        schemaVersion: 3,
        components: [
          { id: "a", type: "plan", height: 100, html: "" }, // missing width
          { id: "b", type: "reference", width: 1, height: 200, title: "", description: "", showCaptions: false, images: [] }, // missing imageHeight
          { id: "c", type: "plan", width: 0.5, height: 100, html: "ok" },
        ],
      };
      expect(() => migratePlan(v3)).toThrow(/component/i);
    });

    it("rejects a v3 plan instead of partially dropping malformed image identities", () => {
      const v3 = {
        schemaVersion: 3,
        components: [
          {
            id: "a",
            type: "reference",
            width: 1,
            height: 200,
            title: "",
            description: "",
            imageHeight: 180,
            showCaptions: false,
            images: [{ id: "i1" }, { id: "i2", file: "b.png", aspectRatio: 1.5 }],
          },
        ],
      };
      expect(() => migratePlan(v3)).toThrow(/image/i);
    });
  });

  describe("v2 -> v3 migration", () => {
    it("converts widthFraction to numeric width", () => {
      const v2 = {
        schemaVersion: 2,
        components: [
          { id: "a", type: "plan", widthFraction: "1", height: 150, html: "<p>x</p>" },
          { id: "b", type: "plan", widthFraction: "3/4", height: 150, html: "" },
          { id: "c", type: "plan", widthFraction: "2/3", height: 150, html: "" },
          { id: "d", type: "plan", widthFraction: "1/2", height: 150, html: "" },
          { id: "e", type: "plan", widthFraction: "1/3", height: 150, html: "" },
          { id: "f", type: "plan", widthFraction: "1/4", height: 150, html: "" },
        ],
      };
      const migrated = migratePlan(v2);
      expect(migrated.schemaVersion).toBe(4);
      expect(migrated.components[0].width).toBe(1);
      expect(migrated.components[1].width).toBe(0.75);
      expect(migrated.components[2].width).toBe(0.667);
      expect(migrated.components[3].width).toBe(0.5);
      expect(migrated.components[4].width).toBe(0.333);
      expect(migrated.components[5].width).toBe(0.25);
    });

    it("defaults unknown widthFraction to 1", () => {
      const v2 = {
        schemaVersion: 2,
        components: [{ id: "a", type: "plan", widthFraction: "bogus", height: 100, html: "" }],
      };
      const migrated = migratePlan(v2);
      expect(migrated.components[0].width).toBe(1);
    });

    it("drops columnsPerRow and adds imageHeight for reference components", () => {
      const v2 = {
        schemaVersion: 2,
        components: [
          { id: "a", type: "reference", widthFraction: "1", height: 300, title: "T", description: "", columnsPerRow: 3, showCaptions: false, images: [{ id: "i", file: "a.png" }] },
        ],
      };
      const migrated = migratePlan(v2);
      const ref = migrated.components[0] as ReferenceComponent;
      expect(ref.imageHeight).toBe(DEFAULT_IMAGE_HEIGHT);
      expect(ref).not.toHaveProperty("columnsPerRow");
    });

    it("defaults image aspectRatio to 1", () => {
      const v2 = {
        schemaVersion: 2,
        components: [
          { id: "a", type: "reference", widthFraction: "1", height: 300, title: "", description: "", columnsPerRow: 3, showCaptions: false, images: [{ id: "i1", file: "a.png" }, { id: "i2", file: "b.png", caption: "x" }] },
        ],
      };
      const migrated = migratePlan(v2);
      const images = (migrated.components[0] as ReferenceComponent).images;
      expect(images[0].aspectRatio).toBe(1);
      expect(images[1].aspectRatio).toBe(1);
    });

    it("preserves all other fields during v2->v3 migration", () => {
      const v2 = {
        schemaVersion: 2,
        components: [
          { id: "plan1", type: "plan", widthFraction: "1/2", height: 220, html: "<h1>Test</h1>" },
          { id: "ref1", type: "reference", widthFraction: "1", height: 320, title: "Gallery", description: "Mood board", columnsPerRow: 2, showCaptions: true, images: [{ id: "img1", file: "test.png", caption: "Caption text" }] },
        ],
      };
      const migrated = migratePlan(v2);
      expect(migrated.components[0]).toMatchObject({ id: "plan1", type: "plan", width: 0.5, html: "<h1>Test</h1>" });
      expect(migrated.components[1]).toMatchObject({ id: "ref1", type: "reference", width: 1, title: "Gallery", description: "Mood board", showCaptions: true });
      expect((migrated.components[1] as ReferenceComponent).images[0]).toEqual({ id: "img1", file: "test.png", caption: "Caption text", aspectRatio: 1 });
    });
  });

  describe("v1 -> v4 migration (chained)", () => {
    it("converts v1 plan to v4 via v2", () => {
      const v1 = {
        photographyPlan: "<h2>Sunset</h2>",
        referenceGroups: [
          { id: "g1", title: "Lookbook", description: "mood", columnsPerRow: 3, images: [{ id: "i1", file: "references/0001.png" }] },
        ],
      };
      const migrated = migratePlan(v1);
      expect(migrated.schemaVersion).toBe(4);
      expect(migrated.components[0]).toMatchObject({ type: "plan", width: 1, html: "<h2>Sunset</h2>" });
      expect(migrated.components[1]).toMatchObject({ type: "reference", width: 1, title: "Lookbook", imageHeight: DEFAULT_IMAGE_HEIGHT, showCaptions: false });
      expect((migrated.components[1] as ReferenceComponent).images[0]).toEqual({ id: "i1", file: "references/0001.png", aspectRatio: 1 });
    });

    it("omits the plan component when v1 photographyPlan is empty", () => {
      const migrated = migratePlan({ photographyPlan: "", referenceGroups: [] });
      expect(migrated.components).toHaveLength(0);
      expect(migrated.schemaVersion).toBe(4);
    });
  });

  describe("forward compatibility", () => {
    it("rejects a future schemaVersion instead of replacing stored data", () => {
      const future = { schemaVersion: 5, components: [] };
      expect(() => migratePlan(future)).toThrow(/schema version/i);
    });
  });

  describe("invalid input", () => {
    it("rejects malformed non-null stored plans", () => {
      expect(() => migratePlan(null)).toThrow(/stored plan/i);
      expect(() => migratePlan(42)).toThrow(/stored plan/i);
      expect(() => migratePlan({ nonsense: true })).toThrow(/schema/i);
    });
  });
});
