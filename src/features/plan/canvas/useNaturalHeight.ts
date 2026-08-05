import { useEffect, useRef } from "react";

function entryHeightPx(entry: ResizeObserverEntry, node: HTMLDivElement): number {
  const rectHeight = node.getBoundingClientRect().height;
  if (Number.isFinite(rectHeight) && rectHeight > 0) {
    return rectHeight;
  }

  const borderBoxSize = Array.isArray(entry.borderBoxSize)
    ? entry.borderBoxSize[0]
    : entry.borderBoxSize;
  if (borderBoxSize && Number.isFinite(borderBoxSize.blockSize) && borderBoxSize.blockSize > 0) {
    return borderBoxSize.blockSize;
  }

  return entry.contentRect.height;
}

function spacerHeightPoints(node: HTMLDivElement, scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) {
    return 0;
  }

  let totalPx = 0;
  node.querySelectorAll(".bn-page-break-before").forEach((element) => {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    const px = Number.parseFloat(element.style.getPropertyValue("--bn-page-break-space"));
    if (Number.isFinite(px) && px > 0) {
      totalPx += px;
    }
  });

  return totalPx / scale;
}

export function useNaturalHeight(input: {
  id: string;
  scale: number;
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

    const observer = new ResizeObserver((entries) => {
      const entry = entries.find((candidate) => candidate.target === node) ?? entries[0];
      if (!entry) {
        return;
      }

      const scale = input.scale;
      if (!Number.isFinite(scale) || scale <= 0) {
        return;
      }

      const rawHeightPoints = entryHeightPx(entry, node) / scale;
      const heightPoints = rawHeightPoints - spacerHeightPoints(node, scale);
      if (!Number.isFinite(heightPoints) || heightPoints < 0) {
        return;
      }

      const previous = lastHeightRef.current;
      if (previous !== null && Math.abs(previous - heightPoints) < 1) {
        return;
      }

      lastHeightRef.current = heightPoints;
      onHeightRef.current(input.id, heightPoints);
    });

    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [input.id, input.scale]);

  return ref;
}
