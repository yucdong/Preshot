import { describe, expect, it } from "vitest";
import { migratePlan } from "./migrate";

const context = { projectName: "Editorial" };

describe("schema v9 migration", () => {
  it("migrates each v8 plan html field into a deterministic title-free leaf", () => {
    const migrated = migratePlan({
      schemaVersion: 8,
      title: "Editorial",
      components: [
        {
          id: "plan-a",
          name: "重复名称",
          type: "plan",
          x: 0,
          width: 300,
          height: 180,
          html: "<p>Legacy content</p>",
        },
        {
          id: "plan-b",
          name: "重复名称",
          type: "plan",
          x: 0,
          width: 300,
          height: 180,
          html: "<p>Second</p>",
        },
      ],
    }, context);

    expect(migrated).toMatchObject({
      schemaVersion: 12,
      documentHtml: "<p>Legacy content</p><p>Second</p><p></p>",
      components: [],
    });
  });

  it("removes v9 titles and rejects duplicate node ids", () => {
    const saved = {
      schemaVersion: 9,
      title: "Editorial",
      components: [{
        id: "plan",
        name: "Plan",
        type: "plan",
        x: 0,
        width: 400,
        height: 240,
        textRoot: {
          kind: "split",
          id: "split",
          direction: "columns",
          gap: 12,
          children: [
            { kind: "leaf", id: "same", title: "A", html: "<p>A</p>" },
            { kind: "leaf", id: "leaf-b", title: "", html: "<p>B</p>" },
          ],
        },
      }],
    };
    expect(migratePlan(saved, context)).toEqual({
      schemaVersion: 12,
      title: "Editorial",
      documentHtml: "<p>A</p><p>B</p><p></p>",
      components: [],
    });

    const duplicate = structuredClone(saved);
    duplicate.components[0].textRoot.children[1].id = "same";
    expect(() => migratePlan(duplicate, context)).toThrow(/duplicate.*node/i);
  });
});