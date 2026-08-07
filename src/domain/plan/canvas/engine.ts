import {
  componentFrameChromeHeight,
  contentSize,
  DEFAULT_PAGE_GEOMETRY,
  DOCUMENT_TITLE_HEIGHT,
  NO_COMPONENT_FRAME_CHROME,
  SPACING,
  type ComponentFrameChrome,
  type PageGeometry,
  type Rect,
} from "./geometry";
import {
  clampImageHeight,
  clampContentScale,
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
import { canAddToRow, nextRowItemOffset } from "./rowPacking";

const EPS = 0.01;
const FALLBACK_PLAN_HEIGHT = 56;

export const TITLE_BAND = 24; // points reserved for the reference title
export const DESCRIPTION_BAND = 40; // points reserved when a description is present

export function slotCaptionSplit(
  slot: Rect,
  captionHeight: number,
): { image: Rect; caption: Rect } {
  if (captionHeight <= 0) {
    return { image: slot, caption: { x: slot.x, y: slot.y + slot.height, width: slot.width, height: 0 } };
  }
  const imageHeight = Math.max(0, slot.height - captionHeight);
  return {
    image: { x: slot.x, y: slot.y, width: slot.width, height: imageHeight },
    caption: { x: slot.x, y: slot.y + imageHeight, width: slot.width, height: captionHeight },
  };
}

export function referenceImageSlots(
  rect: Rect,
  component: ReferenceComponent,
  geometry: PageGeometry = DEFAULT_PAGE_GEOMETRY,
): ReferenceFlowSlot[] {
  const top = TITLE_BAND + (component.showDescription && component.description.trim() ? DESCRIPTION_BAND : 0);
  const rows = packReferenceRows({
    images: component.images,
    imageHeight: clampImageHeight(component.imageHeight),
    innerWidth: rect.width - geometry.gutter,
    includeAddTile: false,
  });
  return rows.flatMap((row) => row.slots.map((slot) => ({
      ...slot,
      x: rect.x + slot.x,
      y: rect.y + top + slot.y,
    })));
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
  includeReferenceAddTile?: boolean | "empty";
  includeDocumentTitle?: boolean;
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

function componentScale(component: PlanComponent): number {
  return clampContentScale(component.contentScale);
}

function referenceDescriptionHeight(component: ReferenceComponent, measurements: LayoutMeasurements): number {
  if (!component.showDescription || !component.description.trim()) {
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
    const height =
      planHeight(entry.component.id, measurements) * componentScale(entry.component) +
      frameChromeHeight;
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

  const contentScale = componentScale(entry.component);
  const descriptionHeight = referenceDescriptionHeight(entry.component, measurements);
  const descriptionLayoutHeight =
    descriptionHeight > 0 ? descriptionHeight + REFERENCE_DESCRIPTION_GAP : 0;
  const innerWidth = Math.max(0, entry.width / contentScale - COMPONENT_INSET * 2);
  const descriptionFrameHeight =
    frameChromeHeight +
    (COMPONENT_INSET * 2 + REFERENCE_HEADER_HEIGHT + descriptionLayoutHeight) * contentScale;
  const availableHeight = Math.max(0, contentHeight - y);
  const firstAvailableRowHeight = Math.max(
    0,
    (availableHeight - descriptionFrameHeight) / contentScale,
  );
  const continuationAvailableRowHeight = Math.max(
    0,
    (contentHeight - frameChromeHeight) / contentScale -
      COMPONENT_INSET * 2 -
      REFERENCE_CONTINUATION_HEADER_HEIGHT,
  );
  const rows = packReferenceRows({
    images: entry.component.images,
    imageHeight: clampImageHeight(entry.component.imageHeight),
    innerWidth,
    includeAddTile:
      options.includeReferenceAddTile === "empty"
        ? entry.component.images.length === 0
        : options.includeReferenceAddTile !== false,
  });
  const descriptionEnd = endPosition(
    startSurfaceTop(pageIndex, y, geometry) + descriptionFrameHeight,
    geometry,
  );
  const descriptionSpansPages =
    descriptionHeight > 0 && descriptionEnd.pageIndex > pageIndex;
  const mustStartOnFreshPage =
    y > 0 &&
    descriptionFrameHeight <= contentHeight + EPS &&
    descriptionFrameHeight > availableHeight + EPS;

  if (descriptionSpansPages) {
    const rowFragments = paginateReferenceRows({
      rows,
      firstAvailableHeight: continuationAvailableRowHeight,
      continuationAvailableHeight: continuationAvailableRowHeight,
    });
    const placements: ComponentFragmentPlacement[] = [
      {
        fragmentId: fragmentId(entry.component.id, 0),
        componentId: entry.component.id,
        fragmentIndex: 0,
        pageIndex,
        kind: rowFragments.length > 0 ? "first" : "whole",
        rect: {
          x: entry.x,
          y,
          width: entry.width,
          height: descriptionFrameHeight,
        },
        imageSlots: [],
      },
      ...rowFragments.map((fragment, index) => ({
        fragmentId: fragmentId(entry.component.id, index + 1),
        componentId: entry.component.id,
        fragmentIndex: index + 1,
        pageIndex: descriptionEnd.pageIndex + index + 1,
        kind: "continuation" as const,
        rect: {
          x: entry.x,
          y: 0,
          width: entry.width,
          height:
            frameChromeHeight +
            (COMPONENT_INSET * 2 +
              REFERENCE_CONTINUATION_HEADER_HEIGHT +
              fragment.height) *
              contentScale,
        },
        imageSlots: fragment.rows.flatMap((row) =>
          row.slots.map((slot) => ({
            ...slot,
            y: slot.y + REFERENCE_CONTINUATION_HEADER_HEIGHT,
          })),
        ),
      })),
    ];
    const lastPlacement = placements[placements.length - 1];

    return {
      firstHeight: Math.min(descriptionFrameHeight, availableHeight),
      endPageIndex:
        rowFragments.length > 0
          ? lastPlacement.pageIndex
          : descriptionEnd.pageIndex,
      endY:
        rowFragments.length > 0
          ? lastPlacement.rect.y + lastPlacement.rect.height
          : descriptionEnd.y,
      mustStartOnFreshPage,
      placements,
    };
  }

  const paginatedRows = paginateReferenceRows({
    rows,
    firstAvailableHeight: firstAvailableRowHeight,
    continuationAvailableHeight: continuationAvailableRowHeight,
  });
  const fragments = paginatedRows.length > 0
    ? paginatedRows
    : [
        {
          fragmentIndex: 0,
          kind: "first" as const,
          height: 0,
          rows: [],
        },
      ];
  const multiPage = fragments.length > 1;
  const placements = fragments.map((fragment, index) => {
    const isFirst = index === 0;
    const headerHeight = isFirst
      ? REFERENCE_HEADER_HEIGHT + descriptionLayoutHeight
      : REFERENCE_CONTINUATION_HEADER_HEIGHT;
    const rectY = isFirst ? y : 0;
    const rectHeight =
      frameChromeHeight +
      (COMPONENT_INSET * 2 + headerHeight + fragment.height) * contentScale;

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
    firstHeight: Math.min(placements[0]?.rect.height ?? 0, availableHeight),
    endPageIndex: lastPlacement?.pageIndex ?? pageIndex,
    endY: lastPlacement ? lastPlacement.rect.y + lastPlacement.rect.height : y,
    mustStartOnFreshPage:
      mustStartOnFreshPage ||
      (y > 0 &&
        descriptionFrameHeight <= contentHeight + EPS &&
        firstAvailableRowHeight <= 0),
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

  for (const component of components) {
    const width = component.width * content.width;
    if (!canAddToRow(
      currentRow.map((entry) => entry.component.width),
      component.width,
      geometry,
    )) {
      rows.push(currentRow);
      currentRow = [];
    }

    const currentX = nextRowItemOffset(
      currentRow.map((entry) => entry.component.width),
      geometry,
    ) * content.width;
    currentRow.push({ component, x: currentX, width });
  }

  if (currentRow.length > 0) {
    rows.push(currentRow);
  }

  let pageIndex = 0;
  let y = options.includeDocumentTitle ? DOCUMENT_TITLE_HEIGHT + SPACING : 0;
  let highestContentPageIndex = 0;

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
    highestContentPageIndex = Math.max(highestContentPageIndex, endPageIndex);
    y = endY + geometry.rowGap;
    if (y > content.height + EPS) {
      pageIndex += 1;
      y = 0;
    }
  }

  const pageCount = placements.length === 0
    ? 1
    : Math.max(
        ...placements.map((placement) => placement.pageIndex),
        highestContentPageIndex,
      ) + 1;

  return { pageCount, placements };
}
