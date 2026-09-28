// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPortal } from "react-dom";
import type { ImageClipboardContents, ImageClipboardPort } from "../../../../domain/clipboard/imageClipboard";
import { LibraryDialog } from "../../../library/LibraryDialog";
import { componentTextInputEvents } from "../componentTextInput";
import { ImageClipboardScope } from "./ImageClipboardScope";
import { IMAGE_CLIPBOARD_HISTORY_CHANGE } from "./imageClipboardDom";

const contents: ImageClipboardContents = {
  original: { dataUrl: "data:image/png;base64,aW1hZ2U=", name: "参考.png" },
  renderedDataUrl: "data:image/png;base64,aW1hZ2U=",
  animated: false,
  external: false,
};

function makePort(overrides: Partial<ImageClipboardPort> = {}): ImageClipboardPort {
  return {
    availability: "test",
    write: vi.fn().mockResolvedValue(undefined),
    read: vi.fn().mockResolvedValue(contents),
    hasImage: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function clipboardEvent(target: Element, type: "copy" | "paste", values: Record<string, string> = {}, files: File[] = []) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: {
    types: [...Object.keys(values), ...(files.length ? ["Files"] : [])],
    files,
    items: files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })),
    getData: (format: string) => values[format] ?? "",
  } });
  fireEvent(target, event);
  return event;
}

function Gallery({ id = "group" }: { id?: string }) {
  return <div data-clipboard-gallery={id} tabIndex={-1}>
    <h3 tabIndex={0}>图片组 {id}</h3>
    <button data-image-clipboard-id="one" data-image-group-id={id}>图片 {id}</button>
    <input aria-label={`名称 ${id}`} {...componentTextInputEvents} />
  </div>;
}

function setup(props: Partial<React.ComponentProps<typeof ImageClipboardScope>> = {}) {
  const port = makePort();
  const resolveImage = vi.fn().mockResolvedValue(contents.original);
  const pasteImage = vi.fn().mockResolvedValue(undefined);
  const onUndo = vi.fn();
  const result = render(<ImageClipboardScope port={port} resolveImage={resolveImage}
    pasteImage={pasteImage} onUndo={onUndo} {...props}>
    <Gallery />
    <div data-clipboard-document="" contentEditable suppressContentEditableWarning tabIndex={0}>正文段落</div>
  </ImageClipboardScope>);
  return { ...result, port, resolveImage, pasteImage, onUndo };
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
});

describe("ImageClipboardScope", () => {
  it.each(["shootingLocation", "modelCard", "clothing", "prop", "imageGroup"])(
    "selects a %s component without stealing text or image interactions",
    async (kind) => {
      const pasteImage = vi.fn().mockResolvedValue(undefined);
      render(<ImageClipboardScope port={makePort()} resolveImage={() => contents.original} pasteImage={pasteImage}>
        <div data-clipboard-document="">
          <section data-clipboard-component={kind} data-clipboard-component-label={kind} tabIndex={0}>
            <header>{kind}</header><Gallery id={kind} />
          </section>
          <p tabIndex={0}>正文</p>
        </div>
      </ImageClipboardScope>);
      const header = screen.getByText(kind, { selector: "header" });
      const component = header.closest("section")!;
      fireEvent.mouseDown(header, { button: 0 });
      expect(component).toHaveFocus();
      expect(component).toHaveAttribute("data-clipboard-component-selected");
      expect(component.querySelector("[data-clipboard-gallery]")).toHaveAttribute("data-clipboard-paste-target");
      clipboardEvent(component, "paste", { "Preshot.Image.v1": "" });
      await waitFor(() => expect(pasteImage).toHaveBeenCalledWith(contents, {
        kind: "gallery", groupId: kind, afterImageId: null,
      }));
      const field = screen.getByRole("textbox");
      act(() => field.focus());
      expect(component).not.toHaveAttribute("data-clipboard-component-selected");
      expect(clipboardEvent(field, "paste", { "text/plain": "文本" }).defaultPrevented).toBe(false);
      expect(pasteImage).toHaveBeenCalledOnce();
      act(() => screen.getByText("正文").focus());
      clipboardEvent(screen.getByText("正文"), "paste", { "Preshot.Image.v1": "" });
      await waitFor(() => expect(pasteImage).toHaveBeenLastCalledWith(contents, {
        kind: "document", afterBlockId: null,
      }));
    },
  );

  it("rejects a selected component with a missing gallery instead of allowing native document insertion", async () => {
    const pasteImage = vi.fn();
    const port = makePort();
    render(<ImageClipboardScope port={port} resolveImage={() => contents.original} pasteImage={pasteImage}>
      <div data-clipboard-document=""><section tabIndex={0} data-clipboard-component="missing">组件</section></div>
    </ImageClipboardScope>);
    const component = screen.getByText("组件");
    component.focus();
    expect(clipboardEvent(component, "paste", { "Preshot.Image.v1": "" }).defaultPrevented).toBe(true);
    expect(await screen.findByRole("status")).toHaveTextContent("图片区域");
    expect(pasteImage).not.toHaveBeenCalled();
    expect(port.read).not.toHaveBeenCalled();
  });

  it("copies only a currently focused image at the native event boundary", async () => {
    const { port, resolveImage } = setup();
    const tile = screen.getByRole("button", { name: "图片 group" });
    tile.focus();
    fireEvent.keyDown(tile, { key: "c", ctrlKey: true });
    expect(port.write).not.toHaveBeenCalled();
    expect(clipboardEvent(tile, "copy").defaultPrevented).toBe(true);
    await waitFor(() => expect(port.write).toHaveBeenCalledOnce());
    expect(resolveImage).toHaveBeenCalledWith({ kind: "gallery", groupId: "group", imageId: "one" });
    expect(await screen.findByRole("status")).toHaveTextContent("已复制图片");
    screen.getByRole("textbox").focus();
    expect(clipboardEvent(screen.getByRole("textbox"), "copy").defaultPrevented).toBe(false);
    expect(port.write).toHaveBeenCalledOnce();
  });

  it("captures the actual right-clicked image and gallery append target", async () => {
    const { resolveImage, pasteImage } = setup();
    const tile = screen.getByRole("button", { name: "图片 group" });
    fireEvent.contextMenu(tile, { clientX: 30, clientY: 40 });
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["复制图片", "粘贴图片"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "复制图片" }));
    await waitFor(() => expect(resolveImage).toHaveBeenCalledOnce());
    expect(tile).toHaveFocus();
    fireEvent.contextMenu(screen.getByRole("heading"));
    const paste = await screen.findByRole("menuitem", { name: "粘贴图片" });
    await waitFor(() => expect(paste).not.toBeDisabled());
    fireEvent.click(paste);
    await waitFor(() => expect(pasteImage).toHaveBeenCalledWith(contents, { kind: "gallery", groupId: "group", afterImageId: null }));
  });

  it("pastes once after a tile, announces the destination and supports Undo", async () => {
    const { pasteImage, port, onUndo } = setup();
    const tile = screen.getByRole("button", { name: "图片 group" });
    tile.focus();
    fireEvent.keyDown(tile, { key: "v", ctrlKey: true });
    expect(port.read).not.toHaveBeenCalled();
    const event = clipboardEvent(tile, "paste", {}, [new File(["bytes"], "image.png", { type: "image/png" })]);
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(pasteImage).toHaveBeenCalledWith(contents, { kind: "gallery", groupId: "group", afterImageId: "one" }));
    expect(port.read).toHaveBeenCalledOnce();
    expect(await screen.findByRole("status")).toHaveTextContent("已粘贴图片到图片组");
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(onUndo).toHaveBeenCalledOnce();
  });

  it("measures the unzoomed gallery content width instead of a stored width or transformed bounds", async () => {
    const { pasteImage } = setup();
    const tile = screen.getByRole("button", { name: "图片 group" });
    const gallery = tile.closest<HTMLElement>("[data-clipboard-gallery]")!;
    gallery.style.paddingLeft = "12px";
    gallery.style.paddingRight = "8px";
    gallery.dataset.clipboardGalleryWidth = "900";
    Object.defineProperty(gallery, "clientWidth", { configurable: true, value: 360 });
    vi.spyOn(gallery, "getBoundingClientRect").mockReturnValue({ width: 720 } as DOMRect);
    tile.focus();
    clipboardEvent(tile, "paste");
    await waitFor(() => expect(pasteImage).toHaveBeenCalledWith(contents, {
      kind: "gallery", groupId: "group", afterImageId: "one", maxFrameWidth: 340,
    }));
    const paddedRegion = document.createElement("div");
    paddedRegion.dataset.clipboardGallery = "group";
    paddedRegion.style.padding = "10px";
    Object.defineProperty(paddedRegion, "clientWidth", { value: 300 });
    gallery.appendChild(paddedRegion);
    screen.getByRole("heading").focus();
    clipboardEvent(screen.getByRole("heading"), "paste");
    await waitFor(() => expect(pasteImage).toHaveBeenLastCalledWith(contents, {
      kind: "gallery", groupId: "group", afterImageId: null, maxFrameWidth: 280,
    }));
  });

  it.each([undefined, 0, 16, 31, 32, 120])("omits unsupported gallery width %s and only supplies widths of at least 32px", async (width) => {
    const { pasteImage } = setup();
    const tile = screen.getByRole("button", { name: "图片 group" });
    Object.defineProperty(tile.closest("[data-clipboard-gallery]")!, "clientWidth", { value: width });
    tile.focus();
    clipboardEvent(tile, "paste");
    await waitFor(() => expect(pasteImage).toHaveBeenCalledOnce());
    const target = pasteImage.mock.calls[0][1];
    if (width !== undefined && width >= 32) expect(target.maxFrameWidth).toBe(width);
    else expect(target).not.toHaveProperty("maxFrameWidth");
  });

  it("keeps an in-flight paste and its receipt through parent busy rerenders with fresh callbacks", async () => {
    let complete!: () => void;
    const exactUndo = vi.fn();
    const firstPaste = vi.fn(() => new Promise<{ undo(): void }>((resolve) => {
      complete = () => resolve({ undo: exactUndo });
    }));
    const newerPaste = vi.fn();
    const { port, rerender } = setup({ pasteImage: firstPaste });
    const tile = screen.getByRole("button", { name: "图片 group" });
    tile.focus();
    clipboardEvent(tile, "paste");
    await waitFor(() => expect(firstPaste).toHaveBeenCalledOnce());
    rerender(<ImageClipboardScope port={port} resolveImage={async () => contents.original}
      pasteImage={newerPaste} disabled={false} onUndo={vi.fn()}><Gallery /></ImageClipboardScope>);
    expect(screen.getByRole("status")).toHaveTextContent("正在粘贴");
    await act(async () => complete());
    expect(screen.getByRole("status")).toHaveTextContent("已粘贴图片");
    expect(port.read).toHaveBeenCalledOnce();
    expect(newerPaste).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(exactUndo).toHaveBeenCalledOnce();
  });

  it("keeps an in-flight source resolution through parent callback rerenders", async () => {
    let complete!: () => void;
    const firstResolve = vi.fn(() => new Promise<typeof contents.original>((resolve) => {
      complete = () => resolve(contents.original);
    }));
    const newerResolve = vi.fn();
    const { port, rerender } = setup({ resolveImage: firstResolve });
    const tile = screen.getByRole("button", { name: "图片 group" });
    tile.focus();
    clipboardEvent(tile, "copy");
    expect(firstResolve).toHaveBeenCalledOnce();
    rerender(<ImageClipboardScope port={port} resolveImage={newerResolve}
      pasteImage={async () => undefined} disabled={false}><Gallery /></ImageClipboardScope>);
    await act(async () => complete());
    expect(port.write).toHaveBeenCalledExactlyOnceWith(contents.original);
    expect(newerResolve).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("已复制图片");
  });

  it("keeps the completed paste's exact Undo callback instead of a newer prop callback", async () => {
    const originalUndo = vi.fn(), newerUndo = vi.fn(), exactUndo = vi.fn();
    const { port, resolveImage, pasteImage, rerender } = setup({ onUndo: originalUndo });
    const tile = screen.getByRole("button", { name: "图片 group" });
    tile.focus();
    clipboardEvent(tile, "paste");
    await screen.findByRole("button", { name: "撤销" });
    rerender(<ImageClipboardScope port={port} resolveImage={resolveImage} pasteImage={pasteImage} onUndo={newerUndo}><Gallery /></ImageClipboardScope>);
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(originalUndo).toHaveBeenCalledOnce();
    expect(newerUndo).not.toHaveBeenCalled();

    pasteImage.mockResolvedValueOnce({ undo: exactUndo });
    screen.getByRole("button", { name: "图片 group" }).focus();
    clipboardEvent(screen.getByRole("button", { name: "图片 group" }), "paste");
    fireEvent.click(await screen.findByRole("button", { name: "撤销" }));
    expect(exactUndo).toHaveBeenCalledOnce();
    expect(newerUndo).not.toHaveBeenCalled();
    pasteImage.mockResolvedValueOnce({});
    screen.getByRole("button", { name: "图片 group" }).focus();
    clipboardEvent(screen.getByRole("button", { name: "图片 group" }), "paste");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已粘贴"));
    expect(screen.queryByRole("button", { name: "撤销" })).toBeNull();
  });

  it.each(["pointer", "keyboard", "input", "paste", "history"])(
    "removes stale toast Undo after %s content interaction without hijacking native editing",
    async (interaction) => {
      const { onUndo } = setup();
      const tile = screen.getByRole("button", { name: "图片 group" });
      tile.focus();
      clipboardEvent(tile, "paste");
      await screen.findByRole("button", { name: "撤销" });
      const field = screen.getByRole("textbox");
      if (interaction === "pointer") fireEvent.pointerDown(field, { button: 0 });
      if (interaction === "keyboard") {
        expect(fireEvent.keyDown(field, { key: "z", ctrlKey: true })).toBe(true);
      }
      if (interaction === "input") fireEvent.input(field, { target: { value: "后来的编辑" } });
      if (interaction === "paste") {
        expect(clipboardEvent(field, "paste", { "text/plain": "后来的编辑" }).defaultPrevented).toBe(false);
      }
      if (interaction === "history") {
        fireEvent(screen.getByText("正文段落"), new Event(IMAGE_CLIPBOARD_HISTORY_CHANGE, { bubbles: true }));
      }
      expect(screen.queryByRole("button", { name: "撤销" })).toBeNull();
      expect(onUndo).not.toHaveBeenCalled();
      expect(screen.getByRole("status")).toHaveTextContent("已粘贴图片");
    },
  );

  it("keeps Undo keyboard-accessible but never revives it after an interaction during pending paste", async () => {
    let complete!: () => void;
    const pasteImage = vi.fn(() => new Promise<void>((resolve) => { complete = resolve; }));
    const { onUndo, rerender, port, resolveImage } = setup({ pasteImage });
    const tile = screen.getByRole("button", { name: "图片 group" });
    tile.focus();
    clipboardEvent(tile, "paste");
    await waitFor(() => expect(pasteImage).toHaveBeenCalledOnce());
    fireEvent.input(screen.getByRole("textbox"), { target: { value: "更新" } });
    await act(async () => complete());
    expect(screen.queryByRole("button", { name: "撤销" })).toBeNull();

    rerender(<ImageClipboardScope port={port} resolveImage={resolveImage} pasteImage={async () => {
      fireEvent(screen.getByRole("button", { name: "图片 group" }), new Event(IMAGE_CLIPBOARD_HISTORY_CHANGE, { bubbles: true }));
    }} onUndo={onUndo}>
      <Gallery />
    </ImageClipboardScope>);
    const nextTile = screen.getByRole("button", { name: "图片 group" });
    nextTile.focus();
    clipboardEvent(nextTile, "paste");
    const undo = await screen.findByRole("button", { name: "撤销" });
    fireEvent.keyDown(nextTile, { key: "Tab" });
    undo.focus();
    fireEvent.pointerDown(undo, { button: 0 });
    fireEvent.pointerUp(undo);
    fireEvent.click(undo);
    expect(onUndo).toHaveBeenCalledOnce();
  });

  it("handles only explicitly marked read-only portal images in the nearest React scope", async () => {
    const outerPort = makePort(), viewerPort = makePort();
    const resolveImage = vi.fn().mockResolvedValue(contents.original);
    const { container } = render(<ImageClipboardScope port={outerPort} resolveImage={resolveImage}>
      <ImageClipboardScope port={viewerPort} resolveImage={resolveImage}>
        {createPortal(<div role="dialog" aria-label="只读图片查看器">
          <button data-clipboard-gallery="viewer-group" data-image-clipboard-id="viewer-image">查看器图片</button>
          <button>组件缩略图</button>
          <input aria-label="查看器文本" {...componentTextInputEvents} />
        </div>, document.body)}
      </ImageClipboardScope>
    </ImageClipboardScope>);
    container.setAttribute("inert", "");
    const tile = screen.getByRole("button", { name: "查看器图片" });
    tile.focus();
    expect(clipboardEvent(tile, "copy").defaultPrevented).toBe(true);
    await waitFor(() => expect(viewerPort.write).toHaveBeenCalledOnce());
    expect(screen.getByRole("dialog")).toContainElement(screen.getByRole("status"));
    expect(resolveImage).toHaveBeenCalledWith({ kind: "gallery", groupId: "viewer-group", imageId: "viewer-image" });
    expect(outerPort.write).not.toHaveBeenCalled();
    fireEvent.keyDown(tile, { key: "ContextMenu" });
    const menu = await screen.findByRole("menu");
    expect(screen.getByRole("dialog")).toContainElement(menu);
    expect(within(menu).queryByRole("menuitem", { name: "粘贴图片" })).toBeNull();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(tile).toHaveFocus();
    fireEvent.contextMenu(tile);
    fireEvent.click(await screen.findByRole("menuitem", { name: "复制图片" }));
    await waitFor(() => expect(viewerPort.write).toHaveBeenCalledTimes(2));
    const thumbnail = screen.getByRole("button", { name: "组件缩略图" });
    thumbnail.focus();
    expect(clipboardEvent(thumbnail, "copy").defaultPrevented).toBe(false);
    expect(viewerPort.write).toHaveBeenCalledTimes(2);
    const field = screen.getByRole("textbox", { name: "查看器文本" });
    field.focus();
    expect(clipboardEvent(field, "paste", { "text/plain": "文本" }).defaultPrevented).toBe(false);
  });

  it("keeps text input clipboard and IME native, explaining image-only field paste", async () => {
    const { port, pasteImage } = setup();
    const field = screen.getByRole("textbox");
    field.focus();
    expect(clipboardEvent(field, "paste", { "text/plain": "原生文本" }).defaultPrevented).toBe(false);
    expect(clipboardEvent(field, "copy").defaultPrevented).toBe(false);
    clipboardEvent(field, "paste", {}, [new File(["bytes"], "one.png", { type: "image/png" })]);
    expect(await screen.findByRole("status")).toHaveTextContent("请先选择图片区域");
    expect(port.read).not.toHaveBeenCalled();
    expect(pasteImage).not.toHaveBeenCalled();
    const tile = screen.getByRole("button", { name: "图片 group" });
    tile.focus();
    fireEvent.compositionStart(tile);
    expect(clipboardEvent(tile, "copy").defaultPrevented).toBe(false);
    fireEvent.compositionEnd(tile);
  });

  it("does not hijack rich text, multiblock data, remote image HTML or text selections", () => {
    const { port } = setup();
    const text = screen.getByText("正文段落");
    text.focus();
    const file = new File(["bytes"], "one.png", { type: "image/png" });
    const ordinaryPayloads: Record<string, string>[] = [
      { "text/plain": "正文", "text/html": "<p>正文</p><img src='file:x'>" },
      { "text/html": "<div data-node-type='blockContainer'>one</div><div data-node-type='blockContainer'>two</div>" },
      { "text/html": "<img src='https://example.invalid/a.png'>" },
    ];
    for (const data of ordinaryPayloads) {
      expect(clipboardEvent(text, "paste", data).defaultPrevented).toBe(false);
    }
    expect(clipboardEvent(text, "paste", { "text/plain": "正文", "text/html": "<p>正文</p>" }, [file]).defaultPrevented).toBe(false);
    const range = document.createRange();
    range.selectNodeContents(text);
    window.getSelection()!.addRange(range);
    expect(clipboardEvent(text, "copy").defaultPrevented).toBe(false);
    const tile = screen.getByRole("button", { name: "图片 group" });
    tile.focus();
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    expect(clipboardEvent(tile, "copy").defaultPrevented).toBe(false);
    expect(port.read).not.toHaveBeenCalled();
    expect(port.write).not.toHaveBeenCalled();
  });

  it("captures a document anchor before portal focus and preserves null as prepend", async () => {
    let anchor: string | null = "top-level";
    const { pasteImage } = setup({ getDocumentAnchor: () => anchor });
    const text = screen.getByText("正文段落");
    text.focus();
    fireEvent.contextMenu(text);
    anchor = "changed-after-focus";
    const paste = await screen.findByRole("menuitem", { name: "粘贴图片" });
    await waitFor(() => expect(paste).not.toBeDisabled());
    fireEvent.click(paste);
    await waitFor(() => expect(pasteImage).toHaveBeenLastCalledWith(contents, { kind: "document", afterBlockId: "top-level" }));
    anchor = null;
    text.focus();
    clipboardEvent(text, "paste", {}, [new File(["b"], "a.png", { type: "image/png" })]);
    await waitFor(() => expect(pasteImage).toHaveBeenLastCalledWith(contents, { kind: "document", afterBlockId: null }));
  });

  it("has one dispatcher per nested scope and excludes unowned nested dialogs", async () => {
    const outer = makePort(), inner = makePort();
    render(<ImageClipboardScope port={outer} resolveImage={() => contents.original}>
      <Gallery id="outer" />
      <ImageClipboardScope port={inner} resolveImage={() => contents.original}><Gallery id="inner" /></ImageClipboardScope>
      <div role="dialog"><Gallery id="dialog" /></div>
    </ImageClipboardScope>);
    const tile = screen.getByRole("button", { name: "图片 inner" });
    tile.focus();
    clipboardEvent(tile, "copy");
    await waitFor(() => expect(inner.write).toHaveBeenCalledOnce());
    expect(outer.write).not.toHaveBeenCalled();
    const dialogTile = screen.getByRole("button", { name: "图片 dialog" });
    dialogTile.focus();
    clipboardEvent(dialogTile, "copy");
    expect(outer.write).not.toHaveBeenCalled();
  });

  it("portals into a LibraryDialog, supports keyboard menu navigation and restores focus", async () => {
    const close = vi.fn();
    render(<LibraryDialog title="编辑素材" onClose={close}>
      <ImageClipboardScope port={makePort()} resolveImage={() => contents.original}>
        <Gallery />
      </ImageClipboardScope>
    </LibraryDialog>);
    const tile = screen.getByRole("button", { name: "图片 group" });
    tile.focus();
    fireEvent.keyDown(tile, { key: "F10", shiftKey: true });
    const menu = await screen.findByRole("menu");
    expect(screen.getByRole("dialog")).toContainElement(menu);
    expect(within(menu).queryByRole("menuitem", { name: "粘贴图片" })).toBeNull();
    expect(within(menu).getByRole("menuitem", { name: "复制图片" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(tile).toHaveFocus();
    expect(close).not.toHaveBeenCalled();
  });

  it("guards busy/repeat requests and displays actionable failures", async () => {
    let finish!: () => void;
    const port = makePort({ read: vi.fn(() => new Promise<ImageClipboardContents>((resolve) => { finish = () => resolve(contents); })) });
    const pasteImage = vi.fn().mockRejectedValue(new Error("磁盘空间不足"));
    setup({ port, pasteImage });
    const tile = screen.getByRole("button", { name: "图片 group" });
    tile.focus();
    clipboardEvent(tile, "paste");
    clipboardEvent(tile, "paste");
    expect(port.read).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent("正在");
    await act(async () => finish());
    expect(await screen.findByRole("alert")).toHaveTextContent("磁盘空间不足");
    expect(pasteImage).toHaveBeenCalledOnce();
    expect(fireEvent.keyDown(tile, { key: "v", ctrlKey: true, repeat: true })).toBe(false);
  });

  it("does not publish a late clipboard read after unmount", async () => {
    let finish!: () => void;
    const port = makePort({ read: vi.fn(() => new Promise<ImageClipboardContents>((resolve) => { finish = () => resolve(contents); })) });
    const { unmount, pasteImage } = setup({ port });
    const tile = screen.getByRole("button", { name: "图片 group" });
    tile.focus();
    clipboardEvent(tile, "paste");
    unmount();
    await act(async () => finish());
    expect(pasteImage).not.toHaveBeenCalled();
  });

  it("blocks clipboard operations during a resize/drag and while disabled", async () => {
    const { port, rerender, resolveImage, pasteImage } = setup();
    const tile = screen.getByRole("button", { name: "图片 group" });
    tile.focus();
    fireEvent.pointerDown(tile, { button: 0 });
    expect(clipboardEvent(tile, "copy").defaultPrevented).toBe(true);
    expect(clipboardEvent(tile, "paste").defaultPrevented).toBe(true);
    expect(port.read).not.toHaveBeenCalled();
    expect(port.write).not.toHaveBeenCalled();
    fireEvent.pointerUp(tile);
    tile.closest("[data-clipboard-gallery]")!.setAttribute("data-clipboard-gesture", "true");
    expect(clipboardEvent(tile, "copy").defaultPrevented).toBe(true);
    tile.closest("[data-clipboard-gallery]")!.removeAttribute("data-clipboard-gesture");
    rerender(<ImageClipboardScope port={port} resolveImage={resolveImage} pasteImage={pasteImage} disabled>
      <Gallery />
    </ImageClipboardScope>);
    clipboardEvent(screen.getByRole("button", { name: "图片 group" }), "paste");
    expect(await screen.findByRole("status")).toHaveTextContent("暂不可用");
    expect(port.read).not.toHaveBeenCalled();
  });

  it("clamps the menu, navigates enabled items and runs keyboard Enter only once", async () => {
    const { port } = setup();
    const tile = screen.getByRole("button", { name: "图片 group" });
    tile.focus();
    fireEvent.contextMenu(tile, { clientX: 9_999, clientY: 9_999 });
    const menu = await screen.findByRole("menu");
    expect(parseFloat(menu.style.left)).toBeLessThan(window.innerWidth);
    expect(parseFloat(menu.style.top)).toBeLessThan(window.innerHeight);
    const paste = within(menu).getByRole("menuitem", { name: "粘贴图片" });
    await waitFor(() => expect(paste).not.toBeDisabled());
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(paste).toHaveFocus();
    fireEvent.keyDown(paste, { key: "ArrowUp" });
    expect(within(menu).getByRole("menuitem", { name: "复制图片" })).toHaveFocus();
    // jsdom has no native button keyboard activation; the click is its platform default.
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    fireEvent.click(document.activeElement!);
    await waitFor(() => expect(port.write).toHaveBeenCalledOnce());
  });

  it("invalidates a pending read across disabled/retiring transitions", async () => {
    let finish!: () => void;
    const port = makePort({ read: vi.fn(() => new Promise<ImageClipboardContents>((resolve) => { finish = () => resolve(contents); })) });
    const { rerender, pasteImage, resolveImage } = setup({ port });
    const tile = screen.getByRole("button", { name: "图片 group" });
    tile.focus();
    clipboardEvent(tile, "paste");
    rerender(<ImageClipboardScope port={port} resolveImage={resolveImage} pasteImage={pasteImage} disabled><Gallery /></ImageClipboardScope>);
    rerender(<ImageClipboardScope port={port} resolveImage={resolveImage} pasteImage={pasteImage}><Gallery /></ImageClipboardScope>);
    await act(async () => finish());
    expect(pasteImage).not.toHaveBeenCalled();
  });

  it("confirms first-frame conversion before an animated gallery paste and cancels without mutation", async () => {
    const animated = { ...contents, animated: true };
    const port = makePort({ read: vi.fn().mockResolvedValue(animated) });
    const { pasteImage } = setup({ port });
    const tile = screen.getByRole("button", { name: "图片 group" });
    tile.focus();
    clipboardEvent(tile, "paste");
    const dialog = await screen.findByRole("dialog", { name: /动态图.*第一帧/ });
    expect(pasteImage).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(pasteImage).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("已取消");

    tile.focus();
    clipboardEvent(tile, "paste");
    const confirmation = await screen.findByRole("dialog", { name: /动态图.*第一帧/ });
    fireEvent.click(within(confirmation).getByRole("button", { name: "转换为静态图片并粘贴" }));
    await waitFor(() => expect(pasteImage).toHaveBeenCalledOnce());
    expect(pasteImage).toHaveBeenCalledWith(animated, { kind: "gallery", groupId: "group", afterImageId: "one" });
    expect(port.read).toHaveBeenCalledTimes(2);
  });

  it("preserves animated native-image paste and retires an open gallery confirmation safely", async () => {
    const animated = { ...contents, animated: true };
    const port = makePort({ read: vi.fn().mockResolvedValue(animated) });
    const { pasteImage, unmount } = setup({ port });
    const text = screen.getByText("正文段落");
    text.focus();
    clipboardEvent(text, "paste");
    await waitFor(() => expect(pasteImage).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).toBeNull();
    const tile = screen.getByRole("button", { name: "图片 group" });
    tile.focus();
    clipboardEvent(tile, "paste");
    await screen.findByRole("dialog", { name: /动态图.*第一帧/ });
    unmount();
    await act(async () => undefined);
    expect(pasteImage).toHaveBeenCalledOnce();
  });

  it("restores source focus before confirmation starts the coordinator, never after its new focus", async () => {
    const port = makePort({ read: vi.fn().mockResolvedValue({ ...contents, animated: true }) });
    const pasteImage = vi.fn(async () => {
      expect(screen.getByRole("button", { name: "图片 group" })).toHaveFocus();
      screen.getByRole("heading", { name: "图片组 group" }).focus();
    });
    setup({ port, pasteImage });
    const tile = screen.getByRole("button", { name: "图片 group" });
    tile.focus();
    clipboardEvent(tile, "paste");
    const dialog = await screen.findByRole("dialog", { name: /动态图.*第一帧/ });
    expect(within(dialog).getByRole("button", { name: "取消" })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole("button", { name: "转换为静态图片并粘贴" }));
    await waitFor(() => expect(pasteImage).toHaveBeenCalledOnce());
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 0)); });
    expect(screen.getByRole("heading", { name: "图片组 group" })).toHaveFocus();
  });

  it("keeps animated-image confirmation inside the library modal and Escape cancels only that operation", async () => {
    const close = vi.fn(), pasteImage = vi.fn();
    render(<LibraryDialog title="编辑动态图素材" onClose={close}>
      <ImageClipboardScope port={makePort({ read: vi.fn().mockResolvedValue({ ...contents, animated: true }) })}
        resolveImage={() => contents.original} pasteImage={pasteImage}><Gallery /></ImageClipboardScope>
    </LibraryDialog>);
    const tile = screen.getByRole("button", { name: "图片 group" });
    tile.focus();
    clipboardEvent(tile, "paste");
    const dialog = await screen.findByRole("dialog", { name: /动态图.*第一帧/ });
    expect(screen.getByRole("dialog", { name: "编辑动态图素材" })).toContainElement(dialog);
    fireEvent.keyDown(within(dialog).getByRole("button", { name: "取消" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /动态图.*第一帧/ })).toBeNull());
    expect(tile).toHaveFocus();
    expect(close).not.toHaveBeenCalled();
    expect(pasteImage).not.toHaveBeenCalled();
  });

  it("limits viewer defaults to a read-only currently focused scope", async () => {
    const port = makePort();
    const resolveImage = vi.fn().mockResolvedValue(contents.original);
    render(<>
      <button>外部区域</button>
      <ImageClipboardScope port={port} resolveImage={resolveImage}
        defaultSelection={{ kind: "gallery", groupId: "viewer", imageId: "current" }}>
        <button>关闭查看器</button>
      </ImageClipboardScope>
    </>);
    const viewer = screen.getByRole("button", { name: "关闭查看器" });
    viewer.focus();
    clipboardEvent(viewer, "copy");
    await waitFor(() => expect(port.write).toHaveBeenCalledOnce());
    screen.getByRole("button", { name: "外部区域" }).focus();
    expect(clipboardEvent(viewer, "copy").defaultPrevented).toBe(false);
    expect(port.write).toHaveBeenCalledOnce();
  });

  it("uses a single portalled viewer image while its close button has focus, without claiming other dialogs", async () => {
    const port = makePort();
    const resolveImage = vi.fn().mockResolvedValue(contents.original);
    const { container } = render(<>
      <button>查看器外部</button>
      <ImageClipboardScope port={port} resolveImage={resolveImage} className="viewer-clipboard"
        defaultSelection={{ kind: "gallery", groupId: "viewer", imageId: "visible" }}>
        {createPortal(<div role="dialog" aria-label="当前图片查看器">
          <button>关闭当前图片</button>
          <button data-clipboard-gallery="viewer" data-image-clipboard-id="visible">当前原图</button>
          <div role="dialog" aria-label="其他操作确认"><button>确认其他操作</button></div>
        </div>, document.body)}
      </ImageClipboardScope>
    </>);
    expect(container.querySelector(".viewer-clipboard")).toHaveStyle({ display: "contents" });
    const close = screen.getByRole("button", { name: "关闭当前图片" });
    close.focus();
    expect(clipboardEvent(close, "copy").defaultPrevented).toBe(true);
    await waitFor(() => expect(port.write).toHaveBeenCalledOnce());
    expect(resolveImage).toHaveBeenCalledWith({ kind: "gallery", groupId: "viewer", imageId: "visible" });
    fireEvent.keyDown(close, { key: "F10", shiftKey: true });
    const menu = await screen.findByRole("menu");
    expect(screen.getByRole("dialog", { name: "当前图片查看器" })).toContainElement(menu);
    expect(within(menu).queryByRole("menuitem", { name: "粘贴图片" })).toBeNull();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(close).toHaveFocus();
    const other = screen.getByRole("button", { name: "确认其他操作" });
    other.focus();
    expect(clipboardEvent(other, "copy").defaultPrevented).toBe(false);
    screen.getByRole("button", { name: "查看器外部" }).focus();
    expect(clipboardEvent(close, "copy").defaultPrevented).toBe(false);
    expect(port.write).toHaveBeenCalledOnce();
  });
});
