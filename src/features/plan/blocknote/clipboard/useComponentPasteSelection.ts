import { ui } from "../../../../shared/i18n/ui";
import { useEffect, useState, type RefObject } from "react";
import {
  clipboardComponent, componentClipboardGallery, documentClipboardBridge, IMAGE_CLIPBOARD_SELECTION_CHANGE,
  isPlainClipboardField,
} from "./imageClipboardDom";

const interactive = "button, input, textarea, select, label, a, [role='button'], [role='separator'], " +
  "[data-image-clipboard-id], [data-image-resize-edge], .bn-resize-handle, [data-clipboard-gesture='true']";

export function useComponentPasteSelection(rootRef: RefObject<HTMLElement | null>, enabled: boolean) {
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !enabled) return;
    let markedComponent: HTMLElement | null = null;
    let markedGallery: HTMLElement | null = null;
    const owns = (element: Element) => element.closest("[data-image-clipboard-scope]") === root &&
      element.closest("[role='dialog'], [role='alertdialog'], dialog") ===
      root.closest("[role='dialog'], [role='alertdialog'], dialog") && !element.closest("[inert]");
    const clear = () => {
      markedComponent?.removeAttribute("data-clipboard-component-selected");
      markedGallery?.removeAttribute("data-clipboard-paste-target");
      markedComponent = markedGallery = null;
    };
    const update = () => {
      const active = document.activeElement;
      const component = active && owns(active) && !isPlainClipboardField(active) &&
        (!window.getSelection()?.toString() || documentClipboardBridge(active)?.getSelectedComponent?.())
        ? clipboardComponent(active) : null;
      const gallery = component?.isConnected ? componentClipboardGallery(component) : null;
      if (component === markedComponent && gallery === markedGallery) return;
      clear();
      if (component && gallery) {
        markedComponent = component;
        markedGallery = gallery;
        component.setAttribute("data-clipboard-component-selected", "");
        gallery.setAttribute("data-clipboard-paste-target", ui("粘贴到此处 · Ctrl+V"));
        setAnnouncement(ui("已选中{{v0}}，Ctrl+V 将图片粘贴到此图片区域。", { v0: component.dataset.clipboardComponentLabel ?? ui("组件") }));
      } else setAnnouncement("");
    };
    const blur = () => { clear(); setAnnouncement(""); };
    const mouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (event.defaultPrevented || event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey ||
        !(target instanceof Element) || !owns(target) || isPlainClipboardField(target) ||
        target.closest(interactive)) return;
      const component = target.closest<HTMLElement>("[data-clipboard-component]");
      if (!component) return;
      // Preserve pointer-driven drag/resize paths; only prevent ProseMirror's
      // subsequent mousedown from moving keyboard focus back to the document.
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
      component.focus({ preventScroll: true });
      update();
    };
    const observer = new MutationObserver(update);
    observer.observe(root, { childList: true, subtree: true, attributes: true,
      attributeFilter: ["data-clipboard-component", "data-clipboard-gallery", "inert"] });
    root.addEventListener("mousedown", mouseDown, true);
    root.addEventListener(IMAGE_CLIPBOARD_SELECTION_CHANGE, update);
    document.addEventListener("focusin", update);
    document.addEventListener("selectionchange", update);
    window.addEventListener("blur", blur);
    window.addEventListener("focus", update);
    update();
    return () => {
      observer.disconnect();
      root.removeEventListener("mousedown", mouseDown, true);
      root.removeEventListener(IMAGE_CLIPBOARD_SELECTION_CHANGE, update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("selectionchange", update);
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", update);
      clear();
    };
  }, [enabled, rootRef]);
  return enabled ? announcement : "";
}
