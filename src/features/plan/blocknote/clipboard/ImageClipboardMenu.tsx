import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { ImageClipboardSelection, ImagePasteTarget } from "../../../../domain/clipboard/imageClipboard";

export interface CapturedImageClipboardMenu {
  source: ImageClipboardSelection | null;
  target: ImagePasteTarget | null;
  origin: HTMLElement;
  host: HTMLElement;
  x: number;
  y: number;
}

function clampClipboardSurface(element: HTMLElement, x: number, y: number) {
  const rect = element.getBoundingClientRect();
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
  const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight;
  element.style.left = `${Math.max(left + 8, Math.min(x, left + width - rect.width - 8))}px`;
  element.style.top = `${Math.max(top + 8, Math.min(y, top + height - rect.height - 8))}px`;
}

export function ImageClipboardMenu({ menu, canPaste, busy, disabled, onCopy, onPaste, onClose }: {
  menu: CapturedImageClipboardMenu;
  canPaste: boolean;
  busy: boolean;
  disabled: boolean;
  onCopy(): void;
  onPaste(): void;
  onClose(restore: boolean): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current!;
    const clamp = () => clampClipboardSurface(element, menu.x, menu.y);
    clamp();
    (element.querySelector<HTMLElement>("button:not(:disabled)") ?? element).focus({ preventScroll: true });
    window.addEventListener("resize", clamp);
    window.visualViewport?.addEventListener("resize", clamp);
    const outside = (event: Event) => {
      if (event.target instanceof Node && !element.contains(event.target)) onClose(false);
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside, true);
    return () => {
      window.removeEventListener("resize", clamp);
      window.visualViewport?.removeEventListener("resize", clamp);
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside, true);
    };
  }, [menu, onClose]);
  useLayoutEffect(() => {
    if (canPaste && document.activeElement === ref.current) {
      ref.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    }
  }, [canPaste]);

  return createPortal(<div ref={ref} role="menu" aria-label="图片剪贴板" tabIndex={-1}
    className="preshot-image-clipboard-menu"
    onContextMenu={(event) => event.preventDefault()}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === "Escape" || event.key === "Tab") {
        event.preventDefault();
        onClose(true);
        return;
      }
      const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
          : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
        items[next]?.focus();
      }
      if (event.key === "Enter" && event.target === ref.current) {
        event.preventDefault();
        items[0]?.click();
      }
    }}>
    {menu.source && <button type="button" role="menuitem" disabled={busy || disabled} onClick={onCopy}>复制图片</button>}
    {menu.target && <button type="button" role="menuitem" disabled={busy || disabled || !canPaste} onClick={onPaste}>粘贴图片</button>}
  </div>, menu.host);
}
