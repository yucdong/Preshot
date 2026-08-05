import { clampWidth } from "../../../domain/plan/canvas/models";

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
