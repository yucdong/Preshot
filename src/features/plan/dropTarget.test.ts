import { describe, expect, it } from "vitest";
import type { ReferenceGroup } from "../../domain/plan/models";
import { computeDropTarget, dropTargetFromEvent, groupDroppableId } from "./dropTarget";

const groups: ReferenceGroup[] = [
  { id: "g1", title: "A", description: "", columnsPerRow: 3, images: [
    { id: "a", file: "a.png" }, { id: "b", file: "b.png" }, { id: "c", file: "c.png" },
  ] },
  { id: "g2", title: "B", description: "", columnsPerRow: 3, images: [{ id: "x", file: "x.png" }] },
  { id: "g3", title: "C", description: "", columnsPerRow: 3, images: [] },
];

describe("computeDropTarget", () => {
  it("returns null for no over, self-hover, or unknown active", () => {
    expect(computeDropTarget(groups, "a", null, false)).toBeNull();
    expect(computeDropTarget(groups, "a", "a", false)).toBeNull();
    expect(computeDropTarget(groups, "zz", "b", false)).toBeNull();
  });

  it("appends when over a group container (incl. empty group)", () => {
    expect(computeDropTarget(groups, "a", groupDroppableId("g2"), false)).toEqual({ toGroupId: "g2", toIndex: 1 });
    expect(computeDropTarget(groups, "a", groupDroppableId("g3"), false)).toEqual({ toGroupId: "g3", toIndex: 0 });
  });

  it("returns null for an unknown group container", () => {
    expect(computeDropTarget(groups, "a", groupDroppableId("nope"), false)).toBeNull();
  });

  it("moves the active image into the over tile's slot within a group (array-move)", () => {
    // Same group: the active image takes the over tile's position as soon as it is
    // the drop target, regardless of insertAfter (a partial overlap is enough).
    // active a removed -> [b,c]; over c is originally at index 2 -> a lands there.
    expect(computeDropTarget(groups, "a", "c", false)).toEqual({ toGroupId: "g1", toIndex: 2 });
    expect(computeDropTarget(groups, "a", "c", true)).toEqual({ toGroupId: "g1", toIndex: 2 });
  });

  it("supports front insertion (drag onto the first tile), ignoring insertAfter", () => {
    // active c dragged onto a (index 0) -> c lands at the front, either way.
    expect(computeDropTarget(groups, "c", "a", false)).toEqual({ toGroupId: "g1", toIndex: 0 });
    expect(computeDropTarget(groups, "c", "a", true)).toEqual({ toGroupId: "g1", toIndex: 0 });
  });

  it("inserts before/after the over tile across groups", () => {
    expect(computeDropTarget(groups, "a", "x", false)).toEqual({ toGroupId: "g2", toIndex: 0 });
    expect(computeDropTarget(groups, "a", "x", true)).toEqual({ toGroupId: "g2", toIndex: 1 });
  });
});

describe("dropTargetFromEvent", () => {
  const rect = (left: number) => ({ left, width: 100, top: 0, height: 100 });
  const event = (overId: string | null, activeLeft: number, overLeft: number) => ({
    active: { id: "a", rect: { current: { translated: rect(activeLeft) } } },
    over: overId ? { id: overId, rect: rect(overLeft) } : null,
  });

  it("returns null when there is no over target", () => {
    expect(dropTargetFromEvent(groups, event(null, 0, 0))).toBeNull();
  });

  it("targets the over tile's slot for same-group drags regardless of pointer center", () => {
    // Same group (active a, over c): array-move puts a in c's slot either way, so a
    // partial overlap is enough — the pointer need not travel past the tile center.
    expect(dropTargetFromEvent(groups, event("c", 200, 100))).toEqual({ toGroupId: "g1", toIndex: 2 });
    expect(dropTargetFromEvent(groups, event("c", 0, 100))).toEqual({ toGroupId: "g1", toIndex: 2 });
  });

  it("derives insertAfter from the pointer/tile centers across groups", () => {
    // Cross group (active a, over x in g2): the pointer center decides before/after.
    // active center 250 > over center 150 -> insertAfter -> after x (index 1)
    expect(dropTargetFromEvent(groups, event("x", 200, 100))).toEqual({ toGroupId: "g2", toIndex: 1 });
    // active center 50 < over center 150 -> before x (index 0)
    expect(dropTargetFromEvent(groups, event("x", 0, 100))).toEqual({ toGroupId: "g2", toIndex: 0 });
  });
});
