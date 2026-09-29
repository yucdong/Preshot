import { fireEvent } from "@testing-library/react";
import { BlockNoteEditor } from "@blocknote/core";
import { afterEach, expect, it, vi } from "vitest";
import { preshotBlockNoteSchema } from "./preshotBlockNoteSchema";
import { startBlockPointerDrag } from "./blockPointerDrag";

const mounted: Array<ReturnType<typeof BlockNoteEditor.create>> = [];
afterEach(() => {
  fireEvent.pointerCancel(document);
  mounted.splice(0).forEach(editor => editor.unmount());
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

it("cancels exactly once if the document changes before pointer release", () => {
  const editor = BlockNoteEditor.create({ schema: preshotBlockNoteSchema, initialContent: [
    { id: "source", type: "paragraph", content: "Source" },
    { id: "target", type: "paragraph", content: "Target" },
  ] });
  const host = document.createElement("div"); document.body.append(host);
  editor.mount(host); mounted.push(editor);
  const target = host.querySelector<HTMLElement>('[data-node-type="blockOuter"][data-id="target"]')!;
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue({ top: 100, bottom: 150, left: 0, right: 400, width: 400, height: 50, x: 0, y: 100, toJSON() {} });
  vi.spyOn(document, "elementFromPoint").mockReturnValue(target);
  const onFinish = vi.fn(); const notify = vi.fn();
  startBlockPointerDrag({ editor, source: editor.getBlock("source")!, clientX: 0, clientY: 0, onFinish, notify });
  fireEvent.pointerMove(document, { clientX: 395, clientY: 125 });
  expect(document.querySelector("[data-preshot-block-drop-overlay]")).not.toBeNull();
  editor.updateBlock("target", { content: "Updated during drag" });
  const updated = JSON.stringify(editor.document);
  fireEvent.pointerUp(document, { clientX: 395, clientY: 125 });
  expect(JSON.stringify(editor.document)).toBe(updated);
  expect(document.querySelector("[data-preshot-block-drop-overlay]")).toBeNull();
  expect(notify).not.toHaveBeenCalled();
  expect(onFinish).toHaveBeenCalledTimes(1);
});
