import { contentSize, DEFAULT_PAGE_GEOMETRY } from "./geometry";
import {
  clampHeight,
  clampImageHeight,
  clampWidth,
  DEFAULT_IMAGE_HEIGHT,
  DEFAULT_PLAN_HEIGHT,
  DEFAULT_REFERENCE_HEIGHT,
  EMPTY_PLAN,
  type PlanComponent,
  type ProjectPlan,
  type ReferenceImage,
} from "./models";

const MAX_HEIGHT = contentSize(DEFAULT_PAGE_GEOMETRY).height;

type IdFactory = (prefix: string) => string;

function defaultIdFactory(): IdFactory {
  let counter = 0;
  return (prefix) => `${prefix}-${(counter += 1)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asHeight(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? clampHeight(value, MAX_HEIGHT) : fallback;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// v3: images MUST have aspectRatio
function normalizeV3Images(value: unknown): ReferenceImage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const images: ReferenceImage[] = [];
  for (const raw of value) {
    if (isRecord(raw) && typeof raw.id === "string" && typeof raw.file === "string") {
      if (typeof raw.aspectRatio !== "number" || !Number.isFinite(raw.aspectRatio)) {
        continue; // drop images without valid aspectRatio
      }
      const aspectRatio = raw.aspectRatio > 0 ? raw.aspectRatio : 1;
      const image: ReferenceImage = { id: raw.id, file: raw.file, aspectRatio };
      if (typeof raw.caption === "string") {
        image.caption = raw.caption;
      }
      images.push(image);
    }
  }
  return images;
}

// v3: components MUST have width (and imageHeight for references)
function normalizeV3Component(raw: unknown, makeId: IdFactory): PlanComponent | null {
  if (!isRecord(raw)) {
    return null;
  }
  if (typeof raw.width !== "number" || !Number.isFinite(raw.width)) {
    return null; // drop components without valid width
  }
  const id = typeof raw.id === "string" && raw.id ? raw.id : makeId("cmp");
  const width = clampWidth(raw.width);
  if (raw.type === "plan") {
    return {
      id,
      type: "plan",
      width,
      height: asHeight(raw.height, DEFAULT_PLAN_HEIGHT),
      html: asString(raw.html),
    };
  }
  if (raw.type === "reference") {
    if (typeof raw.imageHeight !== "number" || !Number.isFinite(raw.imageHeight)) {
      return null; // drop references without valid imageHeight
    }
    return {
      id,
      type: "reference",
      width,
      height: asHeight(raw.height, DEFAULT_REFERENCE_HEIGHT),
      title: asString(raw.title),
      description: asString(raw.description),
      imageHeight: clampImageHeight(raw.imageHeight),
      showCaptions: raw.showCaptions === true,
      images: normalizeV3Images(raw.images),
    };
  }
  return null;
}

// v2->v3: add aspectRatio = 1 for images
function migrateV2Images(value: unknown): ReferenceImage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const images: ReferenceImage[] = [];
  for (const raw of value) {
    if (isRecord(raw) && typeof raw.id === "string" && typeof raw.file === "string") {
      const image: ReferenceImage = { id: raw.id, file: raw.file, aspectRatio: 1 };
      if (typeof raw.caption === "string") {
        image.caption = raw.caption;
      }
      images.push(image);
    }
  }
  return images;
}

// v2->v3: widthFraction -> width, drop columnsPerRow, add imageHeight
const FRACTION_TO_NUMBER: Record<string, number> = {
  "1": 1,
  "3/4": 0.75,
  "2/3": 0.667,
  "1/2": 0.5,
  "1/3": 0.333,
  "1/4": 0.25,
};

function migrateV2Component(raw: unknown, makeId: IdFactory): PlanComponent | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = typeof raw.id === "string" && raw.id ? raw.id : makeId("cmp");
  const widthFraction = typeof raw.widthFraction === "string" ? raw.widthFraction : "1";
  const width = FRACTION_TO_NUMBER[widthFraction] ?? 1;
  if (raw.type === "plan") {
    return {
      id,
      type: "plan",
      width,
      height: asHeight(raw.height, DEFAULT_PLAN_HEIGHT),
      html: asString(raw.html),
    };
  }
  if (raw.type === "reference") {
    return {
      id,
      type: "reference",
      width,
      height: asHeight(raw.height, DEFAULT_REFERENCE_HEIGHT),
      title: asString(raw.title),
      description: asString(raw.description),
      imageHeight: DEFAULT_IMAGE_HEIGHT,
      showCaptions: raw.showCaptions === true,
      images: migrateV2Images(raw.images),
    };
  }
  return null;
}

// v1->v2->v3 chain
function migrateV1ToV2(raw: Record<string, unknown>, makeId: IdFactory): Record<string, unknown> {
  const components: unknown[] = [];
  const photographyPlan = asString(raw.photographyPlan);
  if (photographyPlan.trim()) {
    components.push({
      id: makeId("plan"),
      type: "plan",
      widthFraction: "1",
      height: DEFAULT_PLAN_HEIGHT,
      html: photographyPlan,
    });
  }
  if (Array.isArray(raw.referenceGroups)) {
    for (const group of raw.referenceGroups) {
      if (!isRecord(group)) {
        continue;
      }
      components.push({
        id: typeof group.id === "string" && group.id ? group.id : makeId("ref"),
        type: "reference",
        widthFraction: "1",
        height: DEFAULT_REFERENCE_HEIGHT,
        title: asString(group.title),
        description: asString(group.description),
        columnsPerRow: 3,
        showCaptions: false,
        images: group.images,
      });
    }
  }
  return { schemaVersion: 2, components };
}

export function migratePlan(raw: unknown, makeId: IdFactory = defaultIdFactory()): ProjectPlan {
  if (!isRecord(raw)) {
    return EMPTY_PLAN;
  }
  // Forward compatibility: unknown schemaVersion > 3
  if (typeof raw.schemaVersion === "number" && raw.schemaVersion > 3) {
    return EMPTY_PLAN;
  }
  // v3: normalize
  if (raw.schemaVersion === 3 && Array.isArray(raw.components)) {
    const components = raw.components
      .map((component) => normalizeV3Component(component, makeId))
      .filter((component): component is PlanComponent => component !== null);
    return { schemaVersion: 3, components };
  }
  // v2->v3: migrate
  if (raw.schemaVersion === 2 && Array.isArray(raw.components)) {
    const components = raw.components
      .map((component) => migrateV2Component(component, makeId))
      .filter((component): component is PlanComponent => component !== null);
    return { schemaVersion: 3, components };
  }
  // v1->v2->v3: chain
  if (typeof raw.photographyPlan === "string" || Array.isArray(raw.referenceGroups)) {
    const v2 = migrateV1ToV2(raw, makeId);
    return migratePlan(v2, makeId);
  }
  return EMPTY_PLAN;
}
