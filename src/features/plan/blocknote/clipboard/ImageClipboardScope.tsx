import { ui, useUiLanguage } from "../../../../shared/i18n/ui";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import type {
  ImageClipboardContents, ImageClipboardInput, ImageClipboardPort,
  ImageClipboardSelection, ImagePasteTarget,
} from "../../../../domain/clipboard/imageClipboard";
import { useDialogPortalHost } from "../../../../shared/ui/DialogPortalContext";
import { AnimatedImagePasteConfirmation } from "./AnimatedImagePasteConfirmation";
import {
  clipboardComponent, clipboardPayloadKind, focusedClipboardImage, imageAtElement, imagePasteTarget, isPlainClipboardField,
  IMAGE_CLIPBOARD_HISTORY_CHANGE,
} from "./imageClipboardDom";
import { ImageClipboardMenu, type CapturedImageClipboardMenu } from "./ImageClipboardMenu";
import { useComponentPasteSelection } from "./useComponentPasteSelection";
import "./imageClipboard.css";

export interface ImageClipboardPasteResult {
  /** A parent-owned, entry-specific action that rejects stale history ownership. */
  undo?(): void;
}

export interface ImageClipboardScopeProps {
  port: ImageClipboardPort;
  resolveImage(selection: ImageClipboardSelection): ImageClipboardInput | Promise<ImageClipboardInput>;
  pasteImage?(contents: ImageClipboardContents, target: ImagePasteTarget): Promise<void | ImageClipboardPasteResult>;
  getDocumentAnchor?(): string | null;
  disabled?: boolean;
  onUndo?(): void;
  className?: string;
  /** Only for a read-only single-image viewer, never an editor selection. */
  defaultSelection?: ImageClipboardSelection;
  children: ReactNode;
}

interface ClipboardNotice {
  message: string;
  error?: boolean;
  undo?: () => void;
  undoEpoch?: number;
  host: HTMLElement;
  position?: { left: number; top: number };
}

const gestureSelector = "[data-image-resize-edge], .bn-resize-handle, [data-clipboard-gesture='true'], [data-preshot-block-dragging]";
const modalSelector = "[role='dialog'], [role='alertdialog'], dialog";

export function ImageClipboardScope(props: ImageClipboardScopeProps) {
  useUiLanguage();
  const disabled = Boolean(props.disabled);
  const rootRef = useRef<HTMLDivElement>(null);
  const destinationAnnouncement = useComponentPasteSelection(rootRef, !disabled && !!props.pasteImage);
  const propsRef = useRef(props);
  const liveRef = useRef(false);
  const operationEpochRef = useRef(0);
  const contentInteractionEpochRef = useRef(0);
  const busyRef = useRef(false);
  const composingRef = useRef(false);
  const repeatedClipboardRef = useRef(false);
  const pointerRef = useRef(false);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuRef = useRef<CapturedImageClipboardMenu | null>(null);
  const clipboardHandlerRef = useRef<((event: ClipboardEvent) => void) | null>(null);
  const portalHandlerRef = useRef<((event: Event) => boolean) | null>(null);
  const operationElementRef = useRef<Element | null>(null);
  const confirmationRef = useRef<((confirmed: boolean) => void) | null>(null);
  const [confirmationHost, setConfirmationHost] = useState<HTMLElement | null>(null);
  const [menu, setMenu] = useState<CapturedImageClipboardMenu | null>(null);
  const [canPaste, setCanPaste] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<ClipboardNotice | null>(null);
  const contextHost = useDialogPortalHost();
  const hostRef = useRef(contextHost);
  useLayoutEffect(() => {
    liveRef.current = true;
    return () => { liveRef.current = false; };
  }, []);
  useLayoutEffect(() => { propsRef.current = props; hostRef.current = contextHost; });
  useLayoutEffect(() => { operationEpochRef.current++; }, [disabled, props.port]);
  useEffect(() => () => { confirmationRef.current?.(false); }, [disabled, props.port]);

  const confirmAnimationConversion = useCallback(() => new Promise<boolean>((resolve) => {
    confirmationRef.current = (confirmed) => {
      confirmationRef.current = null;
      if (liveRef.current) setConfirmationHost(null);
      resolve(confirmed);
    };
    setConfirmationHost(rootRef.current?.closest<HTMLElement>(modalSelector) ?? hostRef.current);
  }), []);

  const invalidateToastUndo = useCallback(() => {
    contentInteractionEpochRef.current++;
    setNotice((current) => current?.undo ? { ...current, undo: undefined, undoEpoch: undefined } : current);
  }, []);

  const captureContentInteraction = useCallback((event: SyntheticEvent) => {
    const root = rootRef.current;
    const element = event.target;
    if (!(element instanceof Element) || !root ||
      element.closest("[data-image-clipboard-scope]") !== root ||
      element.closest(modalSelector) !== root.closest(modalSelector) ||
      element.closest("[data-image-clipboard-notice]")) return;
    if (event.type === "keydown" &&
      ["Tab", "Shift", "Control", "Alt", "Meta", "CapsLock"].includes((event.nativeEvent as KeyboardEvent).key)) return;
    invalidateToastUndo();
  }, [invalidateToastUndo]);

  const notify = useCallback((next: Omit<ClipboardNotice, "host" | "position">, duration = 0) => {
    if (!liveRef.current) return;
    if (noticeTimerRef.current !== null) clearTimeout(noticeTimerRef.current);
    const active = document.activeElement;
    const rect = active instanceof HTMLElement && rootRef.current?.contains(active)
      ? active.getBoundingClientRect() : null;
    setNotice({
      ...next,
      host: operationElementRef.current?.closest<HTMLElement>(modalSelector) ??
        rootRef.current?.closest<HTMLElement>(modalSelector) ?? hostRef.current,
      ...(busyRef.current && !next.error && !duration && rect ? { position: {
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 300)),
        top: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 80)),
      } } : {}),
    });
    noticeTimerRef.current = duration ? setTimeout(() => {
      noticeTimerRef.current = null;
      setNotice(null);
    }, duration) : null;
  }, []);

  const closeMenu = useCallback((restore: boolean) => {
    const current = menuRef.current;
    menuRef.current = null;
    setMenu(null);
    if (restore && current?.origin.isConnected && !current.origin.closest("[inert]")) {
      current.origin.focus({ preventScroll: true });
    }
  }, []);

  const gestureActive = useCallback(() => {
    const root = rootRef.current;
    const origin = operationElementRef.current;
    const surface = origin?.isConnected && root && !root.contains(origin)
      ? origin.closest("[data-clipboard-gallery]") ?? origin : root;
    return pointerRef.current || !!surface?.querySelector("[data-clipboard-gesture='true']") ||
      !!surface?.closest("[inert]") || document.body.classList.contains("preshot-is-dragging-block");
  }, []);

  const operate = useCallback(async (
    command: { source: ImageClipboardSelection } | { target: ImagePasteTarget },
  ) => {
    invalidateToastUndo();
    const current = propsRef.current;
    if (current.disabled || composingRef.current || gestureActive()) return;
    if (busyRef.current) {
      notify({ message: ui("正在处理图片，请稍候再试。") });
      return;
    }
    if ("target" in command && !current.pasteImage) return;
    busyRef.current = true;
    const epoch = operationEpochRef.current;
    const undoEpoch = contentInteractionEpochRef.current;
    const isCurrent = () => liveRef.current && !propsRef.current.disabled && operationEpochRef.current === epoch;
    setBusy(true);
    notify({ message: "source" in command ? ui("正在复制图片…") : ui("正在粘贴图片，请稍候…") });
    try {
      if (current.port.availability === "unavailable") {
        throw new Error(ui("当前环境不支持系统图片剪贴板，请在桌面应用中使用。"));
      }
      if ("source" in command) {
        const input = await current.resolveImage(command.source);
        if (!isCurrent()) {
          notify({ message: ui("图片操作已取消，请重新选择目标后重试。") }, 5_000);
          return;
        }
        await current.port.write(input);
        notify({ message: ui("已复制图片") }, 3_000);
      } else {
        const contents = await current.port.read();
        if (!isCurrent()) {
          notify({ message: ui("图片操作已取消，请重新选择目标后重试。") }, 5_000);
          return;
        }
        if (!contents) throw new Error(ui("剪贴板中没有可用图片，请先复制一张图片。"));
        if (contents.animated && command.target.kind === "gallery") {
          const confirmed = await confirmAnimationConversion();
          if (!confirmed || !isCurrent()) {
            notify({ message: ui("已取消图片粘贴，未创建图片。") }, 3_000);
            return;
          }
        }
        const result = await current.pasteImage!(contents, command.target);
        notify({
          message: command.target.kind === "gallery" ? ui("已粘贴图片到图片组") : ui("已粘贴图片到正文"),
          undo: contentInteractionEpochRef.current === undoEpoch
            ? result === undefined ? current.onUndo : result.undo
            : undefined,
          undoEpoch,
        }, 5_000);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : ui("操作失败，请重新选择图片和目标后重试。");
      notify({ message: ui("{{v0}}图片失败：{{v1}}", { v0: "source" in command ? ui("复制") : ui("粘贴"), v1: detail }), error: true });
    } finally {
      busyRef.current = false;
      if (liveRef.current) setBusy(false);
    }
  }, [confirmAnimationConversion, gestureActive, invalidateToastUndo, notify]);

  useEffect(() => {
    const root = rootRef.current!;
    liveRef.current = true;
    operationEpochRef.current++;
    const isSingleViewerControl = (element: Element) => {
      const selection = propsRef.current.defaultSelection;
      const dialog = element.closest(modalSelector);
      if (!selection || !dialog || element !== document.activeElement) return false;
      const images = Array.from(dialog.querySelectorAll<HTMLElement>("[data-image-clipboard-id]"))
        .filter((image) => {
          const scope = image.closest("[data-image-clipboard-scope]");
          const style = window.getComputedStyle(image);
          return image.closest(modalSelector) === dialog &&
            !image.closest("[inert], [hidden], [aria-hidden='true']") &&
            (!scope || scope === root || scope.contains(root)) &&
            style.display !== "none" && style.visibility !== "hidden";
        });
      if (images.length !== 1) return false;
      const image = imageAtElement(images[0]);
      return !!image && (selection.kind === "native" ||
        (image.kind === "gallery" && image.groupId === selection.groupId && image.imageId === selection.imageId));
    };
    const owns = (element: Element, portal = false) => {
      const scope = element.closest("[data-image-clipboard-scope]");
      if (element.closest("[inert]")) return false;
      if (portal) return !propsRef.current.pasteImage && !root.contains(element) &&
        (!scope || scope.contains(root)) && !isPlainClipboardField(element) &&
        ((!!element.closest("[data-image-clipboard-id]") && !!imageAtElement(element)) ||
          isSingleViewerControl(element));
      return scope === root && element.closest(modalSelector) === root.closest(modalSelector);
    };
    const originOf = (element: Element): HTMLElement => {
      const tile = element.closest<HTMLElement>("[data-image-clipboard-id]");
      const focusable = element.closest<HTMLElement>("button, [tabindex], [contenteditable='true']");
      return tile ?? focusable ?? element.closest<HTMLElement>("[data-clipboard-gallery], [data-clipboard-document]") ?? root;
    };
    const viewerImage = (element: Element) => {
      const current = propsRef.current;
      if (current.pasteImage || !current.defaultSelection || window.getSelection()?.toString()) return null;
      return element === document.activeElement ? current.defaultSelection : null;
    };
    const showMenu = (element: Element, x: number, y: number, portal = false) => {
      const current = propsRef.current;
      if (!owns(element, portal)) return false;
      operationElementRef.current = element;
      if (isPlainClipboardField(element) || composingRef.current ||
        gestureActive() || current.disabled || element.closest(gestureSelector)) return false;
      const source = imageAtElement(element) ?? focusedClipboardImage(element) ?? viewerImage(element);
      if (!source && window.getSelection()?.toString()) return false;
      const target = current.pasteImage ? imagePasteTarget(element, current.getDocumentAnchor) : null;
      if (!source && !target) return false;
      const origin = originOf(element);
      const captured: CapturedImageClipboardMenu = {
        source, target, origin, x, y,
        host: element.closest<HTMLElement>(modalSelector) ?? root.closest<HTMLElement>(modalSelector) ?? hostRef.current,
      };
      // Capture the destination before focus moves into the portal.
      origin.focus({ preventScroll: true });
      menuRef.current = captured;
      setCanPaste(false);
      setMenu(captured);
      if (target && current.port.availability !== "unavailable") {
        void current.port.hasImage().then((available) => {
          if (liveRef.current && menuRef.current === captured) setCanPaste(available);
        }).catch((error: unknown) => {
          if (liveRef.current && menuRef.current === captured) notify({
            message: ui("无法检查剪贴板：{{v0}}", { v0: error instanceof Error ? error.message : ui("请关闭菜单后重试。") }),
            error: true,
          });
        });
      }
      return true;
    };
    const contextMenu = (event: MouseEvent, portal = false) => {
      if (event.defaultPrevented || !(event.target instanceof Element)) return;
      if (showMenu(event.target, event.clientX, event.clientY, portal)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const keyDown = (event: KeyboardEvent, portal = false) => {
      if (event.defaultPrevented || !(event.target instanceof Element) || !owns(event.target, portal) || isPlainClipboardField(event.target)) return;
      operationElementRef.current = event.target;
      if (event.isComposing || event.keyCode === 229) return;
      if ((event.ctrlKey || event.metaKey) && ["c", "v"].includes(event.key.toLowerCase())) {
        repeatedClipboardRef.current = event.repeat;
      }
      if ((event.ctrlKey || event.metaKey) && ["c", "v"].includes(event.key.toLowerCase()) &&
        (event.repeat || propsRef.current.disabled || gestureActive())) {
        if (focusedClipboardImage(event.target) || viewerImage(event.target) ||
          (event.key.toLowerCase() === "v" && (event.target.closest("[data-clipboard-gallery]") || clipboardComponent(event.target)))) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        return;
      }
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        const rect = originOf(event.target).getBoundingClientRect();
        if (showMenu(event.target, rect.left, rect.bottom, portal)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }
    };
    const clipboard = (event: ClipboardEvent, portal = false) => {
      if (event.defaultPrevented || !(event.target instanceof Element) || !owns(event.target, portal)) return;
      const element = event.target;
      operationElementRef.current = element;
      if (composingRef.current) return;
      const kind = event.type === "paste" ? clipboardPayloadKind(event.clipboardData) : null;
      if (isPlainClipboardField(element)) {
        if (kind === "image") {
          event.preventDefault();
          notify({ message: ui("此处仅支持文本，请先选择图片区域或正文，再粘贴图片。") }, 5_000);
        }
        return;
      }
      if (event.type === "paste" && kind === "ordinary") return;
      const source = event.type === "copy" ? focusedClipboardImage(element) ?? viewerImage(element) : null;
      const target = event.type === "paste" ? imagePasteTarget(element, propsRef.current.getDocumentAnchor) : null;
      if (event.type === "paste" && !target && clipboardComponent(element) && propsRef.current.pasteImage) {
        event.preventDefault();
        event.stopImmediatePropagation();
        notify({ message: ui("此组件的图片区域已不可用，请重新选择组件后再粘贴。") }, 5_000);
        return;
      }
      if (!source && !target) return;
      if (gestureActive() || repeatedClipboardRef.current || element.closest(gestureSelector)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (event.type === "paste" && !propsRef.current.pasteImage) {
        if (kind === "image") {
          event.preventDefault();
          event.stopImmediatePropagation();
          notify({ message: ui("预览仅支持复制图片，请先打开可编辑的图片区域。") }, 5_000);
        }
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (propsRef.current.disabled) {
        notify({ message: ui("当前编辑区域暂不可用，请等待操作完成后重试。") }, 5_000);
        return;
      }
      if (source) void operate({ source });
      else if (target) void operate({ target });
    };
    const pointerDown = (event: PointerEvent, portal = false) => {
      if (!(event.target instanceof Element) || !owns(event.target, portal)) return;
      operationElementRef.current = event.target;
      pointerRef.current = event.button === 0;
    };
    const finishPointer = () => { pointerRef.current = false; };
    const keyUp = () => { repeatedClipboardRef.current = false; };
    const blur = () => {
      finishPointer();
      composingRef.current = false;
      repeatedClipboardRef.current = false;
      operationElementRef.current = null;
      closeMenu(false);
    };
    const compositionStart = (event: Event, portal = false) => {
      if (event.target instanceof Element && owns(event.target, portal)) composingRef.current = true;
    };
    const compositionEnd = () => { composingRef.current = false; };
    const historyChange = (event: Event) => {
      if (!busyRef.current && event.target instanceof Element && owns(event.target)) invalidateToastUndo();
    };
    // Read-only child portals have no physical scope ancestor. Bubble only their
    // explicitly marked image events so the nearest React scope handles them first.
    portalHandlerRef.current = (event) => {
      if (event.defaultPrevented || !(event.target instanceof Element) || !owns(event.target, true)) return false;
      switch (event.type) {
        case "copy": case "paste": clipboard(event as ClipboardEvent, true); break;
        case "contextmenu": contextMenu(event as MouseEvent, true); break;
        case "keydown": keyDown(event as KeyboardEvent, true); break;
        case "keyup": keyUp(); break;
        case "pointerdown": pointerDown(event as PointerEvent, true); break;
        case "compositionstart": compositionStart(event, true); break;
        case "compositionend": compositionEnd(); break;
      }
      return event.defaultPrevented;
    };
    root.addEventListener("contextmenu", contextMenu, true);
    root.addEventListener("keydown", keyDown, true);
    root.addEventListener("keyup", keyUp, true);
    // React capture runs before componentTextInputEvents at React's event root.
    // Native listeners here would run too late for those protected plain fields.
    clipboardHandlerRef.current = clipboard;
    root.addEventListener("pointerdown", pointerDown, true);
    root.addEventListener("compositionstart", compositionStart, true);
    root.addEventListener("compositionend", compositionEnd, true);
    root.addEventListener(IMAGE_CLIPBOARD_HISTORY_CHANGE, historyChange);
    window.addEventListener("pointerup", finishPointer, true);
    window.addEventListener("pointercancel", finishPointer, true);
    window.addEventListener("mouseup", finishPointer, true);
    window.addEventListener("blur", blur);
    return () => {
      liveRef.current = false;
      confirmationRef.current?.(false);
      if (noticeTimerRef.current !== null) clearTimeout(noticeTimerRef.current);
      root.removeEventListener("contextmenu", contextMenu, true);
      root.removeEventListener("keydown", keyDown, true);
      root.removeEventListener("keyup", keyUp, true);
      clipboardHandlerRef.current = null;
      portalHandlerRef.current = null;
      root.removeEventListener("pointerdown", pointerDown, true);
      root.removeEventListener("compositionstart", compositionStart, true);
      root.removeEventListener("compositionend", compositionEnd, true);
      root.removeEventListener(IMAGE_CLIPBOARD_HISTORY_CHANGE, historyChange);
      window.removeEventListener("pointerup", finishPointer, true);
      window.removeEventListener("pointercancel", finishPointer, true);
      window.removeEventListener("mouseup", finishPointer, true);
      window.removeEventListener("blur", blur);
    };
  }, [closeMenu, gestureActive, invalidateToastUndo, notify, operate]);

  const dispatchPortalEvent = useCallback((event: SyntheticEvent) => {
    if (portalHandlerRef.current?.(event.nativeEvent)) event.stopPropagation();
  }, []);

  return <div ref={rootRef} data-image-clipboard-scope="" className={props.className} style={{ display: "contents" }}
    onCopyCapture={(event) => { captureContentInteraction(event); clipboardHandlerRef.current?.(event.nativeEvent); }}
    onPasteCapture={(event) => { captureContentInteraction(event); clipboardHandlerRef.current?.(event.nativeEvent); }}
    onCutCapture={captureContentInteraction} onPointerDownCapture={captureContentInteraction}
    onClickCapture={captureContentInteraction} onKeyDownCapture={captureContentInteraction}
    onBeforeInputCapture={captureContentInteraction} onInputCapture={captureContentInteraction}
    onChangeCapture={captureContentInteraction} onCompositionStartCapture={captureContentInteraction}
    onContextMenuCapture={captureContentInteraction}
    onCopy={dispatchPortalEvent} onPaste={dispatchPortalEvent} onContextMenu={dispatchPortalEvent}
    onKeyDown={dispatchPortalEvent} onKeyUp={dispatchPortalEvent} onPointerDown={dispatchPortalEvent}
    onCompositionStart={dispatchPortalEvent} onCompositionEnd={dispatchPortalEvent}>
    {props.children}
    <span className="sr-only" aria-live="polite" aria-atomic="true">{destinationAnnouncement}</span>
    {confirmationHost && !props.disabled && <AnimatedImagePasteConfirmation host={confirmationHost}
      onDecision={(confirmed) => confirmationRef.current?.(confirmed && !propsRef.current.disabled)} />}
    {menu && <ImageClipboardMenu menu={menu} canPaste={canPaste} busy={busy}
      disabled={!!props.disabled || props.port.availability === "unavailable"}
      onClose={closeMenu}
      onCopy={() => { const source = menu.source; closeMenu(true); if (source) void operate({ source }); }}
      onPaste={() => { const target = menu.target; closeMenu(true); if (target) void operate({ target }); }} />}
    {notice && createPortal(<div className="preshot-image-clipboard-notice" role={notice.error ? "alert" : "status"}
      data-image-clipboard-notice=""
      style={busy && notice.position ? { ...notice.position, bottom: "auto", transform: "none" } : undefined}
      aria-atomic="true" data-clipboard-busy={busy || undefined} data-error={notice.error || undefined}>
      <span>{notice.message}</span>
      {notice.undo && !busy && <button type="button" onClick={() => {
        if (busyRef.current || propsRef.current.disabled || gestureActive() ||
          notice.undoEpoch !== contentInteractionEpochRef.current) return;
        try { notice.undo?.(); setNotice(null); }
        catch (error) { notify({ message: ui("撤销失败：{{v0}}", { v0: error instanceof Error ? error.message : ui("请重试。") }), error: true }); }
      }}>{ui("撤销")}</button>}
    </div>, notice.host)}
  </div>;
}
