import { describe, expect, it } from "vitest";
import type { PlanTextComponent, PlanTextNode, ProjectPlan } from "./models";
import {
  splitTextLeaf,
  layoutTextTree,
  removeTextLeaf,
  switchTextSplitDirection,
  textTreeMinimumWidth,
  updateTextLeafHtml,
} from "./textTree";

const component: PlanTextComponent = {
  id: "plan",
  name: "可重复名称",
  type: "plan",
  x: 0,
  width: 400,
  height: 220,
  textRoot: {
    kind: "leaf",
    id: "leaf-a",
    html: "<p>原内容</p>",
  },
};

function plan(): ProjectPlan {
  return { schemaVersion: 12, title: "Demo", components: [component] };
}

describe("recursive text tree reducers", () => {
  it("calculates recursive minimum widths for rows and columns", () => {
    const leaf = component.textRoot;
    const rows: PlanTextNode = {
      kind: "split",
      id: "rows",
      direction: "rows",
      gap: 10,
      children: [leaf, { ...leaf, id: "leaf-b" }],
    };
    const columns: PlanTextNode = {
      ...rows,
      id: "columns",
      direction: "columns",
    };

    expect(textTreeMinimumWidth(leaf)).toBe(132);
    expect(textTreeMinimumWidth(rows)).toBe(132);
    expect(textTreeMinimumWidth(columns)).toBe(274);
    expect(textTreeMinimumWidth({
      kind: "split",
      id: "nested",
      direction: "columns",
      gap: 10,
      children: [leaf, rows],
    })).toBe(274);
  });

  it("splits any leaf without changing the outer component bounds", () => {
    const split = splitTextLeaf(plan(), {
      componentId: "plan",
      leafId: "leaf-a",
      splitId: "split-a",
      secondLeafId: "leaf-b",
      direction: "columns",
    });
    const next = split.components[0] as PlanTextComponent;

    expect(next).toMatchObject({ x: 0, width: 400, height: 220 });
    expect(next.textRoot).toEqual({
      kind: "split",
      id: "split-a",
      direction: "columns",
      gap: 10,
      children: [
        component.textRoot,
        { kind: "leaf", id: "leaf-b", html: "" },
      ],
    });

    const nested = splitTextLeaf(split, {
      componentId: "plan",
      leafId: "leaf-b",
      splitId: "split-b",
      secondLeafId: "leaf-c",
      direction: "rows",
    });
    expect((nested.components[0] as PlanTextComponent).textRoot).toMatchObject({
      children: [
        component.textRoot,
        { kind: "split", id: "split-b", direction: "rows" },
      ],
    });
  });

  it("updates one leaf and switches a branch without replacing unaffected nodes", () => {
    const split = splitTextLeaf(plan(), {
      componentId: "plan",
      leafId: "leaf-a",
      splitId: "split-a",
      secondLeafId: "leaf-b",
      direction: "columns",
    });
    const edited = updateTextLeafHtml(split, {
      componentId: "plan",
      leafId: "leaf-b",
      html: "<p>新内容</p>",
    });
    const rows = switchTextSplitDirection(edited, {
      componentId: "plan",
      splitId: "split-a",
      direction: "rows",
    });

    expect((rows.components[0] as PlanTextComponent).textRoot).toMatchObject({
      id: "split-a",
      direction: "rows",
      children: [
        { id: "leaf-a", html: "<p>原内容</p>" },
        { id: "leaf-b", html: "<p>新内容</p>" },
      ],
    });
  });

  it("lays out nested columns and rows inside the unchanged outer rectangle", () => {
    const split = splitTextLeaf(plan(), {
      componentId: "plan",
      leafId: "leaf-a",
      splitId: "split-a",
      secondLeafId: "leaf-b",
      direction: "columns",
    });
    const nested = splitTextLeaf(split, {
      componentId: "plan",
      leafId: "leaf-b",
      splitId: "split-b",
      secondLeafId: "leaf-c",
      direction: "rows",
    });
    const root = (nested.components[0] as PlanTextComponent).textRoot;
    const placements = layoutTextTree(root, { x: 10, y: 20, width: 400, height: 220 });

    expect(placements.map(({ leaf }) => leaf.id)).toEqual(["leaf-a", "leaf-b", "leaf-c"]);
    expect(placements[0].rect).toEqual({ x: 10, y: 20, width: 195, height: 220 });
    expect(placements[1].rect).toEqual({ x: 215, y: 135, width: 195, height: 105 });
    expect(placements[2].rect).toEqual({ x: 215, y: 20, width: 195, height: 105 });
  });

  it("deletes a split leaf and promotes its sibling into the parent rectangle", () => {
    const split = splitTextLeaf(plan(), {
      componentId: "plan",
      leafId: "leaf-a",
      splitId: "split-a",
      secondLeafId: "leaf-b",
      direction: "columns",
    });
    const removedSecond = removeTextLeaf(split, {
      componentId: "plan",
      leafId: "leaf-b",
    });
    expect((removedSecond.components[0] as PlanTextComponent).textRoot).toBe(
      component.textRoot,
    );

    const nested = splitTextLeaf(split, {
      componentId: "plan",
      leafId: "leaf-b",
      splitId: "split-b",
      secondLeafId: "leaf-c",
      direction: "rows",
    });
    const removedOriginal = removeTextLeaf(nested, {
      componentId: "plan",
      leafId: "leaf-a",
    });
    expect((removedOriginal.components[0] as PlanTextComponent).textRoot).toMatchObject({
      kind: "split",
      id: "split-b",
      direction: "rows",
      children: [{ id: "leaf-b" }, { id: "leaf-c" }],
    });
  });

  it("does not delete the only remaining text leaf", () => {
    const original = plan();
    expect(removeTextLeaf(original, { componentId: "plan", leafId: "leaf-a" })).toBe(original);
  });
});