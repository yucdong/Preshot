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

export const PLAN_COMPONENT_FRAME_CHROME = NO_COMPONENT_FRAME_CHROME;
export const PLAN_COMPONENT_FRAME_INSET = 5;
export const PLAN_COMPONENT_VISUAL_INSET = PLAN_COMPONENT_FRAME_INSET + 1;

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
  guides: AlignmentGuides;
}

export type ResizeEdge = "left" | "right" | "top" | "bottom";

export interface AlignmentGuides {
  /** Canvas x coordinate for a vertical alignment guide. */
  vertical: number | null;
  /** Canvas y coordinate for a horizontal alignment guide. */
  horizontal: number | null;
}

export interface CardResizeSnapInput extends CardSnapInput {
  edge: ResizeEdge;
  canvasWidth?: number;
  minimumWidth?: number;
  minimumHeight?: number;
  constrainToCanvas?: boolean;
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

/**
 * Resizes one card edge by a pointer delta while retaining the opposite edge.
 * Unlike `resizeCard`, this deliberately changes x/y for left/top handles.
 */
export function resizeCardFromEdge(
  rect: Rect,
  edge: ResizeEdge,
  delta: number,
  canvasWidth = contentSize(DEFAULT_PAGE_GEOMETRY).width,
): Rect {
  const base = clampCardRect(rect, canvasWidth);
  const safeDelta = Number.isFinite(delta) ? delta : 0;
  const availableWidth = positiveFinite(
    canvasWidth,
    contentSize(DEFAULT_PAGE_GEOMETRY).width,
  );
  const minimumWidth = Math.min(MIN_COMPONENT_WIDTH, availableWidth);

  if (edge === "left") {
    const right = base.x + base.width;
    const width = Math.max(
      minimumWidth,
      Math.min(right, base.width - safeDelta),
    );
    return { ...base, x: right - width, width };
  }

  if (edge === "right") {
    const width = Math.max(
      minimumWidth,
      Math.min(availableWidth - base.x, base.width + safeDelta),
    );
    return { ...base, width };
  }

  if (edge === "top") {
    const bottom = base.y + base.height;
    const height = Math.max(
      MIN_COMPONENT_HEIGHT,
      Math.min(bottom, base.height - safeDelta),
    );
    return { ...base, y: bottom - height, height };
  }

  return {
    ...base,
    height: Math.max(MIN_COMPONENT_HEIGHT, base.height + safeDelta),
  };
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

function axisPoints(origin: number, size: number): number[] {
  const safeOrigin = Number.isFinite(origin) ? origin : 0;
  const safeSize = Number.isFinite(size) ? size : 0;
  return [safeOrigin, safeOrigin + safeSize / 2, safeOrigin + safeSize];
}

function snapRectAxis(
  origin: number,
  size: number,
  candidates: readonly Rect[],
  axis: "x" | "y",
  threshold: number,
): AlignmentSnapResult {
  const current = Number.isFinite(origin) ? origin : 0;
  if (!Number.isFinite(threshold) || threshold < 0) {
    return { value: current, snapped: false, guide: null, delta: 0 };
  }

  let guide: number | null = null;
  let delta = Number.POSITIVE_INFINITY;
  const ownPoints = axisPoints(current, size);

  // Candidate order, then own-edge order, then candidate-guide order makes
  // equally-close outcomes stable without relying on engine sort behavior.
  for (const candidate of candidates) {
    const candidatePoints = axisPoints(
      axis === "x" ? candidate.x : candidate.y,
      axis === "x" ? candidate.width : candidate.height,
    );
    for (const ownPoint of ownPoints) {
      for (const candidatePoint of candidatePoints) {
        if (!Number.isFinite(candidatePoint)) {
          continue;
        }
        const candidateDelta = candidatePoint - ownPoint;
        if (
          Math.abs(candidateDelta) <= threshold &&
          Math.abs(candidateDelta) < Math.abs(delta)
        ) {
          guide = candidatePoint;
          delta = candidateDelta;
        }
      }
    }
  }

  return guide === null
    ? { value: current, snapped: false, guide: null, delta: 0 }
    : {
        value: current + delta,
        snapped: true,
        guide,
        delta,
      };
}

function unsnappedAlignment(value: number): AlignmentSnapResult {
  return {
    value: Number.isFinite(value) ? value : 0,
    snapped: false,
    guide: null,
    delta: 0,
  };
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
 * Snaps any card left/centre/right and top/centre/bottom point against a
 * candidate alignment guide. Rendering guides is deliberately left to the UI.
 */
export function snapCardPosition({
  rect,
  candidates,
  threshold,
}: CardSnapInput): CardSnapResult {
  const x = snapRectAxis(rect.x, rect.width, candidates, "x", threshold);
  const y = snapRectAxis(rect.y, rect.height, candidates, "y", threshold);

  return {
    rect: { ...rect, x: x.value, y: y.value },
    x,
    y,
    guides: {
      vertical: x.guide,
      horizontal: y.guide,
    },
  };
}

/**
 * Snaps the moving edge of a resize operation to another card's left/centre/
 * right or top/centre/bottom guide. The opposite edge remains anchored.
 */
export function snapCardResize({
  rect,
  candidates,
  edge,
  threshold,
  canvasWidth = contentSize(DEFAULT_PAGE_GEOMETRY).width,
  minimumWidth: requestedMinimumWidth,
  minimumHeight: requestedMinimumHeight,
  constrainToCanvas = true,
}: CardResizeSnapInput): CardSnapResult {
  let base = constrainToCanvas
    ? clampCardRect(rect, canvasWidth)
    : {
        x: Number.isFinite(rect.x) ? rect.x : 0,
        y: Number.isFinite(rect.y) ? rect.y : 0,
        width: Number.isFinite(rect.width) && rect.width > 0 ? rect.width : 0,
        height: Number.isFinite(rect.height) && rect.height > 0 ? rect.height : 0,
      };
  const availableWidth = positiveFinite(
    canvasWidth,
    contentSize(DEFAULT_PAGE_GEOMETRY).width,
  );
  const minimumWidth = constrainToCanvas
    ? Math.min(
        Number.isFinite(requestedMinimumWidth) && requestedMinimumWidth! > 0
          ? requestedMinimumWidth!
          : MIN_COMPONENT_WIDTH,
        availableWidth,
      )
    : Number.isFinite(requestedMinimumWidth) && requestedMinimumWidth! > 0
      ? requestedMinimumWidth!
      : 0;
  const minimumHeight =
    Number.isFinite(requestedMinimumHeight) && requestedMinimumHeight! > 0
      ? requestedMinimumHeight!
      : MIN_COMPONENT_HEIGHT;
  if (edge === "left" && base.width < minimumWidth) {
    const requestedRight = rect.x + rect.width;
    const right = Number.isFinite(requestedRight)
      ? Math.min(availableWidth, Math.max(0, requestedRight))
      : base.x + base.width;
    const width = Math.min(minimumWidth, right);
    base = { ...base, x: right - width, width };
  } else if (edge === "right" && base.width < minimumWidth) {
    base = {
      ...base,
      width: constrainToCanvas
        ? Math.min(minimumWidth, availableWidth - base.x)
        : minimumWidth,
    };
  } else if (edge === "top" && base.height < minimumHeight) {
    const requestedBottom = rect.y + rect.height;
    const bottom = Number.isFinite(requestedBottom)
      ? Math.max(0, requestedBottom)
      : base.y + base.height;
    const height = constrainToCanvas ? Math.min(minimumHeight, bottom) : minimumHeight;
    base = { ...base, y: bottom - height, height };
  } else if (edge === "bottom" && base.height < minimumHeight) {
    base = { ...base, height: minimumHeight };
  }
  let next = base;
  let x = unsnappedAlignment(base.x);
  let y = unsnappedAlignment(base.y);

  if (edge === "left" || edge === "right") {
    const activeEdge = edge === "left" ? base.x : base.x + base.width;
    x = snapAlignment({
      value: activeEdge,
      candidates: candidates.flatMap((candidate) =>
        axisPoints(candidate.x, candidate.width),
      ),
      threshold,
    });

    if (x.snapped && x.guide !== null) {
      const width =
        edge === "left"
          ? base.x + base.width - x.guide
          : x.guide - base.x;
      if (
        width >= minimumWidth &&
        (!constrainToCanvas || width <= availableWidth) &&
        (!constrainToCanvas || edge !== "left" || x.guide >= 0) &&
        (!constrainToCanvas || edge !== "right" || x.guide <= availableWidth)
      ) {
        next =
          edge === "left"
            ? { ...base, x: x.guide, width }
            : { ...base, width };
      } else {
        x = unsnappedAlignment(activeEdge);
      }
    }
  } else {
    const activeEdge = edge === "top" ? base.y : base.y + base.height;
    y = snapAlignment({
      value: activeEdge,
      candidates: candidates.flatMap((candidate) =>
        axisPoints(candidate.y, candidate.height),
      ),
      threshold,
    });

    if (y.snapped && y.guide !== null) {
      const height =
        edge === "top"
          ? base.y + base.height - y.guide
          : y.guide - base.y;
      if (
        height >= minimumHeight &&
        (!constrainToCanvas || edge !== "top" || y.guide >= 0)
      ) {
        next =
          edge === "top"
            ? { ...base, y: y.guide, height }
            : { ...base, height };
      } else {
        y = unsnappedAlignment(activeEdge);
      }
    }
  }

  return {
    rect: next,
    x,
    y,
    guides: {
      vertical: x.guide,
      horizontal: y.guide,
    },
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
