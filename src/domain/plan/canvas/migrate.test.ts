import { describe, expect, expectTypeOf, it } from "vitest";
import { migratePlan, type PlanMigrationContext } from "./migrate";
import {
  DEFAULT_IMAGE_HEIGHT,
  type ProjectPlan,
  type ReferenceComponent,
} from "./models";

const migrationContext: PlanMigrationContext = { projectName: "Migrated plan" };

describe("migratePlan", () => {
  it("requires a migration context in its public signature", () => {
    expectTypeOf(migratePlan).toEqualTypeOf<
      (raw: unknown, context: PlanMigrationContext) => ProjectPlan
    >();

    const callWithoutMigrationContext = () => {
      // @ts-expect-error PlanMigrationContext must remain required.
      return migratePlan({});
    };
    expectTypeOf(callWithoutMigrationContext).toEqualTypeOf<() => ProjectPlan>();
  });

  describe("v4 -> v5 migration", () => {
    it("derives deterministic titles, names, and row ids from a v4 plan", () => {
      let counter = 0;
      const v4: unknown = {
        schemaVersion: 4,
        components: [
          { id: "plan-1", type: "plan", width: 0.5, html: "" },
          {
            id: "ref-1",
            type: "reference",
            width: 0.4,
            title: "Lookbook",
            description: "",
            imageHeight: 135,
            showCaptions: false,
            images: [],
          },
        ],
      };

      const migrated = migratePlan(v4, {
        projectName: "Editorial",
        makeId: (prefix) => `${prefix}-${++counter}`,
      });

      expect(migrated).toMatchObject({
        schemaVersion: 5,
        title: "Editorial",
        components: [
          { name: "文案1", rowId: "row:plan-1" },
          { name: "Lookbook", rowId: "row:ref-1", showCaptions: false },
        ],
      });
    });
  });

  describe("v5 validation", () => {
    it("rejects duplicate trimmed component names", () => {
      expect(() =>
        migratePlan(
          {
            schemaVersion: 5,
            title: "Editorial",
            components: [
              { id: "p1", rowId: "row-p1", name: "Lookbook", type: "plan", width: 1, html: "" },
              { id: "p2", rowId: "row-p2", name: "Lookbook", type: "plan", width: 1, html: "" },
            ],
          },
          migrationContext,
        ),
      ).toThrow(/duplicate component name "Lookbook"/i);
    });

    it.each([67.4, 400.1])("rejects imageHeight %s outside the supported range", (imageHeight) => {
      expect(() =>
        migratePlan(
          {
            schemaVersion: 5,
            title: "Editorial",
            components: [
              {
                id: "r1",
                rowId: "row-r1",
                name: "Lookbook",
                type: "reference",
                width: 1,
                description: "",
                showCaptions: false,
                imageHeight,
                images: [],
              },
            ],
          },
          migrationContext,
        ),
      ).toThrow(/imageHeight/i);
    });
  });

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

      const migrated = migratePlan(v3, migrationContext);

      expect(migrated.schemaVersion).toBe(5);
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

      expect((migratePlan(v4, migrationContext).components[0] as ReferenceComponent).imageHeight).toBe(135);
    });

    it("passes a valid v3 plan through, normalizing and clamping fields", () => {
      const v3 = {
        schemaVersion: 3,
        components: [
          { id: "a", type: "plan", width: 0.5, height: 150, html: "<p>x</p>" },
          { id: "b", type: "reference", width: 1, height: 300, title: "T", description: "", imageHeight: 200, showCaptions: false, images: [{ id: "i", file: "references/0001.png", aspectRatio: 1.5 }] },
        ],
      };
      const migrated = migratePlan(v3, migrationContext);
      expect(migrated.schemaVersion).toBe(5);
      expect(migrated.components).toHaveLength(2);
      expect(migrated.components[0]).toMatchObject({ id: "a", type: "plan", width: 0.5, html: "<p>x</p>" });
      expect(migrated.components[1]).toMatchObject({ id: "b", type: "reference", width: 1, name: "T", imageHeight: 150, showCaptions: false });
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
      const migrated = migratePlan(v3, migrationContext);
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
      const migrated = migratePlan(v3, migrationContext);
      expect((migrated.components[0] as ReferenceComponent).imageHeight).toBe(67.5); // clamped
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
      const migrated = migratePlan(v3, migrationContext);
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
      expect(() => migratePlan(v3, migrationContext)).toThrow(/component/i);
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
      expect(() => migratePlan(v3, migrationContext)).toThrow(/image/i);
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
      const migrated = migratePlan(v2, migrationContext);
      expect(migrated.schemaVersion).toBe(5);
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
      const migrated = migratePlan(v2, migrationContext);
      expect(migrated.components[0].width).toBe(1);
    });

    it("drops columnsPerRow and adds imageHeight for reference components", () => {
      const v2 = {
        schemaVersion: 2,
        components: [
          { id: "a", type: "reference", widthFraction: "1", height: 300, title: "T", description: "", columnsPerRow: 3, showCaptions: false, images: [{ id: "i", file: "a.png" }] },
        ],
      };
      const migrated = migratePlan(v2, migrationContext);
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
      const migrated = migratePlan(v2, migrationContext);
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
      const migrated = migratePlan(v2, migrationContext);
      expect(migrated.components[0]).toMatchObject({ id: "plan1", type: "plan", width: 0.5, html: "<h1>Test</h1>" });
      expect(migrated.components[1]).toMatchObject({ id: "ref1", type: "reference", width: 1, name: "Gallery", description: "Mood board", showCaptions: true });
      expect((migrated.components[1] as ReferenceComponent).images[0]).toEqual({ id: "img1", file: "test.png", caption: "Caption text", aspectRatio: 1 });
    });

    it("deterministically remaps duplicate component and image ids while preserving every record", () => {
      const migrated = migratePlan({
        schemaVersion: 2,
        components: [
          {
            id: "duplicate-component",
            type: "reference",
            widthFraction: "1",
            title: "First",
            description: "First description",
            showCaptions: false,
            images: [
              {
                id: "duplicate-image",
                file: "references/first.png",
                caption: "First image",
              },
            ],
          },
          {
            id: "duplicate-component",
            type: "reference",
            widthFraction: "1/2",
            title: "Second",
            description: "Second description",
            showCaptions: true,
            images: [
              {
                id: "duplicate-image",
                file: "references/second.png",
                caption: "Second image",
              },
            ],
          },
        ],
      }, migrationContext);

      expect(migrated.components.map((component) => component.id)).toEqual([
        "duplicate-component",
        "duplicate-component-2",
      ]);
      const references = migrated.components as ReferenceComponent[];
      expect(references.map((component) => component.name)).toEqual(["First", "Second"]);
      expect(references.map((component) => component.width)).toEqual([1, 0.5]);
      expect(references.flatMap((component) => component.images.map((image) => image.id))).toEqual([
        "duplicate-image",
        "duplicate-image-2",
      ]);
      expect(
        references.flatMap((component) =>
          component.images.map(({ file, caption }) => ({ file, caption })),
        ),
      ).toEqual([
        { file: "references/first.png", caption: "First image" },
        { file: "references/second.png", caption: "Second image" },
      ]);
    });
  });

  describe("v1 -> v4 migration (chained)", () => {
    it("generates one missing reference group ID and reuses it for its row", () => {
      let counter = 0;
      const makeId = (prefix: string) => `${prefix}-${++counter}`;

      const migrated = migratePlan(
        {
          photographyPlan: "",
          referenceGroups: [{ title: "Lookbook", description: "", images: [] }],
        },
        { projectName: "Editorial", makeId },
      );

      expect(migrated.components[0]).toMatchObject({ id: "ref-1", rowId: "row:ref-1" });
      expect(counter).toBe(1);
    });

    it("converts v1 plan to v4 via v2", () => {
      const v1 = {
        photographyPlan: "<h2>Sunset</h2>",
        referenceGroups: [
          { id: "g1", title: "Lookbook", description: "mood", columnsPerRow: 3, images: [{ id: "i1", file: "references/0001.png" }] },
        ],
      };
      const migrated = migratePlan(v1, migrationContext);
      expect(migrated.schemaVersion).toBe(5);
      expect(migrated.components[0]).toMatchObject({ type: "plan", width: 1, html: "<h2>Sunset</h2>" });
      expect(migrated.components[1]).toMatchObject({ type: "reference", width: 1, name: "Lookbook", imageHeight: DEFAULT_IMAGE_HEIGHT, showCaptions: false });
      expect((migrated.components[1] as ReferenceComponent).images[0]).toEqual({ id: "i1", file: "references/0001.png", aspectRatio: 1 });
    });

    it("omits the plan component when v1 photographyPlan is empty", () => {
      const migrated = migratePlan({ photographyPlan: "", referenceGroups: [] }, migrationContext);
      expect(migrated.components).toHaveLength(0);
      expect(migrated.schemaVersion).toBe(5);
    });

    it("deterministically remaps duplicate reference group ids while preserving both groups", () => {
      const migrated = migratePlan({
        photographyPlan: "",
        referenceGroups: [
          {
            id: "duplicate-group",
            title: "First",
            description: "First description",
            images: [{ id: "first-image", file: "references/first.png" }],
          },
          {
            id: "duplicate-group",
            title: "Second",
            description: "Second description",
            images: [{ id: "second-image", file: "references/second.png" }],
          },
        ],
      }, migrationContext);

      expect(migrated.components.map((component) => component.id)).toEqual([
        "duplicate-group",
        "duplicate-group-2",
      ]);
      const references = migrated.components as ReferenceComponent[];
      expect(references.map((component) => component.name)).toEqual(["First", "Second"]);
      expect(
        references.flatMap((component) =>
          component.images.map(({ id, file }) => ({ id, file })),
        ),
      ).toEqual([
        { id: "first-image", file: "references/first.png" },
        { id: "second-image", file: "references/second.png" },
      ]);
    });
  });

  describe("forward compatibility", () => {
    it("rejects a future schemaVersion instead of replacing stored data", () => {
      const future = { schemaVersion: 6, components: [] };
      expect(() => migratePlan(future, migrationContext)).toThrow(/schema version/i);
    });
  });

  describe.each([3, 4] as const)("schema v%s global identity validation", (schemaVersion) => {
    it("rejects duplicate component ids with both component positions", () => {
      expect(() =>
        migratePlan({
          schemaVersion,
          components: [
            { id: "duplicate", type: "plan", width: 1, html: "<p>A</p>" },
            { id: "duplicate", type: "plan", width: 1, html: "<p>B</p>" },
          ],
        }, migrationContext),
      ).toThrow(/duplicate component id "duplicate".*component 1.*component 0/i);
    });

    it("rejects duplicate image ids across reference components with both image positions", () => {
      expect(() =>
        migratePlan({
          schemaVersion,
          components: [
            {
              id: "r1",
              type: "reference",
              width: 1,
              title: "A",
              description: "",
              imageHeight: 180,
              showCaptions: false,
              images: [
                { id: "duplicate-image", file: "references/a.png", aspectRatio: 1 },
              ],
            },
            {
              id: "r2",
              type: "reference",
              width: 1,
              title: "B",
              description: "",
              imageHeight: 180,
              showCaptions: false,
              images: [
                { id: "duplicate-image", file: "references/b.png", aspectRatio: 1 },
              ],
            },
          ],
        }, migrationContext),
      ).toThrow(
        /duplicate image id "duplicate-image".*component 1 image 0.*component 0 image 0/i,
      );
    });

    it("rejects an image id that collides with a component id", () => {
      expect(() =>
        migratePlan({
          schemaVersion,
          components: [
            {
              id: "shared-id",
              type: "reference",
              width: 1,
              title: "A",
              description: "",
              imageHeight: 180,
              showCaptions: false,
              images: [
                { id: "image-a", file: "references/a.png", aspectRatio: 1 },
              ],
            },
            {
              id: "r2",
              type: "reference",
              width: 1,
              title: "B",
              description: "",
              imageHeight: 180,
              showCaptions: false,
              images: [
                { id: "shared-id", file: "references/b.png", aspectRatio: 1 },
              ],
            },
          ],
        }, migrationContext),
      ).toThrow(
        /duplicate logical id "shared-id".*component 1 image 0.*component 0/i,
      );
    });

    it("allows different image ids to share the same file", () => {
      const migrated = migratePlan({
        schemaVersion,
        components: [
          {
            id: "r1",
            type: "reference",
            width: 1,
            title: "A",
            description: "",
            imageHeight: 180,
            showCaptions: false,
            images: [
              { id: "i1", file: "references/shared.png", aspectRatio: 1 },
            ],
          },
          {
            id: "r2",
            type: "reference",
            width: 1,
            title: "B",
            description: "",
            imageHeight: 180,
            showCaptions: false,
            images: [
              { id: "i2", file: "references/shared.png", aspectRatio: 1 },
            ],
          },
        ],
      }, migrationContext);

      expect(
        migrated.components.flatMap((component) =>
          component.type === "reference"
            ? component.images.map((image) => image.file)
            : [],
        ),
      ).toEqual(["references/shared.png", "references/shared.png"]);
    });
  });

  describe("invalid input", () => {
    it("rejects malformed non-null stored plans", () => {
      expect(() => migratePlan(null, migrationContext)).toThrow(/stored plan/i);
      expect(() => migratePlan(42, migrationContext)).toThrow(/stored plan/i);
      expect(() => migratePlan({ nonsense: true }, migrationContext)).toThrow(/schema/i);
    });

    it("rejects malformed v4 component fields instead of synthesizing replacements", () => {
      expect(() =>
        migratePlan({
          schemaVersion: 4,
          components: [{ type: "plan", width: 1, html: "<p>x</p>" }],
        }, migrationContext),
      ).toThrow(/component 0.*id/i);

      expect(() =>
        migratePlan({
          schemaVersion: 4,
          components: [{ id: "p", type: "plan", width: 1 }],
        }, migrationContext),
      ).toThrow(/component 0.*html/i);
    });
  });
});
