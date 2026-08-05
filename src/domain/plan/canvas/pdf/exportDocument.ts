import { layoutPlan, type LayoutMeasurements, type LayoutResult } from "../engine";
import { DEFAULT_PAGE_GEOMETRY, type PageGeometry } from "../geometry";
import type { PlanComponent } from "../models";

export type CanvasLayout = LayoutResult;

export function buildCanvasLayout(
  components: PlanComponent[],
  geometry: PageGeometry = DEFAULT_PAGE_GEOMETRY,
  measurements?: LayoutMeasurements,
): CanvasLayout {
  return layoutPlan(components, geometry, measurements);
}
