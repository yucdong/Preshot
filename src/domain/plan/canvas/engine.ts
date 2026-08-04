import { contentSize, DEFAULT_PAGE_GEOMETRY, packAspectRow, type PageGeometry, type Rect } from "./geometry";
import { clampHeight, clampImageHeight, DEFAULT_IMAGE_HEIGHT, effectiveWidth, type PlanComponent, type ReferenceComponent } from "./models";

const EPS = 0.01;

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
  const ih = clampImageHeight(component.imageHeight ?? DEFAULT_IMAGE_HEIGHT);
  const slotHeight = component.showCaptions ? Math.round((ih * 4) / 3) : ih;
  const items = component.images.map((img) => ({ aspectRatio: img.aspectRatio ?? 1 }));
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
    const width = effectiveWidth(component) * content.width;
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

    const placement: Placement = {
      componentId: component.id,
      pageIndex,
      rect: { x, y, width, height },
    };
    if (component.type === "reference") {
      // slots are relative to the component rect's own origin (0,0-based within the component)
      placement.imageSlots = referenceImageSlots({ x: 0, y: 0, width, height }, component, geometry);
    }
    placements.push(placement);

    x += width;
    rowHeight = Math.max(rowHeight, height);
  }

  return { pageCount: pageIndex + 1, placements };
}
