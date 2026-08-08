import {
  componentFrameChromeHeight,
  contentSize,
  DEFAULT_PAGE_GEOMETRY,
  EDITABLE_COMPONENT_FRAME_CHROME,
  type PageGeometry,
} from "./geometry";
import {
  MIN_COMPONENT_HEIGHT,
  MIN_IMAGE_HEIGHT,
  type PlanComponent,
  type ProjectPlan,
  type ReferenceComponent,
  type ReferenceImage,
} from "./models";
import {
  COMPONENT_INSET,
  packReferenceFrames,
  REFERENCE_DESCRIPTION_GAP,
  REFERENCE_DESCRIPTION_HEIGHT,
  REFERENCE_HEADER_GAP,
  REFERENCE_TITLE_ROW_HEIGHT,
} from "./referenceLayout";

const EMPTY_DESCRIPTION_CONTROL_HEIGHT = 24;
const EPSILON = 0.001;

export interface ReferenceContinuationOptions {
  makeId: () => string;
  geometry?: PageGeometry;
  descriptionHeights?: ReadonlyMap<string, number>;
}

function hasDescription(html: string): boolean {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .trim().length > 0;
}

function reservedHeight(
  component: ReferenceComponent,
  measuredDescriptionHeight?: number,
): number {
  const measured = Number.isFinite(measuredDescriptionHeight) && (measuredDescriptionHeight ?? 0) > 0
    ? measuredDescriptionHeight!
    : REFERENCE_DESCRIPTION_HEIGHT;
  const descriptionHeight = hasDescription(component.description)
    ? measured + REFERENCE_TITLE_ROW_HEIGHT + REFERENCE_DESCRIPTION_GAP * 2
    : EMPTY_DESCRIPTION_CONTROL_HEIGHT + REFERENCE_HEADER_GAP;
  return (
    componentFrameChromeHeight(EDITABLE_COMPONENT_FRAME_CHROME) +
    COMPONENT_INSET * 2 +
    REFERENCE_TITLE_ROW_HEIGHT +
    REFERENCE_HEADER_GAP +
    descriptionHeight
  );
}

function scaledImages(images: readonly ReferenceImage[], scale: number): ReferenceImage[] {
  return images.map((image) => ({
    ...image,
    frameWidth: Math.round(image.frameWidth * scale * 1000) / 1000,
    frameHeight: Math.round(image.frameHeight * scale * 1000) / 1000,
  }));
}

function contentHeight(
  component: ReferenceComponent,
  images: readonly ReferenceImage[],
  measuredDescriptionHeight?: number,
): number {
  const slots = packReferenceFrames({
    images,
    innerWidth: Math.max(0, component.width - COMPONENT_INSET * 2),
    includeAddTile: false,
  });
  const imageBottom = slots.reduce((bottom, slot) => Math.max(bottom, slot.y + slot.height), 0);
  return Math.max(
    MIN_COMPONENT_HEIGHT,
    reservedHeight(component, measuredDescriptionHeight) + imageBottom,
  );
}

function averageFrameHeight(component: ReferenceComponent): number {
  if (component.images.length === 0) {
    return 0;
  }
  return component.images.reduce((total, image) => total + image.frameHeight, 0) /
    component.images.length;
}

export function maximumFittingReferenceAverageHeight(
  component: ReferenceComponent,
  options: {
    minimum: number;
    step: number;
    geometry?: PageGeometry;
    measuredDescriptionHeight?: number;
  },
): number {
  const minimum = Number.isFinite(options.minimum) && options.minimum > 0
    ? options.minimum
    : 24;
  const step = Number.isFinite(options.step) && options.step > 0 ? options.step : 4;
  const maximumHeight = contentSize(options.geometry ?? DEFAULT_PAGE_GEOMETRY).height;
  const currentAverage = averageFrameHeight(component);
  if (currentAverage <= 0) {
    return minimum;
  }

  let maximum = minimum;
  for (let target = minimum; target <= maximumHeight + EPSILON; target += step) {
    const scaled = scaledImages(component.images, target / currentAverage);
    if (
      contentHeight(component, scaled, options.measuredDescriptionHeight) <=
      maximumHeight + EPSILON
    ) {
      maximum = target;
    }
  }
  return Math.round(maximum * 1000) / 1000;
}

function minimumScale(images: readonly ReferenceImage[]): number {
  if (images.length === 0) {
    return 1;
  }
  return Math.min(
    1,
    Math.max(
      ...images.map((image) =>
        image.frameHeight > 0 ? MIN_IMAGE_HEIGHT / image.frameHeight : 1,
      ),
    ),
  );
}

function largestFittingScale(
  component: ReferenceComponent,
  maximumHeight: number,
  measuredDescriptionHeight?: number,
): number | null {
  if (contentHeight(component, component.images, measuredDescriptionHeight) <= maximumHeight + EPSILON) {
    return 1;
  }

  const minimum = minimumScale(component.images);
  if (
    contentHeight(component, scaledImages(component.images, minimum), measuredDescriptionHeight) >
    maximumHeight + EPSILON
  ) {
    return null;
  }

  let low = minimum;
  let high = 1;
  for (let iteration = 0; iteration < 32; iteration += 1) {
    const middle = (low + high) / 2;
    if (
      contentHeight(component, scaledImages(component.images, middle), measuredDescriptionHeight) <=
      maximumHeight
    ) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return low;
}

function rowImageIds(component: ReferenceComponent, images: readonly ReferenceImage[]): string[][] {
  const slots = packReferenceFrames({
    images,
    innerWidth: Math.max(0, component.width - COMPONENT_INSET * 2),
    includeAddTile: false,
  });
  const rows: string[][] = [];
  let previousY: number | null = null;
  for (const slot of slots) {
    if (previousY === null || Math.abs(slot.y - previousY) > EPSILON) {
      rows.push([]);
      previousY = slot.y;
    }
    rows[rows.length - 1].push(slot.id);
  }
  return rows;
}

function continuationName(baseName: string, suffix: number, occupied: Set<string>): string {
  let candidateSuffix = suffix;
  let candidate = `${baseName} (${candidateSuffix})`;
  while (occupied.has(candidate)) {
    candidateSuffix += 1;
    candidate = `${baseName} (${candidateSuffix})`;
  }
  occupied.add(candidate);
  return candidate;
}

function splitAtMinimum(
  component: ReferenceComponent,
  maximumHeight: number,
  options: ReferenceContinuationOptions,
  occupiedNames: Set<string>,
  measuredDescriptionHeight?: number,
): ReferenceComponent[] {
  const minimum = minimumScale(component.images);
  const remaining = scaledImages(component.images, minimum);
  const groups: ReferenceComponent[] = [];
  let nextSuffix = 2;

  while (remaining.length > 0) {
    const template: ReferenceComponent = groups.length === 0
      ? component
      : {
          ...component,
          id: options.makeId(),
          name: continuationName(component.name, nextSuffix, occupiedNames),
          description: "",
          images: [],
        };
    if (groups.length > 0) {
      nextSuffix += 1;
    }
    const rows = rowImageIds(template, remaining);
    let take = 0;

    for (const row of rows) {
      const candidateCount = take + row.length;
      const candidate = remaining.slice(0, candidateCount);
      if (
        contentHeight(
          template,
          candidate,
          groups.length === 0 ? measuredDescriptionHeight : undefined,
        ) > maximumHeight + EPSILON
      ) {
        break;
      }
      take = candidateCount;
    }

    if (take === 0) {
      throw new RangeError(`Reference component ${component.id} has an image row taller than one A4 page`);
    }

    const images = remaining.splice(0, take);
    groups.push({
      ...template,
      height: contentHeight(
        template,
        images,
        groups.length === 0 ? measuredDescriptionHeight : undefined,
      ),
      images,
    });
  }

  return groups;
}

function normalizeReference(
  component: ReferenceComponent,
  maximumHeight: number,
  options: ReferenceContinuationOptions,
  occupiedNames: Set<string>,
): ReferenceComponent[] {
  const measuredDescriptionHeight = options.descriptionHeights?.get(component.id);
  const naturalHeight = contentHeight(component, component.images, measuredDescriptionHeight);
  const scale = largestFittingScale(component, maximumHeight, measuredDescriptionHeight);
  if (scale === 1) {
    if (Math.abs(component.height - naturalHeight) <= EPSILON) {
      return [component];
    }
    return [{ ...component, height: naturalHeight }];
  }
  if (scale !== null) {
    const images = scaledImages(component.images, scale);
    const height = contentHeight(component, images, measuredDescriptionHeight);
    return [{ ...component, height, images }];
  }
  return splitAtMinimum(
    component,
    maximumHeight,
    options,
    occupiedNames,
    measuredDescriptionHeight,
  );
}

export function normalizeReferenceContinuations(
  plan: ProjectPlan,
  options: ReferenceContinuationOptions,
): ProjectPlan {
  const maximumHeight = contentSize(options.geometry ?? DEFAULT_PAGE_GEOMETRY).height;
  const occupiedNames = new Set(plan.components.map((component) => component.name));
  let changed = false;
  const components: PlanComponent[] = [];
  for (const component of plan.components) {
    if (component.type !== "reference") {
      components.push(component);
      continue;
    }
    const normalized = normalizeReference(component, maximumHeight, options, occupiedNames);
    if (normalized.length !== 1 || normalized[0] !== component) {
      changed = true;
    }
    components.push(...normalized);
  }

  return changed ? { ...plan, components } : plan;
}