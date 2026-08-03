import { layoutPlan, type Placement } from "../engine";
import { DEFAULT_PAGE_GEOMETRY, type PageGeometry } from "../geometry";
import type { PlanComponent } from "../models";

export interface CanvasLayout {
  pageCount: number;
  placements: Placement[];
}

export function buildCanvasLayout(
  components: PlanComponent[],
  geometry: PageGeometry = DEFAULT_PAGE_GEOMETRY,
): CanvasLayout {
  return layoutPlan(components, geometry);
}
