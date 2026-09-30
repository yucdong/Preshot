// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../../app/theme/ThemeProvider";
import type { SettingsRepository } from "../../../domain/settings/ports";
import type { PreshotBlockDocument } from "../../../domain/plan/canvas/blockDocument";
import { validateBlockDocument } from "../../../domain/plan/canvas/blockDocument";
import type { MaterialEditorBridge } from "./MaterialEditorBridge";
import { BlockNoteDocumentEditor } from "./BlockNoteDocumentEditor";
import { ImageDragPreviewProvider } from "./ImageDragPreviewContext";
import {
  preshotBlockNoteSchema,
  type PreshotBlockNoteEditor,
} from "./preshotBlockNoteSchema";
import { ImageClipboardScope } from "./clipboard/ImageClipboardScope";
import { documentClipboardBridge, IMAGE_CLIPBOARD_HISTORY_CHANGE } from "./clipboard/imageClipboardDom";
import { ExternalImageHistoryStep } from "./clipboard/externalImageHistory";
import { undo } from "prosemirror-history";
import { startBlockPointerDrag } from "./blockPointerDrag";
import { SuggestionMenu } from "@blocknote/core/extensions";

const settings: SettingsRepository = {
  read: vi.fn().mockResolvedValue({ theme: "light" }),
  write: vi.fn().mockResolvedValue(undefined),
};

const document: PreshotBlockDocument = {
  format: "preshot-blocks",
  version: 5,
  blocks: [
    {
      id: "paragraph",
      type: "paragraph",
      props: {},
      content: [{ type: "text", text: "BlockNote canvas", styles: {} }],
      children: [],
    },
    {
      id: "image-group-block",
      type: "imageGroup",
      props: { groupId: "group-1" },
      content: undefined,
      children: [],
    },
  ],
};

describe("BlockNoteDocumentEditor", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("closes an open insert menu when its cached project becomes inactive", async () => {
    // jsdom's element rect lacks the toJSON method used by BlockNote.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 60, 400, 30));
    let editor!: PreshotBlockNoteEditor;
    const props = {
      ariaLabel: "缓存项目正文", document: { ...document, blocks: [document.blocks[0]] }, onChange: vi.fn(),
      onEditorReady: (value: PreshotBlockNoteEditor) => { editor = value; },
      artifactController: { createArtifact: () => "a", cloneArtifact: () => null, getArtifact: () => undefined,
        subscribe: () => () => undefined, updateArtifact: vi.fn() },
      imageGroupController: { createGroup: () => "g", cloneGroup: () => null, getGroup: () => undefined,
        subscribe: () => () => undefined, getImageSrc: () => undefined, addImages: vi.fn(),
        removeImage: vi.fn(), openImage: vi.fn(), setImageFrame: vi.fn(), moveImage: vi.fn() },
      persistMediaUrl: (url: string) => url, resolveMediaUrl: (url: string) => url, uploadFile: vi.fn(),
    };
    const view = (active: boolean) => <ThemeProvider repository={settings}>
      <BlockNoteDocumentEditor {...props} active={active} />
    </ThemeProvider>;
    const { rerender, unmount } = render(view(true));
    await waitFor(() => expect(editor).toBeDefined());
    const open = () => act(() => {
      editor.setTextCursorPosition("paragraph", "end");
      editor.getExtension(SuggestionMenu)!.openSuggestionMenu("/", { ignoreQueryLength: true });
    });
    open();
    await waitFor(() => expect(screen.getByRole("listbox")).toBeVisible());
    rerender(view(false));
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    rerender(view(true));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    open();
    await waitFor(() => expect(screen.getByRole("listbox")).toBeVisible());
    unmount();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("keeps block drag geometry in the active editor when a hidden project has the same block IDs", async () => {
    let editor!: PreshotBlockNoteEditor;
    const blocks = validateBlockDocument({
      format: "preshot-blocks", version: 5,
      blocks: ["source", "target"].map((id) => ({ id, type: "paragraph", props: {}, content: [{ type: "text", text: id, styles: {} }], children: [] })),
    });
    const props = {
      document: blocks, onChange: vi.fn(),
      artifactController: { createArtifact: () => "a", cloneArtifact: () => null, getArtifact: () => undefined,
        subscribe: () => () => undefined, updateArtifact: vi.fn() },
      imageGroupController: { createGroup: () => "g", cloneGroup: () => null, getGroup: () => undefined,
        subscribe: () => () => undefined, getImageSrc: () => undefined, addImages: vi.fn(),
        removeImage: vi.fn(), openImage: vi.fn(), setImageFrame: vi.fn(), moveImage: vi.fn() },
      persistMediaUrl: (url: string) => url, resolveMediaUrl: (url: string) => url, uploadFile: vi.fn(),
    };
    render(<ThemeProvider repository={settings}>
      <div hidden inert><BlockNoteDocumentEditor {...props} ariaLabel="后台项目" /></div>
      <BlockNoteDocumentEditor {...props} ariaLabel="当前项目" onEditorReady={(value) => { editor = value; }} />
    </ThemeProvider>);
    await waitFor(() => expect(editor).toBeDefined());
    const current = screen.getByRole("group", { name: "当前项目" });
    const target = current.querySelector<HTMLElement>('[data-node-type="blockOuter"][data-id="target"]')!;
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({ top: 100, bottom: 150, left: 0, right: 400, width: 400, height: 50, x: 0, y: 100, toJSON() {} });
    const hit = vi.spyOn(window.document, "elementFromPoint").mockReturnValue(target);
    act(() => startBlockPointerDrag({ editor, source: editor.getBlock("source")!, clientX: 0, clientY: 0 }));
    fireEvent.pointerMove(window.document, { clientX: 30, clientY: 110 });
    expect(target).toHaveAttribute("data-preshot-block-drop", "before");
    expect(current.querySelector('[data-id="source"][data-preshot-block-dragging]')).not.toBeNull();
    fireEvent.pointerUp(window.document, { clientX: 30, clientY: 110 });
    expect(editor.document.map((block) => block.id)).toEqual(["source", "target"]);
    hit.mockRestore();
  });

  it("defers pasted native selection until unlock and yields to newer user input", async () => {
    let editor!: PreshotBlockNoteEditor;
    let bridge!: MaterialEditorBridge;
    const planDocument = validateBlockDocument({
      format: "preshot-blocks", version: 5, blocks: [
        { id: "text", type: "paragraph", props: {}, content: [{ type: "text", text: "继续编辑", styles: {} }], children: [] },
        { id: "image", type: "image", props: { url: "media/image.png", name: "粘贴图片", caption: "", showPreview: true }, children: [] },
      ],
    });
    render(<ThemeProvider repository={settings}>
      <div data-testid="clipboard-lock">
        <BlockNoteDocumentEditor ariaLabel="延后聚焦正文" document={planDocument}
          artifactController={{ createArtifact: () => "a", cloneArtifact: () => null, getArtifact: () => undefined,
            subscribe: () => () => undefined, updateArtifact: vi.fn() }}
          imageGroupController={{ createGroup: () => "g", cloneGroup: () => null, getGroup: () => undefined,
            subscribe: () => () => undefined, getImageSrc: () => undefined, addImages: vi.fn(),
            removeImage: vi.fn(), openImage: vi.fn(), setImageFrame: vi.fn(), moveImage: vi.fn() }}
          onChange={vi.fn()} onEditorReady={(value) => { editor = value; }}
          onMaterialEditorReady={(value) => { bridge = value; return () => undefined; }}
          persistMediaUrl={(url) => url} resolveMediaUrl={(url) => url} uploadFile={vi.fn()} />
      </div>
      <button>其他操作</button>
    </ThemeProvider>);
    await waitFor(() => expect(bridge).toBeDefined());
    const lock = screen.getByTestId("clipboard-lock");
    act(() => {
      editor.setTextCursorPosition("text", "start");
      lock.setAttribute("inert", "");
      bridge.focusBlock("image");
    });
    expect(editor.prosemirrorView.state.selection.toJSON().type).toBe("text");
    await act(async () => lock.removeAttribute("inert"));
    await waitFor(() => expect(documentClipboardBridge(screen.getByRole("group", { name: "延后聚焦正文" }))
      ?.getNativeSelection()).toBe("image"));

    act(() => {
      editor.setTextCursorPosition("text", "start");
      lock.setAttribute("inert", "");
      bridge.focusBlock("image");
      fireEvent.pointerDown(screen.getByRole("button", { name: "其他操作" }));
    });
    await act(async () => lock.removeAttribute("inert"));
    expect(editor.prosemirrorView.state.selection.toJSON().type).toBe("text");
    expect(editor.getTextCursorPosition().block.id).toBe("text");
  });

  it("persists native copies with identical rendered URLs to their own block-specific media paths", async () => {
    let editor!: PreshotBlockNoteEditor;
    const onChange = vi.fn();
    const dataUrl = "data:image/png;base64,aWRlbnRpY2FsLWJ5dGVz";
    const persist = vi.fn((url: string, blockId?: string) => {
      if (url !== dataUrl) return url;
      return blockId === "copied-image" ? "media/copied.png" : "media/original.png";
    });
    const planDocument = validateBlockDocument({
      format: "preshot-blocks", version: 5, blocks: [
        { id: "text", type: "paragraph", props: {}, content: [{ type: "text", text: "初始正文", styles: {} }], children: [] },
        { id: "original-image", type: "image", props: { url: "media/original.png", name: "原图", caption: "", showPreview: true }, children: [] },
        { id: "copied-image", type: "image", props: { url: "media/copied.png", name: "复制图", caption: "", showPreview: true }, children: [] },
      ],
    });
    render(<ThemeProvider repository={settings}>
      <BlockNoteDocumentEditor ariaLabel="独立图片正文" document={planDocument}
        artifactController={{ createArtifact: () => "a", cloneArtifact: () => null, getArtifact: () => undefined,
          subscribe: () => () => undefined, updateArtifact: vi.fn() }}
        imageGroupController={{ createGroup: () => "g", cloneGroup: () => null, getGroup: () => undefined,
          subscribe: () => () => undefined, getImageSrc: () => undefined, addImages: vi.fn(),
          removeImage: vi.fn(), openImage: vi.fn(), setImageFrame: vi.fn(), moveImage: vi.fn() }}
        onChange={onChange} onEditorReady={(value) => { editor = value; }}
        persistMediaUrl={persist} resolveMediaUrl={(url) => url.startsWith("media/") ? dataUrl : url} uploadFile={vi.fn()} />
    </ThemeProvider>);
    await waitFor(() => expect(editor).toBeDefined());
    expect(screen.getByRole("img", { name: "原图" })).toHaveAttribute("src", dataUrl);
    expect(screen.getByRole("img", { name: "复制图" })).toHaveAttribute("src", dataUrl);
    await act(async () => { editor.updateBlock("text", { content: "触发保存的后续编辑" }); });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const saved = onChange.mock.calls.at(-1)![0] as PreshotBlockDocument;
    expect(saved.blocks.filter((block) => block.type === "image").map((block) => block.props.url))
      .toEqual(["media/original.png", "media/copied.png"]);
    expect(persist).toHaveBeenCalledWith(dataUrl, "original-image");
    expect(persist).toHaveBeenCalledWith(dataUrl, "copied-image");
  });

  it("interleaves gallery-only paste with real text history without speculative callbacks or document emissions", async () => {
    let editor!: PreshotBlockNoteEditor;
    let bridge!: MaterialEditorBridge;
    const onChange = vi.fn();
    const plain = validateBlockDocument({
      format: "preshot-blocks", version: 5,
      blocks: [{ id: "text", type: "paragraph", props: {}, content: [{ type: "text", text: "初始", styles: {} }], children: [] }],
    });
    const { unmount } = render(<ThemeProvider repository={settings}>
      <BlockNoteDocumentEditor ariaLabel="图片历史正文" document={plain}
        artifactController={{ createArtifact: () => "a", cloneArtifact: () => null, getArtifact: () => undefined,
          subscribe: () => () => undefined, updateArtifact: vi.fn() }}
        imageGroupController={{ createGroup: () => "g", cloneGroup: () => null, getGroup: () => undefined,
          subscribe: () => () => undefined, getImageSrc: () => undefined, addImages: vi.fn(),
          removeImage: vi.fn(), openImage: vi.fn(), setImageFrame: vi.fn(), moveImage: vi.fn() }}
        onChange={onChange} onEditorReady={(value) => { editor = value; }}
        onMaterialEditorReady={(value) => { bridge = value; return () => undefined; }}
        persistMediaUrl={(url) => url} resolveMediaUrl={(url) => url} uploadFile={vi.fn()} />
    </ThemeProvider>);
    await waitFor(() => expect(bridge).toBeDefined());
    const acceptedHistoryChange = vi.fn();
    editor.prosemirrorView.dom.addEventListener(IMAGE_CLIPBOARD_HISTORY_CHANGE, acceptedHistoryChange);
    await act(async () => { editor.updateBlock("text", { content: "之前编辑" }); });
    expect(acceptedHistoryChange).toHaveBeenCalledOnce();
    let images = ["pasted", "unrelated"];
    const entry = {
      undo: vi.fn(() => { images = images.filter((id) => id !== "pasted"); }),
      redo: vi.fn(() => { images = ["pasted", ...images]; }),
    };
    const beforeRecord = onChange.mock.calls.length;
    await act(async () => bridge.recordExternalHistory!(entry));
    expect(onChange).toHaveBeenCalledTimes(beforeRecord);
    expect(entry.redo).not.toHaveBeenCalled();
    const doc = editor.prosemirrorView.state.doc;
    const speculative = new ExternalImageHistoryStep(entry, "undo");
    expect(speculative.apply(doc).doc).toBe(doc);
    expect(editor.canExec(undo)).toBe(true);
    expect(entry.undo).not.toHaveBeenCalled();
    await act(async () => { editor.updateBlock("text", { content: "之后编辑" }); });
    await act(async () => { expect(editor.undo()).toBe(true); });
    expect(screen.getByText("之前编辑")).toBeVisible();
    expect(images).toEqual(["pasted", "unrelated"]);
    const beforeExternalUndo = onChange.mock.calls.length;
    const rejectUndo = editor.onBeforeChange(({ tr }) => !tr.steps.some((step) => step instanceof ExternalImageHistoryStep));
    const acceptedCount = acceptedHistoryChange.mock.calls.length;
    await act(async () => { editor.undo(); });
    expect(acceptedHistoryChange).toHaveBeenCalledTimes(acceptedCount);
    expect(entry.undo).not.toHaveBeenCalled();
    expect(images).toEqual(["pasted", "unrelated"]);
    rejectUndo();
    await act(async () => { bridge.undo!(); });
    expect(images).toEqual(["unrelated"]);
    expect(entry.undo).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledTimes(beforeExternalUndo);
    await act(async () => { expect(editor.undo()).toBe(true); });
    expect(screen.getByText("初始")).toBeVisible();
    await act(async () => { expect(editor.redo()).toBe(true); });
    expect(screen.getByText("之前编辑")).toBeVisible();
    const beforeExternalRedo = onChange.mock.calls.length;
    await act(async () => { expect(editor.redo()).toBe(true); });
    expect(images).toEqual(["pasted", "unrelated"]);
    expect(entry.redo).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledTimes(beforeExternalRedo);
    await act(async () => { expect(editor.redo()).toBe(true); });
    expect(screen.getByText("之后编辑")).toBeVisible();

    const reject = editor.onBeforeChange(({ tr }) => !tr.steps.some((step) => step instanceof ExternalImageHistoryStep));
    expect(() => bridge.recordExternalHistory!(entry)).toThrow("拒绝");
    expect(entry.redo).toHaveBeenCalledOnce();
    expect(entry.undo).toHaveBeenCalledOnce();
    reject();
    unmount();
    expect(() => bridge.recordExternalHistory!(entry)).toThrow("结束");
  });

  it("bridges only genuine native image selection and top-level user caret anchors", async () => {
    vi.stubGlobal("ClipboardEvent", class extends Event {
      readonly clipboardData: DataTransfer | null;
      constructor(type: string, init: ClipboardEventInit = {}) {
        super(type, init);
        this.clipboardData = init.clipboardData ?? null;
      }
    });
    let editor!: PreshotBlockNoteEditor;
    const dataUrl = "data:image/png;base64,aW1hZ2U=";
    const port = {
      availability: "test" as const,
      write: vi.fn().mockResolvedValue(undefined),
      read: vi.fn().mockResolvedValue({
        original: { dataUrl, name: "one.png" }, renderedDataUrl: dataUrl, animated: false, external: true,
      }),
      hasImage: vi.fn().mockResolvedValue(true),
    };
    const resolveImage = vi.fn().mockResolvedValue({ dataUrl, name: "one.png" });
    const pasteImage = vi.fn().mockResolvedValue(undefined);
    const uploadFile = vi.fn();
    const testDocument = validateBlockDocument({
      format: "preshot-blocks", version: 5, blocks: [
        { id: "top-row", type: "paragraph", props: {}, content: [{ type: "text", text: "顶层段落", styles: {} }],
          children: [{ id: "nested-row", type: "paragraph", props: {}, content: [{ type: "text", text: "嵌套段落", styles: {} }], children: [] }] },
        { id: "native-image", type: "image", props: { url: "media/one.png", name: "正文原图", caption: "", showPreview: true }, children: [] },
        { id: "last-row", type: "paragraph", props: {}, content: [{ type: "text", text: "末尾段落", styles: {} }], children: [] },
      ],
    });
    render(<ThemeProvider repository={settings}>
      <ImageClipboardScope port={port} resolveImage={resolveImage} pasteImage={pasteImage}>
        <BlockNoteDocumentEditor ariaLabel="图片剪贴板正文" document={testDocument}
          artifactController={{ createArtifact: () => "a", cloneArtifact: () => null, getArtifact: () => undefined,
            subscribe: () => () => undefined, updateArtifact: vi.fn() }}
          imageGroupController={{ createGroup: () => "g", cloneGroup: () => null, getGroup: () => undefined,
            subscribe: () => () => undefined, getImageSrc: () => undefined, addImages: vi.fn(),
            removeImage: vi.fn(), openImage: vi.fn(), setImageFrame: vi.fn(), moveImage: vi.fn() }}
          onChange={vi.fn()} onEditorReady={(value) => { editor = value; }}
          persistMediaUrl={(url) => url === dataUrl ? "media/one.png" : url}
          resolveMediaUrl={(url) => url === "media/one.png" ? dataUrl : url} uploadFile={uploadFile} />
      </ImageClipboardScope>
    </ThemeProvider>);
    await waitFor(() => expect(editor).toBeDefined());
    const root = screen.getByRole("group", { name: "图片剪贴板正文" });
    const bridge = documentClipboardBridge(root)!;
    expect(bridge.getAnchor()).toBeNull();
    expect(bridge.getNativeSelection()).toBeNull();
    const image = screen.getByRole("img", { name: "正文原图" });
    expect(bridge.resolveNativeImage(image)).toBe("native-image");
    const thumbnail = globalThis.document.createElement("img");
    root.appendChild(thumbnail);
    expect(bridge.resolveNativeImage(thumbnail)).toBeNull();
    thumbnail.remove();

    fireEvent.pointerDown(screen.getByText("嵌套段落"));
    fireEvent.pointerUp(screen.getByText("嵌套段落"));
    expect(bridge.getAnchor()).toBe("top-row");
    await act(async () => { editor.setTextCursorPosition("nested-row"); editor.focus(); });
    expect(bridge.getNativeSelection()).toBeNull();
    const ordinaryCopy = new Event("copy", { bubbles: true, cancelable: true });
    fireEvent(editor.prosemirrorView.dom, ordinaryCopy);
    expect(resolveImage).not.toHaveBeenCalled();

    fireEvent.contextMenu(image, { clientX: 50, clientY: 70 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "复制图片" }));
    await waitFor(() => expect(resolveImage).toHaveBeenCalledWith({ kind: "native", blockId: "native-image" }));
    await act(async () => { editor.setTextCursorPosition("native-image"); editor.focus(); });
    expect(bridge.getNativeSelection()).toBe("native-image");
    const copy = new Event("copy", { bubbles: true, cancelable: true });
    fireEvent(editor.prosemirrorView.dom, copy);
    await waitFor(() => expect(port.write).toHaveBeenCalledTimes(2));
    expect(copy.defaultPrevented).toBe(true);

    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: {
      types: ["Files"], getData: () => "", files: [new File(["image"], "external.png", { type: "image/png" })],
    } });
    fireEvent(editor.prosemirrorView.dom, paste);
    expect(paste.defaultPrevented).toBe(true);
    await waitFor(() => expect(pasteImage).toHaveBeenCalledOnce());
    expect(pasteImage.mock.calls[0][1]).toEqual({ kind: "document", afterBlockId: "native-image" });
    expect(uploadFile).not.toHaveBeenCalled();

    await act(async () => { editor.setSelection("top-row", "last-row"); editor.focus(); });
    expect(bridge.getNativeSelection()).toBeNull();
    const copyCount = resolveImage.mock.calls.length;
    const setData = vi.fn();
    const multiblockCopy = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(multiblockCopy, "clipboardData", { value: { setData, clearData: vi.fn() } });
    fireEvent(editor.prosemirrorView.dom, multiblockCopy);
    expect(resolveImage).toHaveBeenCalledTimes(copyCount);
    expect(setData).toHaveBeenCalled();

    await act(async () => { editor.setTextCursorPosition("nested-row"); editor.focus(); });
    const nestedPaste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(nestedPaste, "clipboardData", { value: {
      types: ["Files"], getData: () => "", files: [new File(["image"], "external.png", { type: "image/png" })],
    } });
    fireEvent(editor.prosemirrorView.dom, nestedPaste);
    await waitFor(() => expect(pasteImage).toHaveBeenCalledTimes(2));
    expect(pasteImage.mock.calls[1][1]).toEqual({ kind: "document", afterBlockId: "top-row" });
    const textPaste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(textPaste, "clipboardData", { value: {
      types: ["text/plain"], getData: (type: string) => type === "text/plain" ? "普通粘贴" : "",
      files: [], items: [],
    } });
    fireEvent(editor.prosemirrorView.dom, textPaste);
    await waitFor(() => expect(screen.getByText(/普通粘贴/)).toBeVisible());
    expect(pasteImage).toHaveBeenCalledTimes(2);
  });

  it("renders portable JSON blocks and the custom image-group block", async () => {
    let editor: PreshotBlockNoteEditor | undefined;
    let materialEditor: MaterialEditorBridge | undefined;
    let applyDocument:
      | ((document: PreshotBlockDocument) => void)
      | undefined;
    const onChange = vi.fn();
    const cloneGroup = vi.fn().mockReturnValue("group-copy");
    const imageGroup = {
      id: "group-1",
      name: "References",
      type: "reference" as const,
      x: 0,
      width: 400,
      height: 220,
      description: "",
      images: [],
    };
    const imageGroupController = {
      createGroup: () => "group-new",
      subscribe: () => () => undefined,
      cloneGroup,
      getGroup: (groupId: string) =>
        groupId === "group-1" ? imageGroup : undefined,
      getImageSrc: () => undefined,
      addImages: vi.fn(),
      captureImage: vi.fn(),
      removeImage: vi.fn(),
      openImage: vi.fn(),
      setImageFrame: vi.fn(),
      moveImage: vi.fn(),
    };
    const cloneArtifact = vi.fn().mockReturnValue("artifact-copy");
    const artifactController = {
      createArtifact: vi.fn().mockReturnValue("artifact-new"),
      cloneArtifact,
      getArtifact: vi.fn(),
      subscribe: () => () => undefined,
      updateArtifact: vi.fn(),
    };
    render(
      <ThemeProvider repository={settings}>
        <ImageDragPreviewProvider
          imageGroups={[imageGroup]}
          imageSources={{}}
          onMoveImage={imageGroupController.moveImage}
          planRevision={1}
          projectKey="document-editor-test"
        >
          <BlockNoteDocumentEditor
            ariaLabel="BlockNote 方案正文"
            artifactController={artifactController}
            document={document}
            imageGroupController={imageGroupController}
            onChange={onChange}
            onMaterialEditorReady={(bridge) => {
              materialEditor = bridge;
              applyDocument = bridge.applyDocument;
              return () => { materialEditor = undefined; };
            }}
            onEditorReady={(instance) => {
              editor = instance;
            }}
            persistMediaUrl={(url) => url}
            resolveMediaUrl={(url) => url}
            uploadFile={vi.fn()}
          />
        </ImageDragPreviewProvider>
      </ThemeProvider>,
    );

    expect(screen.getByRole("group", { name: "BlockNote 方案正文" }))
      .toHaveAttribute("data-editor-engine", "blocknote");
    expect(await screen.findByText("BlockNote canvas")).toBeVisible();
    expect(screen.getAllByRole("button", { name: "添加图片" })[0]).toBeVisible();

    await waitFor(() => expect(editor).toBeDefined());
    expect(editor!.schema).toBe(preshotBlockNoteSchema);
    expect(materialEditor!.getAnchor()).toBeNull();
    const clipboardBridge = documentClipboardBridge(screen.getByRole("group", { name: "BlockNote 方案正文" }))!;
    act(() => { editor!.setTextCursorPosition("image-group-block"); editor!.focus(); });
    expect(clipboardBridge.getSelectedComponent?.()).toHaveAttribute("data-clipboard-component", "group-1");
    act(() => {
      editor!._tiptapEditor.commands.selectAll();
      editor!.focus();
    });
    expect(clipboardBridge.getSelectedComponent?.()).toBeNull();
    act(() => { editor!.setTextCursorPosition("paragraph", "start"); editor!.focus(); });
    expect(clipboardBridge.getSelectedComponent?.()).toBeNull();
    const imageGroupBlock = editor!.document.find((block) => block.type === "imageGroup")!;
    editor!.setTextCursorPosition(imageGroupBlock);
    editor!.insertBlocks(
      [{ type: "imageGroup", props: { groupId: "group-1" } }],
      imageGroupBlock,
      "after",
    );
    await waitFor(() => {
      expect(cloneGroup).toHaveBeenCalledWith("group-1");
      expect(
        editor!.document
          .filter((block) => block.type === "imageGroup")
          .map((block) => block.props.groupId),
      ).toEqual(["group-1", "group-copy"]);
    });

    const copy = editor!.document.find(
      (block) => block.type === "imageGroup" && block.props.groupId === "group-copy",
    )!;
    editor!.removeBlocks([copy]);
    expect(editor!.document.filter((block) => block.type === "imageGroup"))
      .toHaveLength(1);
    expect(editor!.undo()).toBe(true);
    expect(editor!.document.filter((block) => block.type === "imageGroup"))
      .toHaveLength(2);

    const [artifactBlock] = editor!.insertBlocks(
      [{ type: "prop", props: { artifactId: "artifact-1" } }],
      imageGroupBlock,
      "after",
    );
    editor!.insertBlocks(
      [{ type: "prop", props: { artifactId: "artifact-1" } }],
      artifactBlock,
      "after",
    );
    await waitFor(() => {
      expect(cloneArtifact).toHaveBeenCalledWith("artifact-1");
      expect(
        editor!.document
          .filter((block) => block.type === "prop")
          .map((block) => block.props.artifactId),
      ).toEqual(["artifact-1", "artifact-copy"]);
    });

    const originalGroup = editor!.document.find(
      (block) => block.type === "imageGroup" && block.props.groupId === "group-1",
    )!;
    editor!.setTextCursorPosition(originalGroup);
    editor!.nestBlock();
    await waitFor(() => {
      expect(
        editor!.document.some((block) =>
          block.children.some((child) => child.type === "imageGroup"),
        ),
      ).toBe(false);
    });

    await waitFor(() => expect(materialEditor).toBeDefined());
    editor!.updateBlock("paragraph", { content: "Earlier edit" });
    const beforeMaterial = validateBlockDocument({
      format: "preshot-blocks",
      version: 5,
      blocks: JSON.parse(JSON.stringify(editor!.document)),
    });
    const insertedDocument: PreshotBlockDocument = {
      ...beforeMaterial,
      blocks: [...beforeMaterial.blocks, {
        id: "library-inserted-block",
        type: "paragraph",
        props: {},
        content: [{ type: "text", text: "Library insertion", styles: {} }],
        children: [],
      }],
    };
    await act(async () => {
      materialEditor!.applyDocument(insertedDocument);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(editor!.document.at(-1)?.id).toBe("library-inserted-block");
    expect(editor!.undo()).toBe(true);
    expect(editor!.getBlock("library-inserted-block")).toBeUndefined();
    expect(screen.getByText("Earlier edit")).toBeVisible();
    expect(editor!.redo()).toBe(true);
    expect(editor!.document.at(-1)?.id).toBe("library-inserted-block");

    await waitFor(() => expect(applyDocument).toBeDefined());
    const beforeTransaction = structuredClone(editor!.document);
    const changeCount = onChange.mock.calls.length;
    vi.spyOn(editor!, "replaceBlocks").mockImplementationOnce(() => {
      throw new Error("editor transaction failed");
    });
    expect(() => applyDocument!(document)).toThrow(
      "editor transaction failed",
    );
    expect(editor!.document).toEqual(beforeTransaction);
    expect(onChange).toHaveBeenCalledTimes(changeCount);
  });
});
