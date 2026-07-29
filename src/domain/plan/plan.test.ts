import { describe, expect, it } from "vitest";
import { EMPTY_PLAN, MAX_COLUMNS, MIN_COLUMNS } from "./models";
import {
  addGroup,
  addImage,
  clampColumns,
  createGroup,
  deleteGroup,
  removeImage,
  renameGroup,
  setColumns,
} from "./plan";

describe("plan reducers", () => {
  it("clamps columns to the 1..6 range and rounds", () => {
    expect(clampColumns(0)).toBe(MIN_COLUMNS);
    expect(clampColumns(99)).toBe(MAX_COLUMNS);
    expect(clampColumns(2.6)).toBe(3);
    expect(clampColumns(Number.NaN)).toBe(MIN_COLUMNS);
  });

  it("creates a clamped, empty group and appends without mutating", () => {
    const group = createGroup("g1", "Lookbook", 3);
    const next = addGroup(EMPTY_PLAN, group);

    expect(group.images).toEqual([]);
    expect(next.referenceGroups).toEqual([group]);
    expect(EMPTY_PLAN.referenceGroups).toEqual([]);
  });

  it("renames, sets clamped columns, and deletes a group", () => {
    const base = addGroup(EMPTY_PLAN, createGroup("g1", "Old", 3));

    expect(renameGroup(base, "g1", "New").referenceGroups[0].title).toBe("New");
    expect(setColumns(base, "g1", 42).referenceGroups[0].columnsPerRow).toBe(MAX_COLUMNS);
    expect(deleteGroup(base, "g1").referenceGroups).toEqual([]);
  });

  it("adds and removes images within a group", () => {
    const base = addGroup(EMPTY_PLAN, createGroup("g1", "Lookbook", 3));
    const withImage = addImage(base, "g1", { id: "i1", file: "references/0001.jpg" });

    expect(withImage.referenceGroups[0].images).toEqual([
      { id: "i1", file: "references/0001.jpg" },
    ]);
    expect(removeImage(withImage, "g1", "i1").referenceGroups[0].images).toEqual([]);
    expect(base.referenceGroups[0].images).toEqual([]);
  });
});
