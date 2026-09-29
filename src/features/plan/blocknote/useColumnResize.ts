import { useEffect } from "react";
import type { PreshotBlockNoteEditor } from "./preshotBlockNoteSchema";
import { columnWeight, setColumnWeights } from "./columnOperations";

/** Preview weights live only in DOM styles; pointer release records one edit. */
export function useColumnResize(editor: PreshotBlockNoteEditor, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const root = editor.prosemirrorView.dom;
    let cancelActive: (() => void) | undefined;
    const start = (event: PointerEvent) => {
      if (event.button !== 0 || root.closest("[inert]") || !(event.target instanceof Element)) return;
      const rowElement = event.target.closest<HTMLElement>(".bn-block-column-list");
      if (!rowElement || !root.contains(rowElement)) return;
      const elements = [...rowElement.children].filter((element): element is HTMLElement => element instanceof HTMLElement && element.classList.contains("bn-block-column"));
      const index = elements.findIndex((left, i) => {
        const right = elements[i + 1]; if (!right) return false;
        return event.clientX >= left.getBoundingClientRect().right - 3 && event.clientX <= right.getBoundingClientRect().left + 3;
      });
      const row = rowElement.dataset.id ? editor.getBlock(rowElement.dataset.id) : undefined;
      if (index < 0 || row?.type !== "columnList") return;
      cancelActive?.();
      event.preventDefault(); event.stopImmediatePropagation();
      const left = elements[index]; const right = elements[index + 1];
      const initialLeft = left.getBoundingClientRect().width;
      const pairWidth = initialLeft + right.getBoundingClientRect().width;
      const weights = row.children.map(columnWeight);
      const pairWeight = weights[index] + weights[index + 1];
      const next = [...weights];
      const originalLeft = left.style.flexGrow; const originalRight = right.style.flexGrow;
      const zoom = left.getBoundingClientRect().width / Math.max(1, left.offsetWidth);
      const minimum = Math.min(pairWidth / 2, 120 * zoom);
      const move = (e: PointerEvent) => {
        const width = Math.max(minimum, Math.min(pairWidth - minimum, initialLeft + e.clientX - event.clientX));
        next[index] = pairWeight * width / pairWidth;
        next[index + 1] = pairWeight - next[index];
        left.style.flexGrow = String(next[index]); right.style.flexGrow = String(next[index + 1]);
      };
      const cleanup = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", finish);
        document.removeEventListener("pointercancel", cancel);
        document.removeEventListener("keydown", key, true);
        window.removeEventListener("blur", cancel);
        left.style.flexGrow = originalLeft; right.style.flexGrow = originalRight;
        root.classList.remove("preshot-resizing-columns"); cancelActive = undefined;
      };
      const finish = (e: PointerEvent) => {
        move(e); cleanup();
        if (root.isConnected && !root.closest("[inert]") && Math.abs(e.clientX - event.clientX) > 0.5) { setColumnWeights(editor, row.id, next); editor.focus(); }
      };
      const cancel = () => cleanup();
      const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); } };
      cancelActive = cancel; root.classList.add("preshot-resizing-columns");
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", finish);
      document.addEventListener("pointercancel", cancel);
      document.addEventListener("keydown", key, true);
      window.addEventListener("blur", cancel);
    };
    root.addEventListener("pointerdown", start, true);
    const unchange = editor.onChange(() => cancelActive?.());
    return () => { cancelActive?.(); root.removeEventListener("pointerdown", start, true); unchange(); };
  }, [editor, enabled]);
}
