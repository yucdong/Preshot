import {
  DOCUMENT_TITLE_HEIGHT,
  MIN_COMPONENT_HEIGHT,
  MIN_COMPONENT_WIDTH,
} from "./models";

export const A4 = { width: 595.28, height: 841.89 } as const;
export const SPACING = 24;
export { DOCUMENT_TITLE_HEIGHT } from "./models";

export interface ComponentFrameChrome {
  topBarHeight: number;
  contentGap: number;
}

export const NO_COMPONENT_FRAME_CHROME: ComponentFrameChrome = {
  topBarHeight: 0,
  contentGap: 0,
};

export const EDITABLE_COMPONENT_FRAME_CHROME: ComponentFrameChrome = {
  topBarHeight: 24,
  contentGap: 4,
};

export function componentFrameChromeHeight(chrome: ComponentFrameChrome): number {
  const topBarHeight =
    Number.isFinite(chrome.topBarHeight) && chrome.topBarHeight > 0
      ? chrome.topBarHeight
      : 0;
  const contentGap =
    Number.isFinite(chrome.contentGap) && chrome.contentGap > 0 ? chrome.contentGap : 0;
  return topBarHeight + contentGap;
}

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

export interface AlignmentSnapInput {
  value: number;
  candidates: readonly number[];
  threshold: number;
}

export interface AlignmentSnapResult {
  value: number;
  snapped: boolean;
  guide: number | null;
  delta: number;
}

export interface CardSnapInput {
  rect: Rect;
  candidates: readonly Rect[];
  threshold: number;
}

export interface CardSnapResult {
  rect: Rect;
  x: AlignmentSnapResult;
  y: AlignmentSnapResult;
}

export function contentSize(geometry: PageGeometry): { width: number; height: number } {
  return {
    width: geometry.page.width - 2 * geometry.margin,
    height: geometry.page.height - 2 * geometry.margin,
  };
}

function positiveFinite(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeFinite(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * Normalizes a v7 card rectangle. Cards are unconstrained vertically but
 * always remain within the fixed-width continuous canvas.
 */
export function clampCardRect(
  rect: Rect,
  canvasWidth = contentSize(DEFAULT_PAGE_GEOMETRY).width,
): Rect {
  const availableWidth = positiveFinite(
    canvasWidth,
    contentSize(DEFAULT_PAGE_GEOMETRY).width,
  );
  const minimumWidth = Math.min(MIN_COMPONENT_WIDTH, availableWidth);
  const width = Math.min(
    availableWidth,
    Math.max(minimumWidth, positiveFinite(rect.width, minimumWidth)),
  );
  const height = Math.max(
    MIN_COMPONENT_HEIGHT,
    positiveFinite(rect.height, MIN_COMPONENT_HEIGHT),
  );
  const x = Math.min(
    Math.max(0, nonNegativeFinite(rect.x)),
    Math.max(0, availableWidth - width),
  );

  return { x, y: nonNegativeFinite(rect.y), width, height };
}

export function moveCard(
  rect: Rect,
  position: Pick<Rect, "x" | "y">,
  canvasWidth = contentSize(DEFAULT_PAGE_GEOMETRY).width,
): Rect {
  return clampCardRect({ ...rect, ...position }, canvasWidth);
}

export function resizeCard(
  rect: Rect,
  size: Pick<Rect, "width" | "height">,
  canvasWidth = contentSize(DEFAULT_PAGE_GEOMETRY).width,
): Rect {
  return clampCardRect({ ...rect, ...size }, canvasWidth);
}

/** Returns enough vertical room for the lowest card plus a stable bottom gutter. */
export function canvasHeight(rects: readonly Pick<Rect, "y" | "height">[]): number {
  const bottom = rects.reduce(
    (maximum, rect) =>
      Math.max(
        maximum,
        nonNegativeFinite(rect.y) + Math.max(0, Number.isFinite(rect.height) ? rect.height : 0),
      ),
    DOCUMENT_TITLE_HEIGHT,
  );
  return bottom + SPACING;
}

export function snapAlignment({
  value,
  candidates,
  threshold,
}: AlignmentSnapInput): AlignmentSnapResult {
  const current = Number.isFinite(value) ? value : 0;
  if (!Number.isFinite(threshold) || threshold < 0) {
    return { value: current, snapped: false, guide: null, delta: 0 };
  }

  let guide: number | null = null;
  let delta = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate)) {
      continue;
    }
    const candidateDelta = candidate - current;
    if (Math.abs(candidateDelta) <= threshold && Math.abs(candidateDelta) < Math.abs(delta)) {
      guide = candidate;
      delta = candidateDelta;
    }
  }

  return guide === null
    ? { value: current, snapped: false, guide: null, delta: 0 }
    : { value: guide, snapped: true, guide, delta };
}

/**
 * Snaps the top-left of a card against candidate left/centre/right and
 * top/centre/bottom alignment guides. Rendering guides is deliberately left
 * to the interaction batch.
 */
export function snapCardPosition({
  rect,
  candidates,
  threshold,
}: CardSnapInput): CardSnapResult {
  const xCandidates = candidates.flatMap((candidate) => [
    candidate.x,
    candidate.x + candidate.width / 2 - rect.width / 2,
    candidate.x + candidate.width - rect.width,
  ]);
  const yCandidates = candidates.flatMap((candidate) => [
    candidate.y,
    candidate.y + candidate.height / 2 - rect.height / 2,
    candidate.y + candidate.height - rect.height,
  ]);
  const x = snapAlignment({ value: rect.x, candidates: xCandidates, threshold });
  const y = snapAlignment({ value: rect.y, candidates: yCandidates, threshold });

  return {
    rect: { ...rect, x: x.value, y: y.value },
    x,
    y,
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
