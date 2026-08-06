import { describe, expect, it } from "vitest";
import { componentDropTarget } from "./dropTarget";
import type { PlanComponent } from "./models";

const components: PlanComponent[] = [
  { id: "a", rowId: "row-a", name: "文案1", type: "plan", width: 0.4, html: "" },
  { id: "b", rowId: "row-a", name: "文案2", type: "plan", width: 0.4, html: "" },
  { id: "c", rowId: "row-b", name: "文案3", type: "plan", width: 0.4, html: "" },
];

describe("componentDropTarget", () => {
  it("returns missing for no over or unknown ids", () => {
    expect(componentDropTarget(components, "a", null)).toEqual({
      kind: "invalid",
      reason: "missing",
    });
    expect(componentDropTarget(components, "zz", {
      type: "component",
      id: "b",
      insertAfter: false,
    })).toEqual({ kind: "invalid", reason: "missing" });
    expect(componentDropTarget(components, "a", {
      type: "component",
      id: "zz",
      insertAfter: false,
    })).toEqual({ kind: "invalid", reason: "missing" });
  });

  it("returns a same-row target with a post-removal insertion index", () => {
    expect(componentDropTarget(components, "a", {
      type: "component",
      id: "b",
      insertAfter: true,
    })).toEqual({ kind: "row", rowId: "row-a", toIndex: 1 });
  });

  it("returns a fitting cross-row target", () => {
    expect(componentDropTarget(components, "a", {
      type: "component",
      id: "c",
      insertAfter: false,
    })).toEqual({ kind: "row", rowId: "row-b", toIndex: 0 });
  });

  it("rejects a component that cannot fit in the target row", () => {
    const fullRow = [
      { ...components[0], width: 0.4 },
      { ...components[1], id: "full", rowId: "row-full", width: 0.8 },
    ];

    expect(componentDropTarget(fullRow, "a", {
      type: "component",
      id: "full",
      insertAfter: false,
    })).toEqual({ kind: "invalid", reason: "capacity" });
  });

  it("returns a new row target at a row gap", () => {
    expect(componentDropTarget(components, "a", {
      type: "row-gap",
      id: "row-b",
      insertAfter: false,
    })).toEqual({ kind: "new-row", toRowIndex: 1 });
  });
});
