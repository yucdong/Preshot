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
  setDescription,
  setPhotographyPlan,
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

  it("creates groups with an empty description and updates it immutably", () => {
    const base = addGroup(EMPTY_PLAN, createGroup("g1", "Lookbook", 3));
    expect(base.referenceGroups[0].description).toBe("");

    const next = setDescription(base, "g1", "Golden hour, warm tones");

    expect(next.referenceGroups[0].description).toBe("Golden hour, warm tones");
    expect(base.referenceGroups[0].description).toBe("");
  });

  it("sets the photography plan html immutably and defaults to empty", () => {
    expect(EMPTY_PLAN.photographyPlan).toBe("");
    const next = setPhotographyPlan(EMPTY_PLAN, "<h1>Shoot</h1>");
    expect(next.photographyPlan).toBe("<h1>Shoot</h1>");
    expect(next.referenceGroups).toBe(EMPTY_PLAN.referenceGroups);
    expect(EMPTY_PLAN.photographyPlan).toBe("");
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

  it("preserves photography plan when other reducers update groups", () => {
    const base = setPhotographyPlan(EMPTY_PLAN, "<p>Storyboard</p>");
    const withGroup = addGroup(base, createGroup("g1", "Lookbook", 3));

    expect(renameGroup(withGroup, "g1", "Updated").photographyPlan).toBe("<p>Storyboard</p>");
    expect(setDescription(withGroup, "g1", "Warm tones").photographyPlan).toBe("<p>Storyboard</p>");
    expect(setColumns(withGroup, "g1", 4).photographyPlan).toBe("<p>Storyboard</p>");
    expect(addImage(withGroup, "g1", { id: "i1", file: "references/0001.jpg" }).photographyPlan)
      .toBe("<p>Storyboard</p>");
    expect(deleteGroup(withGroup, "g1").photographyPlan).toBe("<p>Storyboard</p>");
  });
});
