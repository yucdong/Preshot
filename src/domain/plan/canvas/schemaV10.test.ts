import { describe, expect, it } from "vitest";
import { migratePlan } from "./migrate";

const context = { projectName: "Editorial" };

describe("schema v10", () => {
  it("removes leaf titles while preserving recursive text geometry", () => {
    const migrated = migratePlan({
      schemaVersion: 9,
      title: "Editorial",
      components: [{
        id: "plan",
        name: "Plan",
        type: "plan",
        x: 12,
        width: 400,
        height: 240,
        textRoot: {
          kind: "split",
          id: "split",
          direction: "columns",
          gap: 12,
          children: [
            { kind: "leaf", id: "left", title: "拍摄计划", html: "<p>Left</p>" },
            { kind: "leaf", id: "right", title: "注意事项", html: "<p>Right</p>" },
          ],
        },
      }],
    }, context);

    expect(migrated).toEqual({
      schemaVersion: 12,
      title: "Editorial",
      documentHtml: "<p>Left</p><p>Right</p><p></p>",
      components: [],
    });
  });

  it("strictly reloads title-free v10 leaves", () => {
    const saved = {
      schemaVersion: 10,
      title: "Editorial",
      components: [{
        id: "plan",
        name: "Plan",
        type: "plan",
        x: 0,
        width: 400,
        height: 240,
        textRoot: { kind: "leaf", id: "root", html: "<p>Text</p>" },
      }],
    };

    expect(migratePlan(saved, context)).toEqual({
      schemaVersion: 12,
      title: "Editorial",
      documentHtml: "<p>Text</p><p></p>",
      components: [],
    });
    expect(() => migratePlan({
      ...saved,
      components: [{
        ...saved.components[0],
        textRoot: { ...saved.components[0].textRoot, title: "Unexpected" },
      }],
    }, context)).toThrow(/unsupported v10 fields/i);
  });

  it("strictly reloads persisted v11 reference image views and rejects invalid crops", () => {
    const saved = {
      schemaVersion: 11,
      title: "Editorial",
      components: [{
        id: "reference",
        name: "Reference",
        type: "reference",
        x: 0,
        width: 400,
        height: 300,
        description: "",
        images: [{
          id: "image",
          file: "references/image.png",
          aspectRatio: 5 / 3,
          sourceWidth: 2000,
          sourceHeight: 1200,
          frameWidth: 240,
          frameHeight: 300,
          crop: { x: 0.26, y: 0, width: 0.48, height: 1 },
        }],
      }],
    };

    expect(migratePlan(saved, context)).toEqual({
      schemaVersion: 12,
      title: "Editorial",
      documentHtml:
        '<h2>Reference</h2><figure data-preshot-node="image-group" data-preshot-group-id="reference"></figure><p></p>',
      components: [{
        ...saved.components[0],
        width: 547.28,
        description: "",
      }],
    });
    expect(() => migratePlan({
      ...saved,
      components: [{
        ...saved.components[0],
        images: [{ ...saved.components[0].images[0], crop: { x: 0.7, y: 0, width: 0.48, height: 1 } }],
      }],
    }, context)).toThrow(/crop/i);
    expect(() => migratePlan({
      ...saved,
      components: [{
        ...saved.components[0],
        images: [{ ...saved.components[0].images[0], crop: { x: 0.25, y: 0, width: 0.5, height: 1 } }],
      }],
    }, context)).toThrow(/frame ratio/i);
  });
});