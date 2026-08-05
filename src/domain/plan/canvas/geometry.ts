export const A4 = { width: 595.28, height: 841.89 } as const;
export const SPACING = 24;

export interface PageGeometry {
  page: { width: number; height: number };
  margin: number;
  gutter: number;
  rowGap: number;
  pageGap?: number;
}

export const DEFAULT_PAGE_GEOMETRY: PageGeometry = {
  page: { width: A4.width, height: A4.height },
  margin: SPACING,
  gutter: SPACING,
  rowGap: SPACING,
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

export function containSize(
  slotWidth: number,
  slotHeight: number,
  imageWidth: number,
  imageHeight: number,
): { width: number; height: number; offsetX: number; offsetY: number } {
  const scale = imageWidth <= 0 || imageHeight <= 0 ? 0 : Math.min(slotWidth / imageWidth, slotHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return { width, height, offsetX: (slotWidth - width) / 2, offsetY: (slotHeight - height) / 2 };
}

export function packAspectRow(
  items: { aspectRatio: number }[],
  height: number,
  maxWidth: number,
  gap: number,
): { rects: Rect[]; totalHeight: number } {
  const rects: Rect[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const item of items) {
    const ratio = item.aspectRatio > 0 ? item.aspectRatio : 1;
    let w = height * ratio;
    let h = height;
    if (w > maxWidth) { w = maxWidth; h = maxWidth / ratio; } // oversized single item
    if (x > 0 && x + w > maxWidth + 0.01) { x = 0; y += rowHeight + gap; rowHeight = 0; }
    rects.push({ x, y, width: w, height: h });
    x += w + gap;
    rowHeight = Math.max(rowHeight, h);
  }
  return { rects, totalHeight: y + rowHeight };
}
