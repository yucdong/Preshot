// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { BlockNoteEditor } from "@blocknote/core";
import {
  blockContext,
  convertBlock,
  deleteBlockOrSelection,
  duplicateBlockTree,
  insertParagraphRelativeToBlock,
  moveBlockRelative,
  moveSpecificBlock,
  nestSpecificBlock,
  unnestSpecificBlock,
} from "./blockOperations";
import { preshotBlockNoteSchema } from "./preshotBlockNoteSchema";

function editorWithNestedContent() {
  return BlockNoteEditor.create({
    schema: preshotBlockNoteSchema,
    initialContent: [
      {
        id: "heading",
        type: "heading",
        props: { level: 2 },
        content: "Section",
        children: [{
          id: "child",
          type: "paragraph",
          content: "Nested",
        }],
      },
      {
        id: "paragraph",
        type: "paragraph",
        content: "Body",
      },
      {
        id: "image-group",
        type: "imageGroup",
        props: { groupId: "group-1" },
      },
    ],
  });
}

describe("BlockNote block operations", () => {
  it("reads nested block context", () => {
    const editor = editorWithNestedContent();

    expect(blockContext(editor.document, "heading")).toMatchObject({
      depth: 0,
      index: 0,
    });
    expect(blockContext(editor.document, "child")).toMatchObject({
      depth: 1,
      index: 0,
      parent: { id: "heading" },
    });
  });

  it("duplicates a complete block subtree with new block ids", () => {
    const editor = editorWithNestedContent();
    const cloneGroup = vi.fn();

    const inserted = duplicateBlockTree(
      editor,
      editor.getBlock("heading")!,
      { cloneGroup },
    );

    expect(inserted).toHaveLength(1);
    expect(editor.document).toHaveLength(4);
    expect(editor.document[1]).toMatchObject({
      type: "heading",
      children: [{ type: "paragraph" }],
    });
    expect(editor.document[1].id).not.toBe("heading");
    expect(editor.document[1].children[0].id).not.toBe("child");
    expect(cloneGroup).not.toHaveBeenCalled();
  });

  it("clones image-group metadata when duplicating an image-group block", () => {
    const editor = editorWithNestedContent();
    const cloneGroup = vi.fn().mockReturnValue("group-copy");

    duplicateBlockTree(
      editor,
      editor.getBlock("image-group")!,
      { cloneGroup },
    );

    expect(cloneGroup).toHaveBeenCalledWith("group-1");
    expect(editor.document.at(-1)).toMatchObject({
      type: "imageGroup",
      props: { groupId: "group-copy" },
    });
  });

  it("inserts, transforms, nests, unnests, and deletes blocks", () => {
    const editor = editorWithNestedContent();
    const paragraph = editor.getBlock("paragraph")!;

    const [inserted] = insertParagraphRelativeToBlock(
      editor,
      paragraph,
      "before",
    );
    expect(editor.getPrevBlock(paragraph)?.id).toBe(inserted.id);

    convertBlock(editor, paragraph, "quote");
    expect(editor.getBlock("paragraph")?.type).toBe("quote");

    expect(nestSpecificBlock(editor, paragraph)).toBe(true);
    expect(editor.getParentBlock(paragraph)).toBeDefined();
    expect(unnestSpecificBlock(editor, paragraph)).toBe(true);
    expect(editor.getParentBlock(paragraph)).toBeUndefined();

    deleteBlockOrSelection(editor, inserted);
    expect(editor.getBlock(inserted.id)).toBeUndefined();
  });

  it("refuses to nest an image-group block", () => {
    const editor = editorWithNestedContent();
    const imageGroup = editor.getBlock("image-group")!;

    expect(nestSpecificBlock(editor, imageGroup)).toBe(false);
    expect(editor.getParentBlock(imageGroup)).toBeUndefined();
  });

  it("moves text blocks and keeps image groups top-level", () => {
    const editor = editorWithNestedContent();
    const paragraph = editor.getBlock("paragraph")!;
    const imageGroup = editor.getBlock("image-group")!;

    expect(moveSpecificBlock(editor, paragraph, "up")).toBe(true);
    expect(editor.document[0].id).toBe("paragraph");

    expect(moveSpecificBlock(editor, imageGroup, "up")).toBe(true);
    expect(editor.document[1]).toMatchObject({
      id: "image-group",
      type: "imageGroup",
      props: { groupId: "group-1" },
    });
    expect(editor.getParentBlock("image-group")).toBeUndefined();
  });

  it("moves blocks before, after, and inside pointer drop targets", () => {
    const editor = editorWithNestedContent();
    const paragraph = editor.getBlock("paragraph")!;
    const heading = editor.getBlock("heading")!;

    expect(moveBlockRelative(editor, paragraph, heading, "inside")).toBe(true);
    expect(editor.getParentBlock("paragraph")?.id).toBe("heading");

    const nestedParagraph = editor.getBlock("paragraph")!;
    const imageGroup = editor.getBlock("image-group")!;
    expect(
      moveBlockRelative(editor, nestedParagraph, imageGroup, "before"),
    ).toBe(true);
    expect(editor.getParentBlock("paragraph")).toBeUndefined();
    expect(editor.document.at(-2)?.id).toBe("paragraph");

    expect(
      moveBlockRelative(editor, imageGroup, heading.children[0], "inside"),
    ).toBe(false);
    expect(editor.getParentBlock("image-group")).toBeUndefined();
  });

  it("creates a same-row column list from a left edge drop", () => {
    const editor = editorWithNestedContent();
    const paragraph = editor.getBlock("paragraph")!;
    const imageGroup = editor.getBlock("image-group")!;

    expect(
      moveBlockRelative(editor, imageGroup, paragraph, "left"),
    ).toBe(true);

    const columnList = editor.document.find(
      (block) => block.type === "columnList",
    );
    expect(columnList).toMatchObject({
      type: "columnList",
      children: [
        {
          type: "column",
          props: { width: 1.25 },
          children: [{ type: "imageGroup" }],
        },
        {
          type: "column",
          props: { width: 0.75 },
          children: [{ type: "paragraph" }],
        },
      ],
    });
    expect(editor.getParentBlock("image-group")?.type).toBe("column");
  });
});
