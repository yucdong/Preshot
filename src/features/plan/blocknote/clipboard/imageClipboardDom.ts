import type { ImageClipboardSelection, ImagePasteTarget } from "../../../../domain/clipboard/imageClipboard";

export const IMAGE_CLIPBOARD_HISTORY_CHANGE = "preshot-image-clipboard-history-change";
export const IMAGE_CLIPBOARD_SELECTION_CHANGE = "preshot-image-clipboard-selection-change";

export interface ImageClipboardDocumentBridge {
  getNativeSelection(): string | null;
  getAnchor(): string | null;
  resolveNativeImage(element: Element): string | null;
  getTopLevelBlock?(blockId: string): string;
  getSelectedComponent?(): HTMLElement | null;
}

const bridges = new WeakMap<Element, ImageClipboardDocumentBridge>();

export function registerImageClipboardDocument(root: Element, bridge: ImageClipboardDocumentBridge) {
  bridges.set(root, bridge);
  return () => { if (bridges.get(root) === bridge) bridges.delete(root); };
}

export function documentClipboardBridge(element: Element) {
  const root = element.closest("[data-clipboard-document]");
  return root ? bridges.get(root) : undefined;
}

export function isPlainClipboardField(element: Element): boolean {
  if (element.closest("input, textarea, select, [role='textbox']:not(.ProseMirror)")) return true;
  const editable = element.closest("[contenteditable='true']");
  return !!editable && !editable.matches(".ProseMirror, [data-clipboard-document]");
}

export function imageAtElement(element: Element): ImageClipboardSelection | null {
  const tile = element.closest<HTMLElement>("[data-image-clipboard-id]");
  const groupId = tile?.dataset.imageGroupId ?? tile?.closest<HTMLElement>("[data-clipboard-gallery]")?.dataset.clipboardGallery;
  if (tile?.dataset.imageClipboardId && groupId) {
    return { kind: "gallery", groupId, imageId: tile.dataset.imageClipboardId };
  }
  const blockId = documentClipboardBridge(element)?.resolveNativeImage(element);
  return blockId ? { kind: "native", blockId } : null;
}

export function focusedClipboardImage(element: Element): ImageClipboardSelection | null {
  const bridge = documentClipboardBridge(element);
  const nativeBlockId = bridge?.getNativeSelection();
  if (nativeBlockId) return { kind: "native", blockId: nativeBlockId };
  if (window.getSelection()?.toString()) return null;
  const tile = element.closest<HTMLElement>("[data-image-clipboard-id]");
  return tile && tile.contains(document.activeElement) ? imageAtElement(tile) : null;
}

export function clipboardComponent(element: Element): HTMLElement | null {
  if (isPlainClipboardField(element)) return null;
  return element.closest<HTMLElement>("[data-clipboard-component]") ??
    (element.matches("[data-clipboard-document], .ProseMirror")
      ? documentClipboardBridge(element)?.getSelectedComponent?.() : null) ?? null;
}

export function componentClipboardGallery(component: HTMLElement): HTMLElement | null {
  const groupId = component.dataset.clipboardComponent;
  return [component, ...component.querySelectorAll<HTMLElement>("[data-clipboard-gallery]")]
    .filter((gallery) => gallery.dataset.clipboardGallery === groupId &&
      gallery.closest("[data-clipboard-component]") === component).at(-1) ?? null;
}

export function imagePasteTarget(
  element: Element,
  getAnchor?: () => string | null,
): ImagePasteTarget | null {
  if (isPlainClipboardField(element)) return null;
  const component = clipboardComponent(element);
  const gallery = element.closest<HTMLElement>("[data-clipboard-gallery]") ??
    (component ? componentClipboardGallery(component) : null);
  const image = imageAtElement(element);
  if (gallery?.dataset.clipboardGallery) {
    // A heading's outer marker shares its ID with the actual padded gallery.
    const contentGallery = Array.from(gallery.querySelectorAll<HTMLElement>("[data-clipboard-gallery]"))
      .find((entry) => entry.dataset.clipboardGallery === gallery.dataset.clipboardGallery) ?? gallery;
    const style = window.getComputedStyle(contentGallery);
    const clientWidth = contentGallery.clientWidth;
    const width = clientWidth -
      (Number.parseFloat(style.paddingLeft) || 0) -
      (Number.parseFloat(style.paddingRight) || 0);
    return {
      kind: "gallery",
      groupId: gallery.dataset.clipboardGallery,
      afterImageId: image?.kind === "gallery" ? image.imageId : null,
      ...(clientWidth > 0 && width >= 32 && Number.isFinite(width) ? { maxFrameWidth: width } : {}),
    };
  }
  if (component) return null;
  if (!element.closest("[data-clipboard-document]")) return null;
  const bridge = documentClipboardBridge(element);
  return {
    kind: "document",
    afterBlockId: image?.kind === "native"
      ? bridge?.getTopLevelBlock?.(image.blockId) ?? image.blockId
      : bridge ? bridge.getAnchor() : getAnchor?.() ?? null,
  };
}

export type ClipboardPayloadKind = "image" | "ordinary" | "unknown";

// Format inspection is synchronous: ownership must be decided before ProseMirror
// sees the paste event. Bytes and registered packets are validated by the port.
export function clipboardPayloadKind(data: DataTransfer | null): ClipboardPayloadKind {
  if (!data) return "unknown";
  const types = Array.from(data.types ?? [], (type) => type.toLowerCase());
  if (types.some((type) => type === "preshot.image.v1" || type === "application/x-preshot-image")) return "image";
  if (types.includes("blocknote/html") || types.includes("application/x-blocknote")) return "ordinary";
  const text = data.getData("text/plain").trim();
  const html = data.getData("text/html");
  if (text) return "ordinary";
  let embeddedRaster = false;
  if (html) {
    const template = document.createElement("template");
    template.innerHTML = html;
    const body = template.content;
    const image = body.querySelector("img");
    if (body.textContent?.trim() || body.querySelectorAll("img").length !== 1 ||
      body.querySelectorAll("[data-node-type='blockContainer']").length > 1 ||
      Array.from(body.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li")).some((block) => !block.contains(image)) ||
      body.querySelector("video, audio, table, script, iframe")) return "ordinary";
    embeddedRaster = /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(image?.getAttribute("src") ?? "");
  }
  const files = Array.from(data.files ?? []);
  const imageFiles = files.filter((file) => /^image\/(?:png|jpeg|gif|webp|bmp)$/i.test(file.type));
  if (files.length === 1 && imageFiles.length === 1) return "image";
  if (files.length > 0) return "ordinary";
  if (embeddedRaster) return "image";
  if (html || types.length > 0) return "ordinary";
  return "unknown";
}
