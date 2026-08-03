export const A4 = { width: 595.28, height: 841.89 } as const;
export const MARGIN = 48;
export const GUTTER = 12;
export const ROW_GAP = 12;

export interface PageGeometry {
  page: { width: number; height: number };
  margin: number;
  gutter: number;
  rowGap: number;
}

export const DEFAULT_PAGE_GEOMETRY: PageGeometry = {
  page: { width: A4.width, height: A4.height },
  margin: MARGIN,
  gutter: GUTTER,
  rowGap: ROW_GAP,
};

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function contentSize(geometry: PageGeometry): { width: number; height: number } {
  return {
    width: geometry.page.width - 2 * geometry.margin,
    height: geometry.page.height - 2 * geometry.margin,
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
  slotWidth: number,
  slotHeight: number,
  imageWidth: number,
  imageHeight: number,
): { width: number; height: number; offsetX: number; offsetY: number } {
  const scale = Math.min(slotWidth / imageWidth, slotHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return { width, height, offsetX: (slotWidth - width) / 2, offsetY: (slotHeight - height) / 2 };
}
