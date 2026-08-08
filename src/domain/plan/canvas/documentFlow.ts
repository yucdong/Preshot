import {
  clampCardRect,
  contentSize,
  DEFAULT_PAGE_GEOMETRY,
  type PageGeometry,
  type Rect,
} from "./geometry";
import { DOCUMENT_TITLE_HEIGHT, SPACING } from "./geometry";
import type { PlanComponent } from "./models";

const EPSILON = 0.001;

export interface DocumentFlowPlacement {
  componentId: string;
  pageIndex: number;
  rect: Rect;
}

export interface DocumentFlowResult {
  pageCount: number;
  placements: DocumentFlowPlacement[];
}

export interface DocumentFlowOptions {
  includeDocumentTitle?: boolean;
}

export function layoutDocumentFlow(
  components: readonly PlanComponent[],
  geometry: PageGeometry = DEFAULT_PAGE_GEOMETRY,
  options: DocumentFlowOptions = {},
): DocumentFlowResult {
  const content = contentSize(geometry);
  const includeDocumentTitle = options.includeDocumentTitle ?? true;
  const placements: DocumentFlowPlacement[] = [];
  let pageIndex = 0;
  let y = includeDocumentTitle ? DOCUMENT_TITLE_HEIGHT + SPACING : 0;

  for (const component of components) {
    const rect = clampCardRect({ ...component, y: 0 }, content.width);
    if (rect.height > content.height + EPSILON) {
      throw new RangeError(
        `Component ${component.id} is taller than one printable A4 page and must be split before layout`,
      );
    }

    if (y + rect.height > content.height + EPSILON) {
      pageIndex += 1;
      y = 0;
    }

    placements.push({
      componentId: component.id,
      pageIndex,
      rect: { x: rect.x, y, width: rect.width, height: rect.height },
    });
    y += rect.height + geometry.rowGap;
  }

  return {
    pageCount: Math.max(1, pageIndex + 1),
    placements,
  };
}