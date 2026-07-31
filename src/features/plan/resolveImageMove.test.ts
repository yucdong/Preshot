import { describe, expect, it, vi } from "vitest";
import type { ReferenceGroup } from "../../domain/plan/models";
import { groupDroppableId, handleImageDragEnd, resolveImageMove } from "./resolveImageMove";

const groups: ReferenceGroup[] = [
  { id: "g1", title: "A", description: "", columnsPerRow: 3, images: [
    { id: "a", file: "a.png" }, { id: "b", file: "b.png" }, { id: "c", file: "c.png" },
  ] },
  { id: "g2", title: "B", description: "", columnsPerRow: 3, images: [{ id: "x", file: "x.png" }] },
];

describe("resolveImageMove", () => {
  it("returns null when over is null (invalid drop)", () => {
    expect(resolveImageMove(groups, "a", null)).toBeNull();
  });

  it("returns null when dropped on itself", () => {
    expect(resolveImageMove(groups, "a", "a")).toBeNull();
  });

  it("returns null for an unknown active image", () => {
    expect(resolveImageMove(groups, "zz", "b")).toBeNull();
  });

  it("resolves an image-over-image move within a group to the over index", () => {
    expect(resolveImageMove(groups, "a", "c")).toEqual({
      fromGroupId: "g1", imageId: "a", toGroupId: "g1", toIndex: 2,
    });
  });

  it("resolves a cross-group image-over-image move", () => {
    expect(resolveImageMove(groups, "a", "x")).toEqual({
      fromGroupId: "g1", imageId: "a", toGroupId: "g2", toIndex: 0,
    });
  });

  it("appends when dropped on a group container", () => {
    expect(resolveImageMove(groups, "a", groupDroppableId("g2"))).toEqual({
      fromGroupId: "g1", imageId: "a", toGroupId: "g2", toIndex: 1,
    });
  });

  it("returns null when dropped on an unknown group container", () => {
    expect(resolveImageMove(groups, "a", groupDroppableId("nope"))).toBeNull();
  });
});

describe("handleImageDragEnd", () => {
  it("calls onMoveImage with resolved params", () => {
    const onMoveImage = vi.fn();
    handleImageDragEnd(groups, { active: { id: "a" }, over: { id: "c" } }, onMoveImage);
    expect(onMoveImage).toHaveBeenCalledWith({ fromGroupId: "g1", imageId: "a", toGroupId: "g1", toIndex: 2 });
  });

  it("does not call onMoveImage for an invalid drop", () => {
    const onMoveImage = vi.fn();
    handleImageDragEnd(groups, { active: { id: "a" }, over: null }, onMoveImage);
    expect(onMoveImage).not.toHaveBeenCalled();
  });
});
