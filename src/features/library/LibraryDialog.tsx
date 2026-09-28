import { useCallback, useEffect, useId, useLayoutEffect, useRef, type KeyboardEventHandler, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { DialogPortalContext } from "../../shared/ui/DialogPortalContext";

const focusableSelector = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';
const modalStack: HTMLElement[] = [];
type BackgroundAttributes = { inert: string | null; hidden: string | null };
const backgroundAttributes = new Map<Element, BackgroundAttributes>();
let initialOverflow = "";
let initialFocus: HTMLElement | null = null;

function restoreBackgroundAttributes(element: Element, attrs: BackgroundAttributes) {
  if (attrs.inert === null) element.removeAttribute("inert");
  else element.setAttribute("inert", attrs.inert);
  if (attrs.hidden === null) element.removeAttribute("aria-hidden");
  else element.setAttribute("aria-hidden", attrs.hidden);
}

function synchronizeModalBackground() {
  const top = modalStack.at(-1);
  for (const element of Array.from(document.body.children)) {
    if (!backgroundAttributes.has(element)) backgroundAttributes.set(element, {
      inert: element.getAttribute("inert"), hidden: element.getAttribute("aria-hidden"),
    });
  }
  for (const [element, attrs] of backgroundAttributes) {
    if (top && element !== top) {
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    } else {
      restoreBackgroundAttributes(element, attrs);
    }
  }
  document.body.style.overflow = top ? "hidden" : initialOverflow;
  if (!top) backgroundAttributes.clear();
}

export function LibraryDialog({
  title, subtitle, className = "", busy = false, onClose, onKeyDown, children,
}: {
  title: string;
  subtitle?: string;
  className?: string;
  busy?: boolean;
  onClose(): void;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  children: ReactNode;
}) {
  const overlay = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  const titleId = useId();
  const subtitleId = useId();
  const portalHost = useCallback(() => dialog.current ?? document.body, []);
  useLayoutEffect(() => { closeRef.current = onClose; busyRef.current = busy; });

  useEffect(() => {
    const root = overlay.current!;
    const surface = dialog.current!;
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (modalStack.length === 0) {
      initialOverflow = document.body.style.overflow;
      initialFocus = origin;
    }
    modalStack.push(root);
    synchronizeModalBackground();
    const observer = new MutationObserver(synchronizeModalBackground);
    observer.observe(document.body, { childList: true });
    const focusable = () => Array.from(surface.querySelectorAll<HTMLElement>(focusableSelector))
      .filter((element) => !element.closest("[hidden], [inert]"));
    const first = () => surface.querySelector<HTMLElement>("[data-library-autofocus]:not(:disabled)") ?? focusable()[0] ?? surface;
    first().focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (root.hasAttribute("inert") || event.defaultPrevented) return;
      const nested = event.target instanceof Element
        ? event.target.closest('[role="dialog"][aria-modal="true"]') : null;
      if (nested && nested !== surface && surface.contains(nested)) return;
      if (event.key === "Escape") {
        if (event.target instanceof Element && event.target.closest('[role="menu"]')) return;
        if (event.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!busyRef.current) closeRef.current();
      }
      if (event.key !== "Tab") return;
      const elements = focusable();
      const firstElement = elements[0] ?? surface;
      const lastElement = elements.at(-1) ?? surface;
      if (!surface.contains(document.activeElement) ||
          (event.shiftKey && document.activeElement === firstElement) ||
          (!event.shiftKey && document.activeElement === lastElement)) {
        event.preventDefault();
        (event.shiftKey ? lastElement : firstElement).focus();
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (!root.hasAttribute("inert") && !surface.contains(event.target as Node)) first().focus();
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocus);
    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocus);
      const originalAttributes = backgroundAttributes.get(root);
      modalStack.splice(modalStack.indexOf(root), 1);
      synchronizeModalBackground();
      // StrictMode reuses this portal after cleanup; do not recapture its temporary background lock.
      if (originalAttributes) restoreBackgroundAttributes(root, originalAttributes);
      backgroundAttributes.delete(root);
      const restore = modalStack.length === 0 ? initialFocus : origin;
      if (restore?.isConnected && !restore.closest("[inert]")) restore.focus();
      else {
        const parent = modalStack.at(-1);
        const fallback = parent?.querySelector<HTMLElement>("[data-library-autofocus]:not(:disabled)") ??
          parent?.querySelector<HTMLElement>(focusableSelector);
        fallback?.focus();
      }
      if (modalStack.length === 0) initialFocus = null;
    };
  }, []);

  return createPortal(<div
    ref={overlay}
    className="material-library-overlay"
    data-material-library-overlay=""
    data-preshot-surface="true"
    onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) {
        event.preventDefault();
        onClose();
      }
    }}
  >
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}
      aria-describedby={subtitle ? subtitleId : undefined}
      aria-busy={busy} tabIndex={-1} className={`material-library-dialog ${className}`}
      onKeyDown={onKeyDown}>
      <header className="ml-dialog-header">
        <div><h2 id={titleId}>{title}</h2>{subtitle && <p id={subtitleId}>{subtitle}</p>}</div>
        <button type="button" className="ml-icon-button" aria-label={`关闭${title}`} disabled={busy} onClick={onClose}>
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      <DialogPortalContext.Provider value={portalHost}>{children}</DialogPortalContext.Provider>
    </div>
  </div>, document.body);
}
