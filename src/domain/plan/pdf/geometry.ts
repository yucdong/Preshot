export const A4 = { width: 595.28, height: 841.89 } as const;
export const MARGIN = 48;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function contentBox(): Box {
  return {
    x: MARGIN,
    y: MARGIN,
    width: A4.width - 2 * MARGIN,
    height: A4.height - 2 * MARGIN,
  };
}

export function squareSlotGrid(
  contentWidth: number,
  columns: number,
  gap: number,
): { slotSize: number; xOffsets: number[] } {
  const safeColumns = Math.max(1, Math.floor(columns));
  const slotSize = (contentWidth - gap * (safeColumns - 1)) / safeColumns;
  const xOffsets = Array.from({ length: safeColumns }, (_unused, i) => i * (slotSize + gap));
  return { slotSize, xOffsets };
}

export function containSize(
  slotSize: number,
  imgWidth: number,
  imgHeight: number,
): { width: number; height: number; offsetX: number; offsetY: number } {
  const scale = Math.min(slotSize / imgWidth, slotSize / imgHeight);
  const width = imgWidth * scale;
  const height = imgHeight * scale;
  return {
    width,
    height,
    offsetX: (slotSize - width) / 2,
    offsetY: (slotSize - height) / 2,
  };
}
