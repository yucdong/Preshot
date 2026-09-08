// @vitest-environment jsdom
import { BlockNoteEditor } from "@blocknote/core";
import { describe, expect, it } from "vitest";
import { preshotBlockNoteSchema } from "../plan/blocknote/preshotBlockNoteSchema";
import { lockMaterialContentEditor } from "./materialStructureLock";

describe("material editor transaction lock", () => {
  it("vetoes add, delete, replace, nested and sidecar-marker transactions in the real production schema", () => {
    const editor = BlockNoteEditor.create({
      schema: preshotBlockNoteSchema, trailingBlock: false,
      initialContent: [{ id: "only-block", type: "prop", props: { artifactId: "only-artifact" } }],
    });
    const unlock = lockMaterialContentEditor(editor);
    editor.mount(document.createElement("div"));
    const original = JSON.stringify(editor.document);
    editor.insertBlocks([{ type: "paragraph", content: "rogue paste" }], "only-block", "after");
    expect(JSON.stringify(editor.document)).toBe(original);
    editor.removeBlocks(["only-block"]);
    expect(JSON.stringify(editor.document)).toBe(original);
    editor.updateBlock("only-block", { type: "imageGroup", props: { groupId: "foreign" } });
    expect(JSON.stringify(editor.document)).toBe(original);
    editor.updateBlock("only-block", { props: { artifactId: "foreign" } });
    expect(JSON.stringify(editor.document)).toBe(original);
    editor.updateBlock("only-block", { children: [{ type: "paragraph", content: "child" }] });
    expect(JSON.stringify(editor.document)).toBe(original);
    expect(editor.schema).toBe(preshotBlockNoteSchema);
    expect(editor.isEditable).toBe(true);
    unlock();
    editor._tiptapEditor.destroy();
  });
});
