// @vitest-environment jsdom
import { BlockNoteEditor } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/mantine";
import { MantineProvider } from "@mantine/core";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { preshotBlockNoteSchema } from "./preshotBlockNoteSchema";
import { serializeBlockNoteDocumentAssets } from "./blockNoteDocumentAssets";

async function renderImage() {
  const editor = BlockNoteEditor.create({
    schema: preshotBlockNoteSchema,
    initialContent: [{ id: "image", type: "image", props: {
      url: "data:image/png;base64,AA==", name: "测试图片", showPreview: true,
      previewWidth: 300, previewHeight: 200,
    } }],
  });
  const view = render(<MantineProvider><BlockNoteView editor={editor} /></MantineProvider>);
  await waitFor(() => expect(view.container.querySelector(".preshot-native-image")).not.toBeNull());
  const frame = view.container.querySelector<HTMLElement>(".bn-visual-media-wrapper")!;
  vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 300, 200));
  const handle = frame.querySelector<HTMLElement>('[data-image-resize-edge="right"]')!;
  return { ...view, editor, frame, handle };
}

afterEach(() => vi.restoreAllMocks());

describe("native image resize transactions", () => {
  it("preserves explicit presentation axes while omitting the default marker from legacy saves", async () => {
    const { editor } = await renderImage();
    expect(serializeBlockNoteDocumentAssets(editor.document, () => "media/photo.jpg").blocks[0].props).not.toHaveProperty("presentationAxes");
    act(() => editor.updateBlock("image", { props: { presentationAxes: "exif" } }));
    expect(serializeBlockNoteDocumentAssets(editor.document, () => "media/photo.jpg").blocks[0].props.presentationAxes).toBe("exif");
    act(() => editor.updateBlock("image", { props: { presentationAxes: "raw" } }));
    expect(serializeBlockNoteDocumentAssets(editor.document, () => "media/photo.jpg").blocks[0].props.presentationAxes).toBe("raw");
  });

  it.each(["blur", "inactive"] as const)("cancels on %s before pointer release", async reason => {
    const { editor, handle, container } = await renderImage();
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 300, clientY: 100 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 340, clientY: 100 });
    if (reason === "blur") fireEvent(window, new Event("blur"));
    else container.setAttribute("inert", "");
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 360, clientY: 100 });
    expect(editor.getBlock("image")?.props).toMatchObject({ previewWidth: 300, previewHeight: 200 });
  });

  it("ignores secondary-button and unrelated-pointer resize events", async () => {
    const { editor, handle } = await renderImage();
    fireEvent.pointerDown(handle, { button: 2, pointerId: 1, clientX: 300, clientY: 100 });
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 340, clientY: 100 });
    expect(editor.getBlock("image")?.props).toMatchObject({ previewWidth: 300 });
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 300, clientY: 100 });
    fireEvent.pointerMove(document, { pointerId: 2, clientX: 380, clientY: 100 });
    fireEvent.pointerUp(document, { pointerId: 2, clientX: 380, clientY: 100 });
    expect(editor.getBlock("image")?.props).toMatchObject({ previewWidth: 300 });
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 360, clientY: 100 });
    expect(editor.getBlock("image")?.props).toMatchObject({ previewWidth: 360 });
  });

  it("keeps the gesture transient and records its final coordinates in one undo step", async () => {
    const { editor, handle } = await renderImage();
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 300, clientY: 100 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 320, clientY: 100 });
    expect(editor.getBlock("image")?.props).toMatchObject({ previewWidth: 300, previewHeight: 200 });
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 360, clientY: 100 });
    expect(editor.getBlock("image")?.props).toMatchObject({ previewWidth: 360, previewHeight: 200 });
    act(() => editor.undo());
    expect(editor.getBlock("image")?.props).toMatchObject({ previewWidth: 300, previewHeight: 200 });
    act(() => editor.redo());
    expect(editor.getBlock("image")?.props).toMatchObject({ previewWidth: 360, previewHeight: 200 });
  });
});
