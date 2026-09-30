// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../../app/theme/ThemeProvider";
import { createEmptyProjectPlanV15, type ProjectPlanV15 } from "../../../domain/plan/canvas/blockDocument";
import type { BlockNotePlanService } from "../../../domain/plan/blocknote/service";
import type { ImageClipboardContents, ImageClipboardInput, ImageClipboardPort } from "../../../domain/clipboard/imageClipboard";
import type { ImagePasteRepository } from "../../../domain/clipboard/projectImagePaste";
import { ImageClipboardContext } from "../ImageClipboardContext";
import { BlockNoteProjectCanvasProvider } from "./BlockNoteProjectCanvasProvider";
import type { PreshotBlockNoteEditor } from "./blockOperations";
import { closeHistory } from "prosemirror-history";

const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ/8AAAAASUVORK5CYII=";
const decode = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "decode");
beforeEach(() => {
  Object.defineProperty(HTMLImageElement.prototype, "decode", { configurable: true, value: async () => undefined });
  vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(1);
  vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(1);
  vi.stubEnv("VITE_WORKSPACE_ADAPTER", "memory");
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  if (decode) Object.defineProperty(HTMLImageElement.prototype, "decode", decode);
  else Reflect.deleteProperty(HTMLImageElement.prototype, "decode");
});

function currentEditor(): PreshotBlockNoteEditor {
  const editor = (window as typeof window & { __PRESHOT_BLOCKNOTE_EDITOR__?: PreshotBlockNoteEditor }).__PRESHOT_BLOCKNOTE_EDITOR__;
  if (!editor) throw new Error("Editor is not mounted");
  return editor;
}
function fixture(galleryKind: "imageGroup" | "prop" = "imageGroup", presentationAxes?: "exif") {
  let plan: ProjectPlanV15 = createEmptyProjectPlanV15("图片测试", { makeId: () => "intro" });
  plan.document.blocks.push(
    { id: "native", type: "image", props: { url: "media/original.png", name: "原图.png", caption: "保留图注", showPreview: true, previewWidth: 300, textAlignment: "left", backgroundColor: "default" }, content: undefined, children: [] },
    { id: "group", type: "imageGroup", props: { groupId: "gallery" }, content: undefined, children: [] },
  );
  plan.imageGroups.push({
    id: "gallery", type: "reference", name: "图片组", description: "", x: 0, width: 700, height: 240,
    images: [{ id: "source", file: "references/0001.png", aspectRatio: 1, frameWidth: 240, frameHeight: 240, sourceWidth: 1, sourceHeight: 1 }],
  });
  if (presentationAxes) {
    plan.schemaVersion = 18;
    plan.imageGroups[0].images[0].presentationAxes = presentationAxes;
  }
  if (galleryKind === "prop") {
    plan.artifacts.push({ id: "prop", kind: "prop", revision: 0, title: "透明伞", source: "拍摄道具",
      gallery: { id: "gallery", images: plan.imageGroups[0].images } });
    plan.imageGroups = [];
    plan.document.blocks[2] = { id: "group", type: "prop", props: { artifactId: "prop" }, content: undefined, children: [] };
  }
  let clipboard: ImageClipboardContents | null = null;
  const port: ImageClipboardPort = {
    availability: "test",
    write: vi.fn(async (image: ImageClipboardInput) => { clipboard = { original: structuredClone(image), renderedDataUrl: pixel, animated: false, external: false }; }),
    read: vi.fn(async () => clipboard), hasImage: vi.fn(async () => clipboard !== null),
  };
  let count = 1;
  const repository: ImagePasteRepository = {
    prepareImagePaste: vi.fn(async input => ({
      operationId: input.operationId, name: input.image.name, mimeType: input.image.mimeType,
      file: input.destination === "media" ? `media/copy-${++count}.png` : `references/${String(++count).padStart(4, "0")}.png`,
    })),
    commitImagePaste: vi.fn(async input => { expect(plan).toEqual(input.expectedPlan); plan = input.nextPlan; }),
    abortImagePaste: vi.fn(async () => undefined), getImagePasteStatus: vi.fn(async () => "committed" as const),
  };
  const service: BlockNotePlanService = {
    loadPlan: vi.fn(async () => ({ status: "loaded" as const, plan })), savePlan: vi.fn(async (_path, next) => { plan = next; }),
    loadImage: vi.fn(async () => pixel), loadMedia: vi.fn(async () => pixel),
    importMedia: vi.fn(), importImages: vi.fn(), commitImageCrop: vi.fn(),
    removeImage: vi.fn(), removeGroup: vi.fn(),
    purgeDetachedGroups: vi.fn(async () => undefined), purgeDetachedMedia: vi.fn(async () => undefined),
  };
  render(<ThemeProvider repository={{ read: vi.fn(async () => ({ theme: "light" as const })), write: vi.fn() }}>
    <ImageClipboardContext.Provider value={port}>
      <BlockNoteProjectCanvasProvider projectId="project" projectName="图片测试" projectPath="C:\\clipboard-test"
        service={service} imagePasteRepository={repository}
        logger={{ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }}
        picker={{ pickImageFile: vi.fn(), pickImageFiles: vi.fn() }}
        exporter={{ implementation: "react-pdf", export: vi.fn() }} saver={{ save: vi.fn() }}
        docxExporter={{ implementation: "blocknote-docx", export: vi.fn() }} docxSaver={{ save: vi.fn() }}
        longImageExporter={{ export: vi.fn() }} longImageSaver={{ save: vi.fn() }}
        projectDirectoryRevealer={{ revealProjectDirectory: vi.fn() }} />
    </ImageClipboardContext.Provider>
  </ThemeProvider>);
  return { port, repository, service, getPlan: () => plan };
}

async function copy(element: Element) {
  fireEvent.contextMenu(element, { clientX: 50, clientY: 50 });
  fireEvent.click(await screen.findByRole("menuitem", { name: /复制图片/ }));
  await screen.findByText(/已复制图片/);
}
async function paste(element: Element) {
  fireEvent.contextMenu(element, { clientX: 60, clientY: 60 });
  const action = await screen.findByRole("menuitem", { name: /粘贴图片/ });
  await waitFor(() => expect(action).toBeEnabled());
  fireEvent.click(action);
}

describe("production editor image clipboard integration", () => {
  it.each(["imageGroup", "prop"] as const)("copies oriented %s pixels without leaking original-file axes into the clipboard", async kind => {
    const context = fixture(kind, "exif");
    const source = await screen.findByRole("button", { name: "选择参考图 1" });
    await copy(source);
    expect(context.service.loadImage).toHaveBeenCalledWith("C:\\\\clipboard-test", "references/0001.png", "exif");
    const copied = vi.mocked(context.port.write).mock.calls[0][0];
    expect(copied.dataUrl).toBe(pixel);
    expect(copied.presentation).toMatchObject({ frameWidth: 240, frameHeight: 240, sourceWidth: 1, sourceHeight: 1 });
    expect(copied.presentation).not.toHaveProperty("presentationAxes");
    expect(copied.presentation).not.toHaveProperty("file");
    expect(copied.presentation).not.toHaveProperty("id");
    await paste(source);
    await waitFor(() => expect(context.repository.commitImagePaste).toHaveBeenCalledOnce());
    const saved = context.getPlan();
    const images = kind === "imageGroup" ? saved.imageGroups[0].images : saved.artifacts.find(artifact => artifact.kind === "prop")!.gallery!.images;
    expect(images[0].presentationAxes).toBe("exif");
    expect(images[1]).not.toHaveProperty("presentationAxes");
  });

  it("retains the mounted editor and prior history across schema-18 promotion and undo", async () => {
    const context = fixture();
    await screen.findByRole("button", { name: "选择参考图 1" });
    const editor = currentEditor();
    act(() => {
      editor.updateBlock("intro", { content: "导入图片前的文字" });
      editor.prosemirrorView.dispatch(closeHistory(editor.prosemirrorView.state.tr));
      editor.updateBlock("native", { props: { presentationAxes: "exif" } });
    });
    await waitFor(() => expect(currentEditor()).toBe(editor));
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(context.getPlan().schemaVersion).toBe(18));
    act(() => { editor.undo(); });
    expect(editor.getBlock("intro")?.content).toMatchObject([{ text: "导入图片前的文字" }]);
    expect(editor.getBlock("native")?.props).not.toMatchObject({ presentationAxes: "exif" });
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(context.getPlan().document.blocks.find(block => block.id === "native")?.props).not.toHaveProperty("presentationAxes"));
    expect(context.getPlan().schemaVersion).toBe(18);
    act(() => { editor.undo(); });
    expect(editor.getBlock("intro")?.content).toEqual([]);
    expect(currentEditor()).toBe(editor);
  });

  it.each(["imageGroup", "prop"] as const)("undoes %s fit changes before earlier resize without a history conflict", async kind => {
    fixture(kind);
    const handle = await screen.findByLabelText("从right调整参考图 1");
    const frame = handle.closest<HTMLElement>("[data-image-id]")!;
    const initialWidth = frame.style.width;
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    const resizedWidth = frame.style.width;
    expect(resizedWidth).not.toBe(initialWidth);
    fireEvent.click(screen.getByRole("button", { name: "切换参考图 1 为自由变形" }));
    expect(screen.getByRole("button", { name: "切换参考图 1 为裁切适配" })).toBeVisible();
    act(() => { currentEditor().undo(); });
    expect(screen.getByRole("button", { name: "切换参考图 1 为自由变形" })).toBeVisible();
    expect(frame.style.width).toBe(resizedWidth);
    act(() => { currentEditor().undo(); });
    expect(frame.style.width).toBe(initialWidth);
    act(() => { currentEditor().redo(); });
    expect(frame.style.width).toBe(resizedWidth);
    act(() => { currentEditor().redo(); });
    expect(screen.getByRole("button", { name: "切换参考图 1 为裁切适配" })).toBeVisible();
  });

  it("pastes independent group files and undoes/redoes without changing the source", async () => {
    const context = fixture();
    const source = await screen.findByRole("button", { name: "选择参考图 1" });
    await copy(source);
    await paste(source);
    await waitFor(() => expect(context.repository.commitImagePaste).toHaveBeenCalledOnce());
    await screen.findByRole("button", { name: "选择参考图 2" });
    const pasted = context.getPlan().imageGroups[0].images[1];
    expect(pasted.id).not.toBe("source");
    expect(pasted.file).not.toBe("references/0001.png");
    fireEvent.click(await screen.findByRole("button", { name: "撤销" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "选择参考图 2" })).not.toBeInTheDocument());
    act(() => { currentEditor().redo(); });
    await screen.findByRole("button", { name: "选择参考图 2" });
    expect(context.repository.prepareImagePaste).toHaveBeenCalledOnce();
  });

  it("does not offer an old paste undo after a newer text edit", async () => {
    const context = fixture();
    const source = await screen.findByRole("button", { name: "选择参考图 1" });
    await copy(source);
    await paste(source);
    await screen.findByRole("button", { name: "撤销" });
    act(() => { currentEditor().updateBlock("intro", { content: "粘贴后的新文字" }); });
    await waitFor(() => expect(screen.queryByRole("button", { name: "撤销" })).not.toBeInTheDocument());
    expect(context.getPlan().imageGroups[0].images).toHaveLength(2);
    expect(currentEditor().getBlock("intro")?.content).toEqual([{ type: "text", text: "粘贴后的新文字", styles: {} }]);
  });

  it("does not reclaim focus after a newer pointer interaction", async () => {
    fixture();
    await copy(await screen.findByRole("button", { name: "选择参考图 1" }));
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    try {
      await paste(screen.getByRole("button", { name: "选择参考图 1" }));
      await screen.findByRole("button", { name: "选择参考图 2" });
      const source = screen.getByRole("button", { name: "选择参考图 1" });
      fireEvent.pointerDown(source, { pointerId: 1, button: 0, isPrimary: true });
      source.focus();
      act(() => { vi.advanceTimersByTime(32); });
      expect(source).toHaveFocus();
    } finally { vi.useRealTimers(); }
  });

  it("persists two identical native images to different files after subsequent editor changes", async () => {
    const context = fixture();
    await screen.findByRole("group", { name: "方案正文" });
    const native = document.querySelector('[data-id="native"] [data-content-type="image"] img');
    if (!native) throw new Error("Native image is missing");
    await copy(native);
    await paste(native);
    await waitFor(() => expect(context.repository.commitImagePaste).toHaveBeenCalledOnce());
    const inserted = context.getPlan().document.blocks.find(block => block.type === "image" && block.id !== "native")!;
    expect(inserted.props.url).not.toBe("media/original.png");
    act(() => {
      currentEditor().updateBlock("intro", { content: "继续编辑正文" });
    });
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(context.getPlan().document.blocks[0].content).toEqual([{ type: "text", text: "继续编辑正文", styles: {} }]));
    expect(context.getPlan().document.blocks.find(block => block.id === inserted.id)?.props.url).toBe(inserted.props.url);
    expect(context.getPlan().document.blocks.find(block => block.id === "native")?.props.url).toBe("media/original.png");
  });
});
