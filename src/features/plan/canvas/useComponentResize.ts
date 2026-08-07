import {
  clampContentScale,
  clampWidth,
  DEFAULT_WIDTH,
  MAX_CONTENT_SCALE,
  MIN_CONTENT_SCALE,
  MIN_WIDTH,
} from "../../../domain/plan/canvas/models";

export interface ResizeFromDragParams {
  dxPoints: number;
  currentWidthPoints: number;
  contentWidth: number;
}

export interface ResizeResult {
  width: number;
}

export function resizeFromDrag(params: ResizeFromDragParams): ResizeResult {
  const newWidthPoints = params.currentWidthPoints + params.dxPoints;
  const ratio = newWidthPoints / params.contentWidth;
  return { width: clampWidth(ratio) };
}

export interface ContentScaleResizeParams {
  dyPoints: number;
  currentWidth: number;
  currentContentScale: number;
  currentHeightPoints: number;
}

export interface ContentScaleResizeResult extends ResizeResult {
  contentScale: number;
}

export function resizeContentScaleFromDrag(
  params: ContentScaleResizeParams,
): ContentScaleResizeResult {
  const currentScale = clampContentScale(params.currentContentScale);
  const currentWidth = clampWidth(params.currentWidth);
  const height = Number.isFinite(params.currentHeightPoints) && params.currentHeightPoints > 0
    ? params.currentHeightPoints
    : 1;
  const requestedScale = clampContentScale(
    currentScale * (1 + params.dyPoints / height),
  );
  const minimumScale = Math.max(
    MIN_CONTENT_SCALE,
    (MIN_WIDTH * currentScale) / currentWidth,
  );
  const maximumScale = Math.min(
    MAX_CONTENT_SCALE,
    (DEFAULT_WIDTH * currentScale) / currentWidth,
  );
  const contentScale = Math.min(
    maximumScale,
    Math.max(minimumScale, requestedScale),
  );

  return {
    contentScale,
    width: clampWidth(currentWidth * (contentScale / currentScale)),
  };
}
