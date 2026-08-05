import {
  clampImageHeight,
  clampWidth,
  CURRENT_SCHEMA_VERSION,
  DEFAULT_IMAGE_HEIGHT,
  EMPTY_PLAN,
  type PlanComponent,
  type ProjectPlan,
  type ReferenceImage,
} from "./models";

type IdFactory = (prefix: string) => string;

function defaultIdFactory(): IdFactory {
  let counter = 0;
  return (prefix) => `${prefix}-${(counter += 1)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeAspectRatio(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value > 0 ? value : 1;
}

function normalizeV4Images(value: unknown): ReferenceImage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const images: ReferenceImage[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.file !== "string") {
      continue;
    }
    const aspectRatio = normalizeAspectRatio(raw.aspectRatio);
    if (aspectRatio === null) {
      continue;
    }
    const image: ReferenceImage = { id: raw.id, file: raw.file, aspectRatio };
    if (typeof raw.caption === "string") {
      image.caption = raw.caption;
    }
    images.push(image);
  }
  return images;
}

function normalizeComponentFields(raw: unknown, makeId: IdFactory): PlanComponent | null {
  if (!isRecord(raw)) {
    return null;
  }
  if (typeof raw.width !== "number" || !Number.isFinite(raw.width)) {
    return null;
  }
  const id = typeof raw.id === "string" && raw.id ? raw.id : makeId("cmp");
  const width = clampWidth(raw.width);

  if (raw.type === "plan") {
    return {
      id,
      type: "plan",
      width,
      html: asString(raw.html),
    };
  }

  if (raw.type === "reference") {
    if (typeof raw.imageHeight !== "number" || !Number.isFinite(raw.imageHeight)) {
      return null;
    }
    return {
      id,
      type: "reference",
      width,
      title: asString(raw.title),
      description: asString(raw.description),
      imageHeight: clampImageHeight(raw.imageHeight),
      showCaptions: raw.showCaptions === true,
      images: normalizeV4Images(raw.images),
    };
  }

  return null;
}

function normalizeV4Component(raw: unknown, makeId: IdFactory): PlanComponent | null {
  return normalizeComponentFields(raw, makeId);
}

function migrateV3Component(raw: unknown, makeId: IdFactory): PlanComponent | null {
  if (!isRecord(raw)) {
    return null;
  }
  const normalized = normalizeComponentFields(raw, makeId);
  if (!normalized) {
    return null;
  }
  if (normalized.type === "reference") {
    const legacyImageHeight =
      typeof raw.imageHeight === "number" && Number.isFinite(raw.imageHeight)
        ? raw.imageHeight
        : normalized.imageHeight;
    return {
      ...normalized,
      imageHeight: clampImageHeight(legacyImageHeight * 0.75),
    };
  }
  return normalized;
}

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
      html: asString(raw.html),
    };
  }

  if (raw.type === "reference") {
    return {
      id,
      type: "reference",
      width,
      title: asString(raw.title),
      description: asString(raw.description),
      imageHeight: DEFAULT_IMAGE_HEIGHT,
      showCaptions: raw.showCaptions === true,
      images: migrateV2Images(raw.images),
    };
  }

  return null;
}

function migrateV1ToV2(raw: Record<string, unknown>, makeId: IdFactory): Record<string, unknown> {
  const components: unknown[] = [];
  const photographyPlan = asString(raw.photographyPlan);
  if (photographyPlan.trim()) {
    components.push({
      id: makeId("plan"),
      type: "plan",
      widthFraction: "1",
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
  if (typeof raw.schemaVersion === "number" && raw.schemaVersion > CURRENT_SCHEMA_VERSION) {
    return EMPTY_PLAN;
  }
  if (raw.schemaVersion === 4 && Array.isArray(raw.components)) {
    return {
      schemaVersion: 4,
      components: raw.components
        .map((value) => normalizeV4Component(value, makeId))
        .filter((value): value is PlanComponent => value !== null),
    };
  }
  if (raw.schemaVersion === 3 && Array.isArray(raw.components)) {
    return {
      schemaVersion: 4,
      components: raw.components
        .map((value) => migrateV3Component(value, makeId))
        .filter((value): value is PlanComponent => value !== null),
    };
  }
  if (raw.schemaVersion === 2 && Array.isArray(raw.components)) {
    return {
      schemaVersion: 4,
      components: raw.components
        .map((value) => migrateV2Component(value, makeId))
        .filter((value): value is PlanComponent => value !== null),
    };
  }
  if (typeof raw.photographyPlan === "string" || Array.isArray(raw.referenceGroups)) {
    return migratePlan(migrateV1ToV2(raw, makeId), makeId);
  }
  return EMPTY_PLAN;
}
