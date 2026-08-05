import {
  componentFrameChromeHeight,
  contentSize,
  DEFAULT_PAGE_GEOMETRY,
  NO_COMPONENT_FRAME_CHROME,
  packAspectRow,
  type ComponentFrameChrome,
  type PageGeometry,
  type Rect,
} from "./geometry";
import {
  clampImageHeight,
  type PlanComponent,
  type ReferenceComponent,
} from "./models";
import {
  COMPONENT_INSET,
  packReferenceRows,
  paginateReferenceRows,
  REFERENCE_CONTINUATION_HEADER_HEIGHT,
  REFERENCE_DESCRIPTION_GAP,
  REFERENCE_DESCRIPTION_HEIGHT,
  REFERENCE_HEADER_HEIGHT,
  type ReferenceFlowSlot,
} from "./referenceLayout";

const EPS = 0.01;
const FALLBACK_PLAN_HEIGHT = 56;

export const TITLE_BAND = 24; // points reserved for the reference title
export const DESCRIPTION_BAND = 40; // points reserved when a description is present

export function slotCaptionSplit(
  slot: Rect,
  showCaptions: boolean,
): { image: Rect; caption: Rect } {
  if (!showCaptions) {
    return { image: slot, caption: { x: slot.x, y: slot.y + slot.height, width: slot.width, height: 0 } };
  }
  const captionHeight = Math.round(slot.height / 4); // tile = image + caption; caption ~1/3 of image
  const imageHeight = slot.height - captionHeight;
  return {
    image: { x: slot.x, y: slot.y, width: slot.width, height: imageHeight },
    caption: { x: slot.x, y: slot.y + imageHeight, width: slot.width, height: captionHeight },
  };
}

export function referenceImageSlots(
  rect: Rect,
  component: ReferenceComponent,
  geometry: PageGeometry = DEFAULT_PAGE_GEOMETRY,
): Rect[] {
  const top = TITLE_BAND + (component.description.trim() ? DESCRIPTION_BAND : 0);
  const innerWidth = rect.width - geometry.gutter;
  const ih = clampImageHeight(component.imageHeight);
  const slotHeight = component.showCaptions ? Math.round((ih * 4) / 3) : ih;
  const items = component.images.map((img) => ({ aspectRatio: img.aspectRatio }));
  const { rects } = packAspectRow(items, ih, innerWidth, geometry.gutter);
  let rowIndex = 0;
  return rects.map((r, i) => {
    if (i > 0 && r.x === 0) rowIndex += 1;               // packer starts each new row at x === 0
    return {
      x: rect.x + r.x,
      y: rect.y + top + rowIndex * (slotHeight + geometry.gutter),
      width: r.width,                                     // = ih × aspectRatio (correct — unchanged)
      height: slotHeight,                                 // image + caption band; slotCaptionSplit peels the caption
    };
  });
}

export interface LayoutMeasurements {
  planHeights: ReadonlyMap<string, number>;
  referenceDescriptionHeights: ReadonlyMap<string, number>;
}

export interface ComponentFragmentPlacement {
  fragmentId: string;
  componentId: string;
  fragmentIndex: number;
  pageIndex: number;
  kind: "whole" | "first" | "continuation";
  rect: Rect; // page-content-relative points (origin at the page's top-left margin)
  imageSlots?: ReferenceFlowSlot[];
}

export interface LayoutResult {
  pageCount: number;
  placements: ComponentFragmentPlacement[];
}

export interface LayoutOptions {
  frameChrome: ComponentFrameChrome;
}

export type Placement = ComponentFragmentPlacement;

const EMPTY_LAYOUT_MEASUREMENTS: LayoutMeasurements = {
  planHeights: new Map(),
  referenceDescriptionHeights: new Map(),
};

const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  frameChrome: NO_COMPONENT_FRAME_CHROME,
};

function planHeight(id: string, measurements: LayoutMeasurements): number {
  const value = measurements.planHeights.get(id);
  return Number.isFinite(value) && (value ?? 0) > 0 ? value! : FALLBACK_PLAN_HEIGHT;
}

function referenceDescriptionHeight(component: ReferenceComponent, measurements: LayoutMeasurements): number {
  if (!component.description.trim()) {
    return 0;
  }

  const value = measurements.referenceDescriptionHeights.get(component.id);
  return Number.isFinite(value) && (value ?? 0) >= 0 ? value! : REFERENCE_DESCRIPTION_HEIGHT;
}

function fragmentId(componentId: string, fragmentIndex: number): string {
  return `${componentId}::${fragmentIndex}`;
}

function pageSurfaceHeight(geometry: PageGeometry): number {
  return geometry.page.height + (geometry.pageGap ?? 0);
}

function startSurfaceTop(pageIndex: number, y: number, geometry: PageGeometry): number {
  return pageIndex * pageSurfaceHeight(geometry) + geometry.margin + y;
}

function endPosition(surfaceBottom: number, geometry: PageGeometry): { pageIndex: number; y: number } {
  const span = pageSurfaceHeight(geometry);
  const adjustedBottom = Math.max(0, surfaceBottom - EPS);
  const pageIndex = Math.max(0, Math.floor(adjustedBottom / span));
  const y = Math.max(0, surfaceBottom - pageIndex * span - geometry.margin);
  return { pageIndex, y: Math.abs(y) < EPS ? 0 : y };
}

interface PendingRowComponent {
  component: PlanComponent;
  x: number;
  width: number;
}

interface ComponentLayout {
  firstHeight: number;
  endPageIndex: number;
  endY: number;
  mustStartOnFreshPage: boolean;
  placements: ComponentFragmentPlacement[];
}

function layoutPlanComponent(
  entry: PendingRowComponent,
  pageIndex: number,
  y: number,
  contentHeight: number,
  measurements: LayoutMeasurements,
  geometry: PageGeometry,
  options: LayoutOptions,
): ComponentLayout {
  const frameChromeHeight = componentFrameChromeHeight(options.frameChrome);

  if (entry.component.type === "plan") {
    const height = planHeight(entry.component.id, measurements) + frameChromeHeight;
    const firstHeight = Math.min(height, Math.max(0, contentHeight - y));
    const end = endPosition(startSurfaceTop(pageIndex, y, geometry) + height, geometry);
    return {
      firstHeight,
      endPageIndex: end.pageIndex,
      endY: end.y,
      mustStartOnFreshPage: false,
      placements: [
        {
          fragmentId: fragmentId(entry.component.id, 0),
          componentId: entry.component.id,
          fragmentIndex: 0,
          pageIndex,
          kind: "whole",
          rect: { x: entry.x, y, width: entry.width, height },
        },
      ],
    };
  }

  const descriptionHeight = referenceDescriptionHeight(entry.component, measurements);
  const descriptionLayoutHeight =
    descriptionHeight > 0 ? descriptionHeight + REFERENCE_DESCRIPTION_GAP : 0;
  const innerWidth = Math.max(0, entry.width - COMPONENT_INSET * 2);
  const firstAvailableRowHeight = Math.max(
    0,
    contentHeight -
      y -
      frameChromeHeight -
      COMPONENT_INSET * 2 -
      REFERENCE_HEADER_HEIGHT -
      descriptionLayoutHeight,
  );
  const continuationAvailableRowHeight = Math.max(
    0,
    contentHeight -
      frameChromeHeight -
      COMPONENT_INSET * 2 -
      REFERENCE_CONTINUATION_HEADER_HEIGHT,
  );
  const rows = packReferenceRows({
    images: entry.component.images,
    imageHeight: clampImageHeight(entry.component.imageHeight),
    showCaptions: entry.component.showCaptions,
    innerWidth,
  });
  const fragments = paginateReferenceRows({
    rows,
    firstAvailableHeight: firstAvailableRowHeight,
    continuationAvailableHeight: continuationAvailableRowHeight,
  });
  const multiPage = fragments.length > 1;
  const placements = fragments.map((fragment, index) => {
    const isFirst = index === 0;
    const headerHeight = isFirst
      ? REFERENCE_HEADER_HEIGHT + descriptionLayoutHeight
      : REFERENCE_CONTINUATION_HEADER_HEIGHT;
    const rectY = isFirst ? y : 0;
    const rectHeight =
      frameChromeHeight + COMPONENT_INSET * 2 + headerHeight + fragment.height;

    return {
      fragmentId: fragmentId(entry.component.id, fragment.fragmentIndex),
      componentId: entry.component.id,
      fragmentIndex: fragment.fragmentIndex,
      pageIndex: pageIndex + index,
      kind: multiPage ? (isFirst ? "first" : "continuation") : "whole",
      rect: {
        x: entry.x,
        y: rectY,
        width: entry.width,
        height: rectHeight,
      },
      imageSlots: fragment.rows.flatMap((row) =>
        row.slots.map((slot) => ({
          ...slot,
          y: slot.y + headerHeight,
        })),
      ),
    } satisfies ComponentFragmentPlacement;
  });
  const lastPlacement = placements[placements.length - 1];

  return {
    firstHeight: placements[0]?.rect.height ?? 0,
    endPageIndex: lastPlacement?.pageIndex ?? pageIndex,
    endY: lastPlacement ? lastPlacement.rect.y + lastPlacement.rect.height : y,
    mustStartOnFreshPage: y > 0 && firstAvailableRowHeight <= 0,
    placements,
  };
}

export function layoutPlan(
  components: PlanComponent[],
  geometry: PageGeometry = DEFAULT_PAGE_GEOMETRY,
  measurements: LayoutMeasurements = EMPTY_LAYOUT_MEASUREMENTS,
  options: LayoutOptions = DEFAULT_LAYOUT_OPTIONS,
): LayoutResult {
  const content = contentSize(geometry);
  const placements: ComponentFragmentPlacement[] = [];

  if (components.length === 0) {
    return { pageCount: 1, placements };
  }

  const rows: PendingRowComponent[][] = [];
  let currentRow: PendingRowComponent[] = [];
  let currentX = 0;

  for (const component of components) {
    const width = component.width * content.width;
    if (currentRow.length > 0 && currentX + width > content.width + EPS) {
      rows.push(currentRow);
      currentRow = [];
      currentX = 0;
    }

    currentRow.push({ component, x: currentX, width });
    currentX += width;
  }

  if (currentRow.length > 0) {
    rows.push(currentRow);
  }

  let pageIndex = 0;
  let y = 0;

  for (const row of rows) {
    let layouts = row.map((entry) =>
      layoutPlanComponent(entry, pageIndex, y, content.height, measurements, geometry, options),
    );
    let rowHeight = Math.max(...layouts.map((layout) => layout.firstHeight), 0);
    const availableHeight = content.height - y;

    if (
      y > 0 &&
      (rowHeight > availableHeight + EPS || layouts.some((layout) => layout.mustStartOnFreshPage))
    ) {
      pageIndex += 1;
      y = 0;
      layouts = row.map((entry) =>
        layoutPlanComponent(entry, pageIndex, y, content.height, measurements, geometry, options),
      );
      rowHeight = Math.max(...layouts.map((layout) => layout.firstHeight), 0);
    }

    layouts.forEach((layout) => placements.push(...layout.placements));

    let endPageIndex = pageIndex;
    let endY = y + rowHeight;

    for (const layout of layouts) {
      if (
        layout.endPageIndex > endPageIndex ||
        (layout.endPageIndex === endPageIndex && layout.endY > endY)
      ) {
        endPageIndex = layout.endPageIndex;
        endY = layout.endY;
      }
    }

    pageIndex = endPageIndex;
    y = endY + geometry.rowGap;
    if (y > content.height + EPS) {
      pageIndex += 1;
      y = 0;
    }
  }

  const pageCount = placements.length === 0
    ? 1
    : Math.max(...placements.map((placement) => placement.pageIndex), pageIndex) + 1;

  return { pageCount, placements };
}
