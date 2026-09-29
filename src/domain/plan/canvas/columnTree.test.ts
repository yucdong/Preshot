import { expect, it } from "vitest";
import { documentInsertionAnchor, insertDocumentBlocks } from "./columnTree";
import type { PreshotBlock } from "./blockDocument";
const text = (id: string): PreshotBlock => ({ id, type: "paragraph", props: {}, content: [], children: [] });
it("inserts in the owning column after the containing text row without mutating the source", () => {
  const left = text("left"); left.children = [text("nested")];
  const row: PreshotBlock = { id: "row", type: "columnList", props: {}, content: undefined, children: [
    { id: "a", type: "column", props: { width: 1 }, content: undefined, children: [left] },
    { id: "b", type: "column", props: { width: 2 }, content: undefined, children: [text("right")] },
  ] };
  expect(documentInsertionAnchor([row], "nested")).toBe("left");
  const result = insertDocumentBlocks([row], [text("new")], "nested");
  expect(result[0].children[0].children.map(b => b.id)).toEqual(["left", "new"]);
  expect(row.children[0].children).toHaveLength(1);
  expect(result[0].children[1]).toEqual(row.children[1]);
  expect(() => insertDocumentBlocks([row], [text("new")], "missing")).toThrow(/anchor/);
});
