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

  it("returns the original plan for a same-position move within a row", () => {
    const sharedRowPlan: ProjectPlan = {
      schemaVersion: 5,
      title: "Shared",
      components: [
        { id: "a", rowId: "shared", name: "文案1", type: "plan", width: 0.4, html: "" },
        { id: "b", rowId: "shared", name: "文案2", type: "plan", width: 0.4, html: "" },
        { id: "c", rowId: "other", name: "文案3", type: "plan", width: 1, html: "" },
      ],
    };

    expect(
      moveComponentInRows(sharedRowPlan, {
        id: "a",
        target: { kind: "row", rowId: "shared", toIndex: 0 },
      }),
    ).toBe(sharedRowPlan);
  });

  it("returns the original plan when a singleton row is dropped into its current gap", () => {
    const singletonRows: ProjectPlan = {
      schemaVersion: 5,
      title: "Singletons",
      components: [
        { id: "a", rowId: "row-a", name: "文案1", type: "plan", width: 1, html: "" },
        { id: "b", rowId: "row-b", name: "文案2", type: "plan", width: 1, html: "" },
        { id: "c", rowId: "row-c", name: "文案3", type: "plan", width: 1, html: "" },
      ],
    };

    expect(
      moveComponentInRows(singletonRows, {
        id: "b",
        target: { kind: "new-row", rowId: "generated-row", toRowIndex: 1 },
      }),
    ).toBe(singletonRows);
  });

  it("rejects a move that would overflow a target row once its new gap is included", () => {
    const capacityPlan: ProjectPlan = {
      schemaVersion: 5,
      title: "Capacity",
      components: [
        { id: "a", rowId: "source", name: "文案1", type: "plan", width: 0.6, html: "" },
        { id: "b", rowId: "target", name: "文案2", type: "plan", width: 0.4, html: "" },
      ],
    };

    expect(
      moveComponentInRows(capacityPlan, {
        id: "a",
        target: { kind: "row", rowId: "target", toIndex: 0 },
      }),
    ).toBe(capacityPlan);
  });
});
