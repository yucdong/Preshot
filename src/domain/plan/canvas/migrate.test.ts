import { describe, expect, it } from "vitest";
import { contentSize, DEFAULT_PAGE_GEOMETRY } from "./geometry";
import { migratePlan } from "./migrate";

const context = { projectName: "Editorial" };
const canvasWidth = contentSize(DEFAULT_PAGE_GEOMETRY).width;

describe("migratePlan legacy schemas", () => {
  it("migrates v11 into one visual-order document with atomic image-group markers", () => {
    const migrated = migratePlan({
      schemaVersion: 11,
      title: "Editorial",
      components: [
        {
          id: "plan",
          name: "文案1",
          type: "plan",
          x: 0,
          width: canvasWidth,
          height: 300,
          textRoot: {
            kind: "split",
            id: "root",
            direction: "rows",
            gap: 10,
            children: [
              { kind: "leaf", id: "bottom", html: "<p>Bottom</p>" },
              {
                kind: "split",
                id: "top",
                direction: "columns",
                gap: 10,
                children: [
                  { kind: "leaf", id: "left", html: "<p>Left</p>" },
                  { kind: "leaf", id: "right", html: "<p>Right</p>" },
                ],
              },
            ],
          },
        },
        {
          id: "looks",
          name: "造型参考",
          type: "reference",
          x: 0,
          width: canvasWidth,
          height: 300,
          description: "<p>暖色自然光</p>",
          images: [{
            id: "portrait",
            file: "references/portrait.png",
            caption: "半身构图",
            aspectRatio: 1.5,
            sourceWidth: 1800,
            sourceHeight: 1200,
            frameWidth: 144,
            frameHeight: 120,
            crop: { x: 0.1, y: 0, width: 0.8, height: 1 },
          }],
        },
      ],
    }, context) as unknown as {
      schemaVersion: number;
      title: string;
      documentHtml: string;
      components: Array<Record<string, unknown>>;
    };

    expect(migrated).toMatchObject({
      schemaVersion: 12,
      title: "Editorial",
      documentHtml:
        '<p>Left</p><p>Right</p><p>Bottom</p><h2>造型参考</h2><p>暖色自然光</p><figure data-preshot-node="image-group" data-preshot-group-id="looks"></figure><p></p>',
      components: [{
        id: "looks",
        type: "reference",
        x: 0,
        width: canvasWidth,
        description: "",
        images: [{
          id: "portrait",
          file: "references/portrait.png",
          caption: "半身构图",
          sourceWidth: 1800,
          sourceHeight: 1200,
          frameWidth: 144,
          frameHeight: 120,
          crop: { x: 0.1, y: 0, width: 0.8, height: 1 },
        }],
      }],
    });
  });

  it("strictly reloads v12 and rejects broken image-group marker integrity", () => {
    const saved = {
      schemaVersion: 12,
      title: "Editorial",
      documentHtml:
        '<p>正文</p><figure data-preshot-node="image-group" data-preshot-group-id="looks"></figure><p></p>',
      components: [{
        id: "looks",
        name: "图片组1",
        type: "reference",
        x: 0,
        width: canvasWidth,
        height: 300,
        description: "",
        images: [],
      }],
    };

    expect(migratePlan(saved, context)).toEqual(saved);
    expect(() => migratePlan({
      ...saved,
      documentHtml: '<p>正文</p><figure data-preshot-node="image-group" data-preshot-group-id="missing"></figure><p></p>',
    }, context)).toThrow(/missing image group/i);
    expect(() => migratePlan({
      ...saved,
      documentHtml: "<p>正文</p>",
    }, context)).toThrow(/exactly once/i);
    expect(() => migratePlan({
      ...saved,
      components: [{
        id: "plan",
        name: "旧文案",
        type: "plan",
        x: 0,
        width: canvasWidth,
        height: 220,
        textRoot: { kind: "leaf", id: "leaf", html: "<p>旧内容</p>" },
      }],
    }, context)).toThrow(/only contain image groups/i);
  });

  it("migrates v1 content into a v12 document and image groups", () => {
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
      schemaVersion: 12,
      title: "Editorial",
      documentHtml:
        '<p>Shot list</p><h2>Looks</h2><p>Warm</p><figure data-preshot-node="image-group" data-preshot-group-id="ref"></figure><p></p>',
      components: [
        {
          id: "ref",
          type: "reference",
          x: 0,
          width: canvasWidth,
          description: "",
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

  it.each([3, 4, 5])("migrates v%s text through the v6 adapter into v12", (schemaVersion) => {
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
      schemaVersion: 12,
      documentHtml: "<p></p>",
      components: [],
    });
  });

  it("remaps duplicate v2 logical ids before producing v10", () => {
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
    expect(() => migratePlan({ schemaVersion: 13, title: "Future", components: [] }, context)).toThrow(
      /schema version/i,
    );
  });
});
