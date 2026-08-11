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
      schemaVersion: 10,
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
            { kind: "leaf", id: "left", html: "<p>Left</p>" },
            { kind: "leaf", id: "right", html: "<p>Right</p>" },
          ],
        },
      }],
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

    expect(migratePlan(saved, context)).toEqual(saved);
    expect(() => migratePlan({
      ...saved,
      components: [{
        ...saved.components[0],
        textRoot: { ...saved.components[0].textRoot, title: "Unexpected" },
      }],
    }, context)).toThrow(/unsupported v10 fields/i);
  });
});