import { describe, expect, it } from "vitest";
import { componentDropTarget } from "./dropTarget";
import type { PlanComponent } from "./models";

const components: PlanComponent[] = [
  { id: "a", type: "plan", width: 1, html: "" },
  { id: "b", type: "plan", width: 1, html: "" },
  { id: "c", type: "plan", width: 1, html: "" },
];

describe("componentDropTarget", () => {
  it("returns null for no over, self-hover, or unknown ids", () => {
    expect(componentDropTarget(components, "a", null, false)).toBeNull();
    expect(componentDropTarget(components, "a", "a", false)).toBeNull();
    expect(componentDropTarget(components, "zz", "b", false)).toBeNull();
    expect(componentDropTarget(components, "a", "zz", false)).toBeNull();
  });

  it("computes the post-removal insertion index before/after the over component", () => {
    // remove a -> [b,c]; over c is index 1
    expect(componentDropTarget(components, "a", "c", false)).toBe(1);
    expect(componentDropTarget(components, "a", "c", true)).toBe(2);
    // remove c -> [a,b]; over a is index 0
    expect(componentDropTarget(components, "c", "a", false)).toBe(0);
    expect(componentDropTarget(components, "c", "a", true)).toBe(1);
  });
});
