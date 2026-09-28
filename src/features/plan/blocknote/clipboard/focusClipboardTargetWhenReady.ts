export function focusClipboardTargetWhenReady(root: HTMLElement, focus: () => void): () => void {
  const document = root.ownerDocument;
  let disposed = false;
  let observer: MutationObserver | null = null;
  const dispose = () => {
    disposed = true;
    observer?.disconnect();
    document.removeEventListener("pointerdown", dispose, true);
    document.removeEventListener("keydown", dispose, true);
    document.removeEventListener("focusin", dispose, true);
  };
  const attempt = () => {
    if (disposed) return;
    if (!root.isConnected) {
      dispose();
    } else if (!root.closest("[inert]")) {
      dispose();
      focus();
    }
  };
  if (root.closest("[inert]")) {
    // Native focus fails inside inert. Do not change ProseMirror's selection
    // until browser focus and its DOM selection can be updated together.
    observer = new MutationObserver(attempt);
    for (let ancestor: HTMLElement | null = root; ancestor; ancestor = ancestor.parentElement) {
      observer.observe(ancestor, { attributes: true, attributeFilter: ["inert"] });
    }
    document.addEventListener("pointerdown", dispose, true);
    document.addEventListener("keydown", dispose, true);
    document.addEventListener("focusin", dispose, true);
  }
  attempt();
  return dispose;
}
