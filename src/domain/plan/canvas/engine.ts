import { contentSize, DEFAULT_PAGE_GEOMETRY, type PageGeometry, type Rect } from "./geometry";
import { clampHeight, fractionValue, type PlanComponent } from "./models";

const EPS = 0.01;

export interface Placement {
  componentId: string;
  pageIndex: number;
  rect: Rect; // page-content-relative points (origin at the page's top-left margin)
  imageSlots?: Rect[];
}

export interface LayoutResult {
  pageCount: number;
  placements: Placement[];
}

export function layoutPlan(
  components: PlanComponent[],
  geometry: PageGeometry = DEFAULT_PAGE_GEOMETRY,
): LayoutResult {
  const content = contentSize(geometry);
  const placements: Placement[] = [];

  let pageIndex = 0;
  let x = 0;
  let y = 0;
  let rowHeight = 0;

  for (const component of components) {
    const width = fractionValue(component.widthFraction) * content.width;
    const height = clampHeight(component.height, content.height);

    // Wrap to a new row when the component does not fit the remaining row width.
    if (x + width > content.width + EPS) {
      x = 0;
      y += rowHeight + geometry.rowGap;
      rowHeight = 0;
    }

    // Move to a new page when the component does not fit the remaining page height.
    if (y + height > content.height + EPS) {
      pageIndex += 1;
      x = 0;
      y = 0;
      rowHeight = 0;
    }

    placements.push({ componentId: component.id, pageIndex, rect: { x, y, width, height } });

    x += width;
    rowHeight = Math.max(rowHeight, height);
  }

  return { pageCount: pageIndex + 1, placements };
}
