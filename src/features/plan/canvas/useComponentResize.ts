import { snapWidthFraction, type WidthFraction } from "../../../domain/plan/canvas/models";

export interface ResizeFromDragParams {
  widthFraction: WidthFraction;
  height: number;
  edge: "width" | "height" | "both";
  dxPoints: number;
  dyPoints: number;
  currentWidthPoints: number;
  contentWidth: number;
}

export interface ResizeResult {
  widthFraction?: WidthFraction;
  height?: number;
}

/**
 * Pure helper that computes the new width fraction and/or height from a drag resize
 * operation. Width edge snaps to the nearest width fraction; height edge adds dyPoints
 * to the current height; both does both.
 */
export function resizeFromDrag(params: ResizeFromDragParams): ResizeResult {
  const { edge, dxPoints, dyPoints, currentWidthPoints, contentWidth, height } = params;

  const result: ResizeResult = {};

  if (edge === "width" || edge === "both") {
    const newWidthPoints = currentWidthPoints + dxPoints;
    const ratio = newWidthPoints / contentWidth;
    result.widthFraction = snapWidthFraction(ratio);
  }

  if (edge === "height" || edge === "both") {
    result.height = height + dyPoints;
  }

  return result;
}
