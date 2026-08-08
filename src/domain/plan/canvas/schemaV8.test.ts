import { describe, expect, it } from "vitest";
import { migratePlan } from "./migrate";

const context = { projectName: "Editorial" };

describe("schema v8", () => {
  it("migrates v7 cards into stable document order and removes free vertical coordinates", () => {
    const migrated = migratePlan(
      {
        schemaVersion: 7,
        title: "Editorial",
        components: [
          {
            id: "third",
            name: "Third",
            type: "plan",
            x: 240,
            y: 300,
            width: 180,
            height: 100,
            html: "<p>Third</p>",
          },
          {
            id: "second",
            name: "Second",
            type: "plan",
            x: 180,
            y: 100,
            width: 180,
            height: 100,
            html: "<p>Second</p>",
          },
          {
            id: "first",
            name: "First",
            type: "plan",
            x: 20,
            y: 100,
            width: 180,
            height: 100,
            html: "<p>First</p>",
          },
          {
            id: "same-position",
            name: "Same position",
            type: "plan",
            x: 180,
            y: 100,
            width: 180,
            height: 100,
            html: "<p>Same position</p>",
          },
        ],
      },
      context,
    );

    expect(migrated.schemaVersion).toBe(8);
    expect(migrated.components.map((component) => component.id)).toEqual([
      "first",
      "second",
      "same-position",
      "third",
    ]);
    expect(migrated.components.every((component) => !("y" in component))).toBe(true);
  });

  it("reloads a strict v8 document without changing component order or dimensions", () => {
    const saved = {
      schemaVersion: 8,
      title: "Editorial",
      components: [
        {
          id: "narrow",
          name: "Narrow",
          type: "plan",
          x: 40,
          width: 220,
          height: 140,
          contentScale: 0.7,
          html: "<p>Narrow</p>",
        },
        {
          id: "reference",
          name: "Reference",
          type: "reference",
          x: 0,
          width: 300,
          height: 240,
          description: "",
          images: [],
        },
      ],
    };

    expect(migratePlan(saved, context)).toEqual(saved);
  });

  it("fails closed when a v8 component includes the removed y field", () => {
    expect(() =>
      migratePlan(
        {
          schemaVersion: 8,
          title: "Editorial",
          components: [
            {
              id: "plan",
              name: "Plan",
              type: "plan",
              x: 0,
              y: 0,
              width: 220,
              height: 140,
              html: "",
            },
          ],
        },
        context,
      ),
    ).toThrow(/v8|field|y/i);
  });
});