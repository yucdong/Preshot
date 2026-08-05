import { A4 } from "../../../domain/plan/canvas/geometry";

export const PAGE_SCREEN_GAP = 16;

export function pageTopPx(pageIndex: number, scale: number): number {
  return pageIndex * (A4.height * scale + PAGE_SCREEN_GAP);
}
