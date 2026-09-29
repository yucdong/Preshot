// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MaterialDetail, PortableComponent } from "../../domain/library/models";
import type { MaterialLibraryRepository } from "../../domain/library/ports";
import type { MountLongImageExportSurfaceOptions } from "../longImage/longImageExportSurface";
import { createMaterialPreview, MaterialComponentPreview } from "./materialPreview";
import { ImageClipboardContext } from "../../features/plan/ImageClipboardContext";
import { LibraryDialog } from "../../features/library/LibraryDialog";
import type { ImageClipboardPort } from "../../domain/clipboard/imageClipboard";

const boundaries = vi.hoisted(() => ({
  mount: vi.fn(),
  createSession: vi.fn(),
  capture: vi.fn(),
  close: vi.fn(),
}));
vi.mock("../longImage/longImageExportSurface", () => ({
  mountLongImageExportSurface: boundaries.mount,
}));
vi.mock("../capture/modernScreenshotCapture", () => ({
  modernScreenshotCaptureAdapter: { createSession: boundaries.createSession },
}));

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPioAAAAASUVORK5CYII=";
const source = `data:image/png;base64,${png}`;

function material(name = "完整场地"): MaterialDetail {
  return {
    id: name, name, description: "", tags: [], favorite: false,
    kind: "shootingLocation", revision: 1, metadataVersion: 1,
    createdAt: 1, updatedAt: 1, deletedAt: null,
    imageCount: 1, byteLength: atob(png).length, previewState: "pending",
    payload: {
      format: "preshot-material", version: 1, kind: "shootingLocation",
      component: {
        kind: "shootingLocation", venueName: name, address: "山间道路",
        description: "所有说明都必须显示，包括最后一行。",
        gallery: { images: [{
          localImageId: "image-1", aspectRatio: 1, frameWidth: 240,
          frameHeight: 240, sourceWidth: 1, sourceHeight: 1,
          fitMode: "stretch", crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
        }] },
      },
    },
    images: [{
      localImageId: "image-1", blobId: "a".repeat(64), mimeType: "image/png",
      byteLength: atob(png).length, width: 1, height: 1,
    }],
  };
}

function repository(): MaterialLibraryRepository {
  return {
    availability: "test", search: vi.fn(), get: vi.fn(), save: vi.fn(),
    updateMetadata: vi.fn(), setDeleted: vi.fn(), purge: vi.fn(),
    loadImage: vi.fn().mockResolvedValue(source), loadPreview: vi.fn(),
    savePreview: vi.fn().mockResolvedValue(undefined),
    markPreviewFailed: vi.fn().mockResolvedValue(undefined),
    prepareInsert: vi.fn(), commitInsert: vi.fn(), abortInsert: vi.fn(),
    getInsertStatus: vi.fn(),
  };
}

function addImage(item: MaterialDetail): void {
  if (item.payload.component.kind !== "shootingLocation") throw new Error("Invalid fixture");
  item.payload.component.gallery.images.push({
    ...item.payload.component.gallery.images[0], localImageId: "image-2",
  });
  item.images.push({ ...item.images[0], localImageId: "image-2" });
  item.imageCount = 2;
  item.byteLength *= 2;
}

function surface(height = 400) {
  const host = document.createElement("div");
  host.dataset.preshotLongImageExportHost = "";
  const element = document.createElement("section");
  element.setAttribute("aria-hidden", "true");
  element.style.width = "900px";
  element.textContent = "完整组件的最后一行";
  host.append(element);
  document.body.append(host);
  return {
    element, measurements: { outerWidth: 900, height },
    destroy: vi.fn(() => host.remove()),
  };
}

function selectedCard(element: HTMLElement, nodeView = false): HTMLElement {
  const style = document.createElement("style");
  style.textContent = `
    .bn-block-content.ProseMirror-selectednode > *,
    .ProseMirror-selectednode > .bn-block-content > * {
      outline: 4px solid rgb(100, 160, 255);
    }
  `;
  const outer = document.createElement("div");
  const content = document.createElement("div");
  content.className = "bn-block-content";
  (nodeView ? outer : content).classList.add("ProseMirror-selectednode");
  const card = document.createElement("section");
  card.style.border = "1px solid rgb(218, 219, 221)";
  card.style.boxShadow = "0px 1px 2px rgb(0, 0, 0)";
  content.append(card);
  outer.append(content);
  element.append(style, outer);
  return card;
}

let mounted: ReturnType<typeof surface>;
let sourceCanvas: HTMLCanvasElement;
let bitmapClose: ReturnType<typeof vi.fn>;
let drawImage: ReturnType<typeof vi.fn>;
let fillText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mounted = surface();
  sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = 900;
  sourceCanvas.height = 400;
  boundaries.mount.mockResolvedValue(mounted);
  boundaries.createSession.mockResolvedValue({
    capture: boundaries.capture, close: boundaries.close,
  });
  boundaries.capture.mockResolvedValue({
    output: "canvas", canvas: sourceCanvas, width: 900, height: 400, pixelRatio: 1,
  });
  bitmapClose = vi.fn();
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({
    width: 1, height: 1, close: bitmapClose,
  }));
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:material-preview");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  drawImage = vi.fn();
  fillText = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage, fillText, fillRect: vi.fn(), imageSmoothingEnabled: true,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (callback) {
    callback(new Blob([new Uint8Array(atob(png).split("").map((char) => char.charCodeAt(0)))], {
      type: "image/png",
    }));
  });
});

afterEach(() => {
  cleanup();
  document.querySelectorAll("[data-preshot-long-image-export-host]").forEach((node) => node.remove());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("createMaterialPreview", () => {
  it("serializes different thumbnails and continues after a failed regeneration", async () => {
    const repo = repository();
    let rejectFirst!: (error: Error) => void;
    vi.mocked(repo.loadImage).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }));
    const first = createMaterialPreview(repo, material("first"));
    const failure = expect(first).rejects.toThrow("failed original");
    const second = createMaterialPreview(repo, material("second"));
    await waitFor(() => expect(repo.loadImage).toHaveBeenCalledOnce());
    expect(boundaries.capture).not.toHaveBeenCalled();
    rejectFirst(new Error("failed original"));
    await failure;
    await second;
    expect(repo.loadImage).toHaveBeenCalledTimes(2);
    expect(repo.savePreview).toHaveBeenCalledExactlyOnceWith("second", 1, expect.anything());
  });
  it("rejects a broken rendered image instead of persisting a gray thumbnail", async () => {
    const repo = repository();
    const image = document.createElement("img");
    image.src = "blob:blocked-by-production-csp";
    mounted.element.append(image);
    await expect(createMaterialPreview(repo, material())).rejects.toThrow();
    expect(repo.savePreview).not.toHaveBeenCalled();
    expect(repo.markPreviewFailed).toHaveBeenCalledOnce();
    expect(boundaries.capture).not.toHaveBeenCalled();
  });
  it("retains preview assets until an aborted in-flight surface mount has finished cleanup", async () => {
    let rejectMount!: (error: Error) => void;
    let assets!: Readonly<Record<string, string>>;
    boundaries.mount.mockImplementation((options: MountLongImageExportSurfaceOptions) => {
      assets = options.resolvedAssets;
      return new Promise((_resolve, reject) => { rejectMount = reject; });
    });
    const view = render(<MaterialComponentPreview repository={repository()} material={material()} />);
    await waitFor(() => expect(boundaries.mount).toHaveBeenCalledOnce());
    view.unmount();
    expect(assets["references/0001.png"]).toBe("blob:material-preview");
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    await act(async () => { rejectMount(new DOMException("Cancelled", "AbortError")); });
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledOnce());
    expect(Object.keys(assets)).toEqual([]);
  });

  it("tracks image hit targets when the read-only renderer mounts or replaces frames later", async () => {
    const port: ImageClipboardPort = {
      availability: "test", write: vi.fn(async () => undefined),
      read: vi.fn(async () => null), hasImage: vi.fn(async () => false),
    };
    const group = document.createElement("div");
    const frame = document.createElement("div");
    boundaries.mount.mockImplementation(async (options: MountLongImageExportSurfaceOptions) => {
      const artifact = options.plan.artifacts[0];
      if (artifact.kind !== "shootingLocation") throw new Error("Unexpected preview");
      group.dataset.preshotExportImageGroup = artifact.gallery.id;
      frame.dataset.preshotExportImage = artifact.gallery.images[0].id;
      group.append(frame);
      return mounted;
    });
    render(<ImageClipboardContext.Provider value={port}>
      <MaterialComponentPreview repository={repository()} material={material()} />
    </ImageClipboardContext.Provider>);
    await waitFor(() => expect(screen.getByRole("region", { name: "完整场地 · 完整预览" })).toHaveAttribute("aria-busy", "false"));
    act(() => { mounted.element.append(group); });
    const target = await screen.findByRole("button", { name: "选择素材图片 1" });
    expect(target.closest("[inert]")).toBeNull();
    target.focus();
    const replacement = document.createElement("div");
    replacement.dataset.preshotExportImage = frame.dataset.preshotExportImage;
    act(() => { group.replaceChildren(replacement); });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("button", { name: "选择素材图片 1" })).toBe(target);
    expect(target).toHaveFocus();
    fireEvent.contextMenu(target, { clientX: 40, clientY: 40 });
    fireEvent.click(await screen.findByRole("menuitem", { name: /复制图片/ }));
    await waitFor(() => expect(port.write).toHaveBeenCalledWith(expect.objectContaining({ dataUrl: source })));
    act(() => { group.remove(); });
    await waitFor(() => expect(screen.queryByRole("button", { name: "选择素材图片 1" })).not.toBeInTheDocument());
  });

  it("copies an original-backed preview image outside the inert surface and Escape only closes its menu", async () => {
    const repo = repository();
    const port: ImageClipboardPort = {
      availability: "test", write: vi.fn(async () => undefined),
      read: vi.fn(async () => null), hasImage: vi.fn(async () => false),
    };
    const onClose = vi.fn();
    boundaries.mount.mockImplementation(async (options: MountLongImageExportSurfaceOptions) => {
      const artifact = options.plan.artifacts[0];
      if (artifact.kind !== "shootingLocation") throw new Error("Unexpected preview");
      const group = document.createElement("div");
      group.dataset.preshotExportImageGroup = artifact.gallery.id;
      const frame = document.createElement("div");
      frame.dataset.preshotExportImage = artifact.gallery.images[0].id;
      group.append(frame);
      mounted.element.append(group);
      return mounted;
    });
    render(<LibraryDialog title="预览素材" onClose={onClose}>
      <ImageClipboardContext.Provider value={port}>
        <MaterialComponentPreview repository={repo} material={material()} />
      </ImageClipboardContext.Provider>
    </LibraryDialog>);
    const target = await screen.findByRole("button", { name: "选择素材图片 1" });
    expect(target.closest("[inert]")).toBeNull();
    expect(mounted.element.parentElement).toHaveAttribute("inert");
    fireEvent.contextMenu(target, { clientX: 40, clientY: 40 });
    const copy = await screen.findByRole("menuitem", { name: /复制图片/ });
    expect(screen.queryByRole("menuitem", { name: /粘贴图片/ })).not.toBeInTheDocument();
    fireEvent.keyDown(copy, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.contextMenu(target, { clientX: 40, clientY: 40 });
    fireEvent.click(await screen.findByRole("menuitem", { name: /复制图片/ }));
    await waitFor(() => expect(port.write).toHaveBeenCalledOnce());
    expect(port.write).toHaveBeenCalledWith(expect.objectContaining({
      dataUrl: source, presentation: expect.objectContaining({ fitMode: "stretch" }),
    }));
    expect(repo.loadImage).toHaveBeenLastCalledWith(material().id, 1, "image-1");
    expect(repo.savePreview).not.toHaveBeenCalled();
  });

  it.each([false, true])("removes only preview selection outlines before capture (node view: %s)", async (nodeView) => {
    const card = selectedCard(mounted.element, nodeView);
    const unrelated = surface();
    const unrelatedCard = selectedCard(unrelated.element, nodeView);
    expect(getComputedStyle(card).outline).toContain("rgb(100, 160, 255)");
    boundaries.capture.mockImplementationOnce(async () => {
      expect(getComputedStyle(card).outline).toBe("none");
      expect(getComputedStyle(card).border).toBe("1px solid rgb(218, 219, 221)");
      expect(getComputedStyle(card).boxShadow).toBe("0px 1px 2px rgb(0, 0, 0)");
      expect(getComputedStyle(unrelatedCard).outline).toContain("rgb(100, 160, 255)");
      return { output: "canvas", canvas: sourceCanvas, width: 900, height: 400, pixelRatio: 1 };
    });
    await createMaterialPreview(repository(), material());
    unrelated.destroy();
  });

  it("persists a bounded PNG of an offline one-block v15 plan and frees all resources", async () => {
    const repo = repository();
    const item = material();
    await createMaterialPreview(repo, item);
    const options = boundaries.mount.mock.calls[0][0] as MountLongImageExportSurfaceOptions;
    expect(options.includeImageGroupMetadata).toBe(true);
    expect(options.plan.schemaVersion).toBe(16);
    expect(options.plan.document.blocks).toHaveLength(1);
    expect(options.plan.artifacts[0]).toMatchObject({
      kind: "shootingLocation", description: item.payload.component.kind === "shootingLocation"
        ? item.payload.component.description : "",
      gallery: { images: [{
        file: "references/0001.png", fitMode: "stretch",
        crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
      }] },
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(repo.savePreview).toHaveBeenCalledWith(item.id, 1, expect.objectContaining({
      width: 480, isPartial: false, renderKey: expect.stringContaining("preshot-material-preview"),
    }));
    const preview = vi.mocked(repo.savePreview).mock.calls[0][2];
    expect(preview.bytes.length).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(preview.bytes.slice(0, 4)).toEqual([137, 80, 78, 71]);
    expect(boundaries.close).toHaveBeenCalledOnce();
    expect(mounted.destroy).toHaveBeenCalledOnce();
    expect(bitmapClose).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(sourceCanvas.width).toBe(0);
    expect(repo.markPreviewFailed).not.toHaveBeenCalled();
  });

  it("caps tall captures and clearly labels partial thumbnails without changing content", async () => {
    mounted.destroy();
    mounted = surface(30_000);
    boundaries.mount.mockResolvedValue(mounted);
    sourceCanvas.height = 8192;
    boundaries.capture.mockResolvedValue({
      output: "canvas", canvas: sourceCanvas, width: 900, height: 8192, pixelRatio: 1,
    });
    const repo = repository();
    await createMaterialPreview(repo, material());
    const request = boundaries.capture.mock.calls[0][0];
    expect(request.viewport.height).toBeLessThanOrEqual(8192);
    expect(request.viewport.width * request.viewport.height).toBeLessThanOrEqual(8_000_000);
    expect(request.viewport.sourceHeight).toBeLessThanOrEqual(8192);
    expect(vi.mocked(repo.savePreview).mock.calls[0][2].isPartial).toBe(true);
    expect(fillText).toHaveBeenCalledWith(expect.stringContaining("局部"), expect.any(Number), expect.any(Number));
  });

  it.each(["missing", "duplicate", "extra"])("rejects %s image mappings before loading assets", async (caseName) => {
    const item = material();
    if (caseName === "missing") item.images = [];
    if (caseName === "duplicate") item.images.push({ ...item.images[0] });
    if (caseName === "extra") item.images.push({ ...item.images[0], localImageId: "unused" });
    const repo = repository();
    await expect(createMaterialPreview(repo, item)).rejects.toThrow();
    expect(repo.loadImage).not.toHaveBeenCalled();
    expect(repo.markPreviewFailed).toHaveBeenCalledWith(item.id, 1);
    expect(repo.savePreview).not.toHaveBeenCalled();
  });

  it.each(["size", "budget", "dimensions"])("validates %s before mounting", async (caseName) => {
    const item = material();
    if (caseName === "size") item.images[0].byteLength = 16 * 1024 * 1024 + 1;
    if (caseName === "budget") {
      item.images[0].width = 8192;
      item.images[0].height = 8193;
    }
    if (caseName === "dimensions") item.images[0].width = 2;
    const repo = repository();
    await expect(createMaterialPreview(repo, item)).rejects.toThrow();
    expect(boundaries.mount).not.toHaveBeenCalled();
    expect(repo.savePreview).not.toHaveBeenCalled();
  });

  it.each([
    "https://invalid.example/image.png",
    "data:image/svg+xml;base64,PHN2Zy8+",
    "data:image/png;base64,YmFk",
  ])("rejects nonlocal or invalid image bytes: %s", async (url) => {
    const repo = repository();
    vi.mocked(repo.loadImage).mockResolvedValue(url);
    await expect(createMaterialPreview(repo, material())).rejects.toThrow();
    expect(boundaries.mount).not.toHaveBeenCalled();
    expect(repo.markPreviewFailed).toHaveBeenCalledOnce();
  });

  it("surfaces capture failures instead of manufacturing a preview", async () => {
    const repo = repository();
    boundaries.capture.mockRejectedValue(new Error("capture unavailable"));
    await expect(createMaterialPreview(repo, material())).rejects.toThrow("capture unavailable");
    expect(repo.savePreview).not.toHaveBeenCalled();
    expect(repo.markPreviewFailed).toHaveBeenCalledOnce();
    expect(boundaries.close).toHaveBeenCalledOnce();
    expect(mounted.destroy).toHaveBeenCalledOnce();
    expect(boundaries.mount.mock.calls[0][0].resolvedAssets).toEqual({});
  });

  it("surfaces both rendering and failure-state persistence errors", async () => {
    const repo = repository();
    boundaries.capture.mockRejectedValue(new Error("capture unavailable"));
    vi.mocked(repo.markPreviewFailed).mockRejectedValue(new Error("database unavailable"));
    await expect(createMaterialPreview(repo, material())).rejects.toThrow(/capture unavailable.*database unavailable/);
  });

  it.each<PortableComponent>([
    { kind: "imageGroup", name: "参考图片", description: "空图库", images: [] },
    { kind: "modelCard", modelId: "模特", heightCm: 170, weightKg: 50, shoeSize: "38", notes: "完整备注", samples: { images: [] } },
    { kind: "prop", title: "道具", source: "自带", gallery: { images: [] } },
    { kind: "clothing", title: "服装", source: "借用", mainGallery: { images: [] } },
  ])("renders a valid empty $kind component without inventing missing images", async (component) => {
    const item = material();
    item.kind = component.kind;
    item.payload = { ...item.payload, kind: component.kind, component };
    item.images = [];
    item.imageCount = 0;
    item.byteLength = 0;
    const repo = repository();
    await createMaterialPreview(repo, item);
    expect(repo.loadImage).not.toHaveBeenCalled();
    expect(repo.savePreview).toHaveBeenCalledOnce();
    const plan = (boundaries.mount.mock.calls[0][0] as MountLongImageExportSurfaceOptions).plan;
    expect(plan.document.blocks[0].type).toBe(component.kind);
    if (component.kind === "imageGroup") {
      expect(plan.imageGroups[0]).toMatchObject({ x: 0, width: 1008, height: 320 });
      expect(plan.imageGroups[0]).not.toHaveProperty("frameOffsetY");
    } else {
      expect(plan.artifacts[0]).not.toHaveProperty("layout");
    }
  });

  it("uses .jpg only for JPEG bytes whose header and decoded dimensions match", async () => {
    const item = material();
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, 1, 1, 0x11, 0, 0xff, 0xd9,
    ]);
    item.images[0].mimeType = "image/jpeg";
    item.images[0].byteLength = jpeg.length;
    const repo = repository();
    vi.mocked(repo.loadImage).mockResolvedValue(`data:image/jpeg;base64,${btoa(String.fromCharCode(...jpeg))}`);
    await createMaterialPreview(repo, item);
    const plan = (boundaries.mount.mock.calls[0][0] as MountLongImageExportSurfaceOptions).plan;
    expect(plan.artifacts[0]).toMatchObject({
      gallery: { images: [{ file: "references/0001.jpg" }] },
    });
  });

  it("rejects aggregate decoded memory above 256 MiB before requesting image bytes", async () => {
    const item = material();
    addImage(item);
    item.images.forEach((image) => {
      image.width = 8192;
      image.height = 8192;
    });
    const repo = repository();
    await expect(createMaterialPreview(repo, item)).rejects.toThrow("256 MiB");
    expect(repo.loadImage).not.toHaveBeenCalled();
  });

  it("loads and decodes serially, preserving order and releasing earlier assets after a later failure", async () => {
    const item = material();
    addImage(item);
    const repo = repository();
    let resolveDecode!: (bitmap: ImageBitmap) => void;
    vi.mocked(createImageBitmap).mockImplementationOnce(() => new Promise((resolve) => {
      resolveDecode = resolve;
    }));
    vi.mocked(repo.loadImage).mockResolvedValueOnce(source).mockRejectedValueOnce(new Error("第二张损坏"));
    const generating = createMaterialPreview(repo, item);
    const rejection = expect(generating).rejects.toThrow("第二张损坏");
    await waitFor(() => expect(createImageBitmap).toHaveBeenCalledOnce());
    expect(repo.loadImage).toHaveBeenCalledTimes(1);
    resolveDecode({ width: 1, height: 1, close: bitmapClose } as unknown as ImageBitmap);
    await rejection;
    expect(vi.mocked(repo.loadImage).mock.calls.map((call) => call[2])).toEqual(["image-1", "image-2"]);
    expect(bitmapClose).toHaveBeenCalledOnce();
    expect(boundaries.mount).not.toHaveBeenCalled();
  });

  it("reduces PNG dimensions when encoding exceeds 2 MiB and releases the resize canvas", async () => {
    const encodedCanvases: HTMLCanvasElement[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementationOnce(function (callback) {
        callback(new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: "image/png" }));
      })
      .mockImplementation(function (this: HTMLCanvasElement, callback) {
        encodedCanvases.push(this);
        callback(new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }));
      });
    const repo = repository();
    await createMaterialPreview(repo, material());
    expect(vi.mocked(repo.savePreview).mock.calls[0][2].width).toBe(384);
    expect(encodedCanvases[0].width).toBe(0);
    expect(encodedCanvases[0].height).toBe(0);
  });

  it("marks encoding failures and coalesces simultaneous duplicate generation", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(null));
    const repo = repository();
    const item = material();
    const first = createMaterialPreview(repo, item);
    expect(createMaterialPreview(repo, item)).toBe(first);
    await expect(first).rejects.toThrow("PNG");
    expect(repo.markPreviewFailed).toHaveBeenCalledOnce();
    expect(repo.savePreview).not.toHaveBeenCalled();
    expect(sourceCanvas.width).toBe(0);
  });

  it("closes workers and frees a late capture canvas when its deadline aborts", async () => {
    vi.useFakeTimers();
    let resolveCapture!: (value: unknown) => void;
    boundaries.capture.mockImplementation(() => new Promise((resolve) => {
      resolveCapture = resolve;
    }));
    const repo = repository();
    const generating = createMaterialPreview(repo, material());
    const rejection = expect(generating).rejects.toThrow("超时");
    await vi.advanceTimersByTimeAsync(0);
    expect(boundaries.capture).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    await rejection;
    expect(boundaries.close).toHaveBeenCalled();
    expect(mounted.destroy).toHaveBeenCalledOnce();
    expect(boundaries.mount.mock.calls[0][0].resolvedAssets).toEqual({});
    resolveCapture({ output: "canvas", canvas: sourceCanvas });
    await Promise.resolve();
    expect(sourceCanvas.width).toBe(0);
    expect(repo.savePreview).not.toHaveBeenCalled();
  });
});

describe("MaterialComponentPreview", () => {
  it("hides selection chrome on the complete live surface, not the keyboard-focusable preview region", async () => {
    const card = selectedCard(mounted.element);
    render(<MaterialComponentPreview repository={repository()} material={material()} />);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(getComputedStyle(card).outline).toBe("none");
    const region = screen.getByRole("region", { name: /完整场地.*完整预览/ });
    expect(region.getAttribute("tabindex")).toBe("0");
    expect(region.style.outline).toBe("");
    expect(mounted.element.getAttribute("data-preshot-material-preview-surface")).toBe("");
    expect(boundaries.mount).toHaveBeenCalledWith(expect.objectContaining({ includeImageGroupMetadata: true }));
  });

  it("mounts the real read-only shared schema and safely unmounts its independent React root", async () => {
    const actual = await vi.importActual<typeof import("../longImage/longImageExportSurface")>(
      "../longImage/longImageExportSurface",
    );
    boundaries.mount.mockImplementationOnce(actual.mountLongImageExportSurface);
    const item = material();
    if (item.payload.component.kind !== "shootingLocation") throw new Error("Invalid fixture");
    item.payload.component.gallery.images = [];
    item.images = [];
    item.imageCount = 0;
    item.byteLength = 0;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const view = render(<MaterialComponentPreview repository={repository()} material={item} />);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
    const region = screen.getByRole("region", { name: /完整场地.*完整预览/ });
    expect(region.querySelector('[contenteditable="false"]')).not.toBeNull();
    expect(region.querySelector("[inert]")).not.toBeNull();
    view.unmount();
    await act(async () => {});
    expect(errors.mock.calls.flat().join(" ")).not.toContain("synchronously unmount a root");
  }, 20_000);

  it("exposes all text and a complete fit-width scrollable read-only component, not its thumbnail", async () => {
    mounted.destroy();
    mounted = surface(30_000);
    boundaries.mount.mockResolvedValue(mounted);
    const repo = repository();
    const view = render(<MaterialComponentPreview repository={repo} material={material()} />);
    expect(screen.getByRole("status").textContent).toContain("加载");
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    const region = screen.getByRole("region", { name: /完整场地.*完整预览/ });
    expect(region.getAttribute("tabindex")).toBe("0");
    expect(region.style.overflowY).toBe("auto");
    expect(region.textContent).toContain("所有说明都必须显示，包括最后一行。");
    expect(region.contains(mounted.element)).toBe(true);
    expect(mounted.element.style.height).not.toBe("8192px");
    expect(repo.loadPreview).not.toHaveBeenCalled();
    expect(repo.savePreview).not.toHaveBeenCalled();
    view.unmount();
    await act(async () => {});
    expect(mounted.destroy).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it("never publishes an obsolete material after switching", async () => {
    const repo = repository();
    let resolveFirst!: (url: string) => void;
    vi.mocked(repo.loadImage).mockImplementationOnce(() => new Promise((resolve) => {
      resolveFirst = resolve;
    })).mockResolvedValue(source);
    const view = render(<MaterialComponentPreview repository={repo} material={material("旧场地")} />);
    await waitFor(() => expect(repo.loadImage).toHaveBeenCalledOnce());
    view.rerender(<MaterialComponentPreview repository={repo} material={material("新场地")} />);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    await act(async () => resolveFirst(source));
    expect(screen.queryByText(/旧场地/)).toBeNull();
    expect(screen.getByRole("region", { name: /新场地/ })).toBeTruthy();
    expect(boundaries.mount).toHaveBeenCalledOnce();
  });

  it("displays actionable missing-image errors, not a blank success view", async () => {
    const repo = repository();
    vi.mocked(repo.loadImage).mockRejectedValue(new Error("图片文件已损坏"));
    render(<MaterialComponentPreview repository={repo} material={material()} />);
    expect((await screen.findByRole("alert")).textContent).toContain("图片文件已损坏");
    expect(boundaries.mount).not.toHaveBeenCalled();
  });

  it("closes a late decoded bitmap after unmount without publishing assets", async () => {
    let resolveDecode!: (bitmap: ImageBitmap) => void;
    vi.mocked(createImageBitmap).mockImplementationOnce(() => new Promise((resolve) => {
      resolveDecode = resolve;
    }));
    const repo = repository();
    const view = render(<MaterialComponentPreview repository={repo} material={material()} />);
    await waitFor(() => expect(createImageBitmap).toHaveBeenCalledOnce());
    view.unmount();
    await act(async () => {
      resolveDecode({ width: 1, height: 1, close: bitmapClose } as unknown as ImageBitmap);
    });
    expect(bitmapClose).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(boundaries.mount).not.toHaveBeenCalled();
  });

  it("destroys a late mounted surface after unmount", async () => {
    let resolveMount!: (value: ReturnType<typeof surface>) => void;
    boundaries.mount.mockImplementationOnce(() => new Promise((resolve) => {
      resolveMount = resolve;
    }));
    const repo = repository();
    const view = render(<MaterialComponentPreview repository={repo} material={material()} />);
    await waitFor(() => expect(boundaries.mount).toHaveBeenCalledOnce());
    view.unmount();
    await act(async () => resolveMount(mounted));
    expect(mounted.destroy).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
    expect(document.body.contains(mounted.element)).toBe(false);
  });
});
