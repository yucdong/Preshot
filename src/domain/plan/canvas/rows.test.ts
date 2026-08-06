import { describe, expect, it } from "vitest";
import { contentSize, DEFAULT_PAGE_GEOMETRY, SPACING } from "./geometry";
import type { ProjectPlan } from "./models";
import { availableWidthInRow, moveComponentInRows, orderedRowIds } from "./rows";

const plan: ProjectPlan = {
  schemaVersion: 5,
  title: "Editorial",
  components: [
    { id: "a", rowId: "one", name: "文案1", type: "plan", width: 0.4, html: "" },
    { id: "b", rowId: "two", name: "文案2", type: "plan", width: 0.2, html: "" },
    { id: "c", rowId: "one", name: "文案3", type: "plan", width: 0.3, html: "" },
  ],
};

describe("canvas rows", () => {
  it("orders row ids by their first component and calculates remaining row width", () => {
    const gap = SPACING / contentSize(DEFAULT_PAGE_GEOMETRY).width;
    expect(orderedRowIds(plan)).toEqual(["one", "two"]);
    expect(availableWidthInRow(plan, "one")).toBeCloseTo(0.3 - gap);
    expect(availableWidthInRow(plan, "missing")).toBe(0);
  });

  it("moves components into an existing row while making rows contiguous", () => {
    expect(
      moveComponentInRows(plan, { id: "b", target: { kind: "row", rowId: "one", toIndex: 1 } }),
    ).toMatchObject({
      components: [
        { id: "a", rowId: "one" },
        { id: "b", rowId: "one" },
        { id: "c", rowId: "one" },
      ],
    });
  });

  it("creates a row at the requested row position and rejects full or unknown targets", () => {
    const created = moveComponentInRows(plan, {
      id: "c",
      target: { kind: "new-row", rowId: "three", toRowIndex: 1 },
    });
    expect(created.components.map(({ id, rowId }) => ({ id, rowId }))).toEqual([
      { id: "a", rowId: "one" },
      { id: "c", rowId: "three" },
      { id: "b", rowId: "two" },
    ]);
    expect(
      moveComponentInRows(plan, {
        id: "b",
        target: { kind: "row", rowId: "missing", toIndex: 0 },
      }),
    ).toBe(plan);
  });
});
