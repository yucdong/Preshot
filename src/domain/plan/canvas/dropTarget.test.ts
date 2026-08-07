import { describe, expect, it } from "vitest";
import { componentDropTarget } from "./dropTarget";
import type { PlanComponent } from "./models";

const components: PlanComponent[] = [
  { id: "a", name: "文案1", type: "plan", x: 0, y: 60, width: 180, height: 120, html: "" },
  { id: "b", name: "文案2", type: "plan", x: 0, y: 204, width: 180, height: 120, html: "" },
  { id: "c", name: "文案3", type: "plan", x: 0, y: 348, width: 180, height: 120, html: "" },
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

  it("returns a flat post-removal insertion index", () => {
    expect(componentDropTarget(components, "a", {
      type: "component",
      id: "b",
      insertAfter: true,
    })).toEqual({ toIndex: 1 });
  });

  it("reorders across old row ids without capacity restrictions", () => {
    expect(componentDropTarget(components, "a", {
      type: "component",
      id: "c",
      insertAfter: false,
    })).toEqual({ toIndex: 1 });
  });
});
