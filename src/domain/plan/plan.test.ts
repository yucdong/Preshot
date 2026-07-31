import { describe, expect, it } from "vitest";
import { EMPTY_PLAN, MAX_COLUMNS, MIN_COLUMNS } from "./models";
import type { ProjectPlan } from "./models";
import {
  addGroup,
  addImage,
  clampColumns,
  createGroup,
  deleteGroup,
  moveImage,
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

describe("moveImage", () => {
  const plan = (): ProjectPlan => ({
    photographyPlan: "",
    referenceGroups: [
      {
        id: "g1",
        title: "A",
        description: "",
        columnsPerRow: 3,
        images: [
          { id: "a", file: "references/a.png" },
          { id: "b", file: "references/b.png" },
          { id: "c", file: "references/c.png" },
        ],
      },
      {
        id: "g2",
        title: "B",
        description: "",
        columnsPerRow: 3,
        images: [{ id: "x", file: "references/x.png" }],
      },
    ],
  });

  const ids = (p: ProjectPlan, groupId: string) =>
    p.referenceGroups.find((g) => g.id === groupId)!.images.map((i) => i.id);

  it("reorders within a group forward (lands after the target slot)", () => {
    const next = moveImage(plan(), { fromGroupId: "g1", imageId: "a", toGroupId: "g1", toIndex: 2 });
    expect(ids(next, "g1")).toEqual(["b", "c", "a"]);
  });

  it("reorders within a group backward (lands at the target slot)", () => {
    const next = moveImage(plan(), { fromGroupId: "g1", imageId: "c", toGroupId: "g1", toIndex: 1 });
    expect(ids(next, "g1")).toEqual(["a", "c", "b"]);
  });

  it("moves an image across groups at a given index", () => {
    const next = moveImage(plan(), { fromGroupId: "g1", imageId: "b", toGroupId: "g2", toIndex: 0 });
    expect(ids(next, "g1")).toEqual(["a", "c"]);
    expect(ids(next, "g2")).toEqual(["b", "x"]);
  });

  it("appends when toIndex is beyond the end (clamped)", () => {
    const next = moveImage(plan(), { fromGroupId: "g1", imageId: "a", toGroupId: "g2", toIndex: 99 });
    expect(ids(next, "g2")).toEqual(["x", "a"]);
  });

  it("returns the same plan reference for an unknown image", () => {
    const p = plan();
    expect(moveImage(p, { fromGroupId: "g1", imageId: "zz", toGroupId: "g2", toIndex: 0 })).toBe(p);
  });

  it("returns the same plan reference for an unknown group", () => {
    const p = plan();
    expect(moveImage(p, { fromGroupId: "g1", imageId: "a", toGroupId: "nope", toIndex: 0 })).toBe(p);
  });

  it("returns the same plan reference for a no-op reorder", () => {
    const p = plan();
    expect(moveImage(p, { fromGroupId: "g1", imageId: "a", toGroupId: "g1", toIndex: 0 })).toBe(p);
  });

  it("does not mutate the input plan", () => {
    const p = plan();
    moveImage(p, { fromGroupId: "g1", imageId: "a", toGroupId: "g2", toIndex: 0 });
    expect(ids(p, "g1")).toEqual(["a", "b", "c"]);
    expect(ids(p, "g2")).toEqual(["x"]);
  });
});
