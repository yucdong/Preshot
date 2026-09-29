import { afterEach, describe, expect, it, vi } from "vitest";
import { BlockNoteEditor } from "@blocknote/core";
import { preshotBlockNoteSchema } from "./preshotBlockNoteSchema";
import { activeColumn, addColumn, attachColumnStructureGuard, createColumns, mergeColumn, moveToAdjacentColumn, setColumnWeights } from "./columnOperations";
import { canNestSpecificBlock, canUnnestSpecificBlock, duplicateBlockTree, moveBlockRelative } from "./blockOperations";
import { serializeBlockNoteDocumentAssets } from "./blockNoteDocumentAssets";

const mounted: Array<ReturnType<typeof BlockNoteEditor.create>> = [];
afterEach(() => { mounted.splice(0).forEach(e => e.unmount()); document.body.replaceChildren(); });
const editor = () => {
  const e = BlockNoteEditor.create({ schema: preshotBlockNoteSchema, initialContent: [
  { id: "text", type: "paragraph", content: "Shoot plan" },
  { id: "group", type: "imageGroup", props: { groupId: "gallery" } },
] });
  const host = document.createElement("div"); document.body.append(host); e.mount(host);
  mounted.push(e); return e;
};
describe("real multi-column editor operations", () => {
  it("removes the emptied source column and unwraps the remaining column in one undo step", () => {
    const e = editor();
    expect(moveBlockRelative(e, e.getBlock("group")!, e.getBlock("text")!, "right")).toBe(true);
    const before = JSON.stringify(e.document);
    const row = e.document.find(block => block.type === "columnList")!;
    expect(moveBlockRelative(e, e.getBlock("group")!, row, "after")).toBe(true);
    expect(e.document.filter(block => block.type !== "paragraph" || block.id === "text").map(block => block.id)).toEqual(["text", "group"]);
    expect(e.document.some(block => block.type === "columnList")).toBe(false);
    expect(e.undo()).toBe(true);
    expect(JSON.stringify(e.document)).toBe(before);
  });
  it("appends an atomic card to a column's blank area without nesting column rows", () => {
    const e = editor(); const row = createColumns(e, 2, "text");
    expect(moveBlockRelative(e, e.getBlock("group")!, row.children[1], "inside")).toBe(true);
    expect(e.getParentBlock("group")?.id).toBe(row.children[1].id);
    expect(moveBlockRelative(e, e.getBlock("group")!, e.getBlock(row.id)!, "left")).toBe(false);
  });
  it("rejects a nested column row before it reaches editor state", () => {
    const e = editor(); const release = attachColumnStructureGuard(e);
    const before = JSON.stringify(e.document);
    e.updateBlock("text", { children: [{ type: "columnList", children: [
      { type: "column", children: [{ type: "paragraph", content: "A" }] },
      { type: "column", children: [{ type: "paragraph", content: "B" }] },
    ] }] });
    expect(JSON.stringify(e.document)).toBe(before);
    expect(createColumns(e, 2, "text").type).toBe("columnList");
    release();
  });
  it("duplicates descendant sidecars with independent identities", () => {
    const e = editor(); const row = createColumns(e, 2, "group");
    const cloneGroup = vi.fn(() => "gallery-copy");
    const copies = duplicateBlockTree(e, row, { cloneGroup });
    expect(cloneGroup).toHaveBeenCalledWith("gallery");
    expect(copies[0].children[0].children[0].props).toEqual({ groupId: "gallery-copy" });
    expect(e.getBlock("group")?.props).toEqual({ groupId: "gallery" });
  });
  it("does not nest structural rows or unnest a column child into its row", () => {
    const e = editor(); const row = createColumns(e, 2, "group");
    expect(canNestSpecificBlock(e, row)).toBe(false);
    expect(canUnnestSpecificBlock(e, row.children[0])).toBe(false);
    expect(canUnnestSpecificBlock(e, e.getBlock("group")!)).toBe(false);
    expect(moveBlockRelative(e, row, e.getBlock("text")!, "inside")).toBe(false);
    expect(moveBlockRelative(e, row, e.getBlock("text")!, "right")).toBe(false);
  });
  it("wraps content, adds arbitrary sibling columns and preserves ids through merge and undo", () => {
    const e = editor(); const row = createColumns(e, 2, "text");
    expect(e.getBlock("text")?.content).toMatchObject([{ text: "Shoot plan" }]);
    for (let n = 2; n < 8; n++) addColumn(e, row.children[0].id);
    expect(e.getBlock(row.id)?.children).toHaveLength(8);
    const before = JSON.stringify(e.document);
    mergeColumn(e, e.getBlock(row.id)!.children[1].id);
    expect(e.getBlock(row.id)?.children).toHaveLength(7);
    expect(e.undo()).toBe(true); expect(JSON.stringify(e.document)).toBe(before);
    expect(serializeBlockNoteDocumentAssets(e.document, u => u).version).toBe(4);
  });
  it("commits column weights as one undo step and restores both weights", () => {
    const e = editor(); const row = createColumns(e, 2, "text");
    setColumnWeights(e, row.id, [1.4, .6]);
    expect(e.getBlock(row.id)?.children.map(c => c.type === "column" && c.props.width)).toEqual([1.4, .6]);
    expect(e.undo()).toBe(true);
    expect(e.getBlock(row.id)?.children.map(c => c.type === "column" && c.props.width)).toEqual([1, 1]);
    expect(e.redo()).toBe(true);
    expect(e.getBlock(row.id)?.children.map(c => c.type === "column" && c.props.width)).toEqual([1.4, .6]);
  });
  it("moves a custom component into a column and between columns without hoisting it outside", () => {
    const e = editor(); const row = createColumns(e, 2, "text");
    expect(moveBlockRelative(e, e.getBlock("group")!, e.getBlock("text")!, "after")).toBe(true);
    expect(activeColumn(e, "group")?.row.id).toBe(row.id);
    expect(moveToAdjacentColumn(e, "group", 1)).toBe(true);
    expect(activeColumn(e, "group")?.column.id).toBe(e.getBlock(row.id)?.children[1].id);
    expect(e.getBlock("group")?.props).toEqual({ groupId: "gallery" });
  });
});
