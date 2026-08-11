import { useEffect, useRef } from "react";

export function useNaturalHeight(input: {
  id: string;
  scale: number;
  contentKey?: string;
  onHeight(id: string, heightPoints: number): void;
}): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  const lastHeightRef = useRef<number | null>(null);
  const onHeightRef = useRef(input.onHeight);

  useEffect(() => {
    onHeightRef.current = input.onHeight;
  }, [input.onHeight]);

  useEffect(() => {
    lastHeightRef.current = null;
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") {
      return;
    }

    let animationFrame: number | null = null;
    const observedElements = new Set<Element>();

    const commitHeight = (heightPx: number) => {
      const scale = input.scale;
      if (!Number.isFinite(scale) || scale <= 0) {
        return;
      }

      const heightPoints = heightPx / scale;
      if (!Number.isFinite(heightPoints) || heightPoints < 0) {
        return;
      }

      const previous = lastHeightRef.current;
      if (previous !== null && Math.abs(previous - heightPoints) < 1) {
        return;
      }

      lastHeightRef.current = heightPoints;
      onHeightRef.current(input.id, heightPoints);
    };

    const visibleHeightPx = () => {
      const rootRect = node.getBoundingClientRect();
      let bottom = rootRect.bottom;
      for (const element of node.querySelectorAll<HTMLElement>(
        '[data-text-leaf-id], .tiptap-editor, .tiptap-editor > *, .preshot-tiptap-toolbar, .bn-editor, .bn-toolbar, .bn-block-group, .bn-block-outer',
      )) {
        bottom = Math.max(bottom, element.getBoundingClientRect().bottom);
      }
      return Math.max(rootRect.height, bottom - rootRect.top);
    };

    const scheduleMeasurement = () => {
      if (animationFrame !== null) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        commitHeight(visibleHeightPx());
      });
    };

    const observer = new ResizeObserver((entries) => {
      const fallbackHeight = entries.reduce(
        (height, entry) => Math.max(height, entry.contentRect.height),
        0,
      );
      commitHeight(Math.max(visibleHeightPx(), fallbackHeight));
    });

    const observeVisibleElements = () => {
      const elements = [
        node,
        ...node.querySelectorAll<HTMLElement>(
          '[data-text-leaf-id], .tiptap-editor, .tiptap-editor > *, .preshot-tiptap-toolbar, .bn-editor, .bn-toolbar, .bn-block-group, .bn-block-outer',
        ),
      ];
      for (const element of elements) {
        if (!observedElements.has(element)) {
          observedElements.add(element);
          observer.observe(element);
        }
      }
    };

    const mutationObserver = typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(() => {
          observeVisibleElements();
          scheduleMeasurement();
        });

    observeVisibleElements();
    mutationObserver?.observe(node, { childList: true, subtree: true });
    const initialHeight = visibleHeightPx();
    if (initialHeight > 0) commitHeight(initialHeight);
    return () => {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
      mutationObserver?.disconnect();
    };
  }, [input.contentKey, input.id, input.scale]);

  return ref;
}
