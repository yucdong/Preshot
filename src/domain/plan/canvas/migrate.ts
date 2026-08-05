import {
  clampImageHeight,
  clampWidth,
  CURRENT_SCHEMA_VERSION,
  DEFAULT_IMAGE_HEIGHT,
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

function normalizeAspectRatio(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 1;
}

function normalizeV4Images(value: unknown, componentIndex: number): ReferenceImage[] {
  if (!Array.isArray(value)) {
    throw new Error(`Stored plan component ${componentIndex} images must be an array`);
  }
  return value.map((raw, imageIndex) => {
    if (
      !isRecord(raw) ||
      typeof raw.id !== "string" ||
      raw.id.length === 0 ||
      typeof raw.file !== "string" ||
      raw.file.length === 0
    ) {
      throw new Error(
        `Stored plan component ${componentIndex} image ${imageIndex} must have non-empty string id and file fields`,
      );
    }
    if (raw.caption !== undefined && typeof raw.caption !== "string") {
      throw new Error(
        `Stored plan component ${componentIndex} image ${imageIndex} caption must be a string`,
      );
    }
    const aspectRatio = normalizeAspectRatio(raw.aspectRatio);
    const image: ReferenceImage = { id: raw.id, file: raw.file, aspectRatio };
    if (typeof raw.caption === "string") {
      image.caption = raw.caption;
    }
    return image;
  });
}

function normalizeComponentFields(
  raw: unknown,
  _makeId: IdFactory,
  componentIndex: number,
): PlanComponent | null {
  if (!isRecord(raw)) {
    return null;
  }
  if (typeof raw.id !== "string" || raw.id.length === 0) {
    throw new Error(`Stored plan component ${componentIndex} id must be a non-empty string`);
  }
  if (typeof raw.width !== "number" || !Number.isFinite(raw.width)) {
    return null;
  }
  const id = raw.id;
  const width = clampWidth(raw.width);

  if (raw.type === "plan") {
    if (typeof raw.html !== "string") {
      throw new Error(`Stored plan component ${componentIndex} html must be a string`);
    }
    return {
      id,
      type: "plan",
      width,
      html: raw.html,
    };
  }

  if (raw.type === "reference") {
    if (typeof raw.imageHeight !== "number" || !Number.isFinite(raw.imageHeight)) {
      return null;
    }
    if (typeof raw.title !== "string") {
      throw new Error(`Stored plan component ${componentIndex} title must be a string`);
    }
    if (typeof raw.description !== "string") {
      throw new Error(`Stored plan component ${componentIndex} description must be a string`);
    }
    if (typeof raw.showCaptions !== "boolean") {
      throw new Error(`Stored plan component ${componentIndex} showCaptions must be a boolean`);
    }
    return {
      id,
      type: "reference",
      width,
      title: raw.title,
      description: raw.description,
      imageHeight: clampImageHeight(raw.imageHeight),
      showCaptions: raw.showCaptions,
      images: normalizeV4Images(raw.images, componentIndex),
    };
  }

  return null;
}

function normalizeV4Component(
  raw: unknown,
  makeId: IdFactory,
  componentIndex: number,
): PlanComponent | null {
  return normalizeComponentFields(raw, makeId, componentIndex);
}

function migrateV3Component(
  raw: unknown,
  makeId: IdFactory,
  componentIndex: number,
): PlanComponent | null {
  if (!isRecord(raw)) {
    return null;
  }
  const normalized = normalizeComponentFields(raw, makeId, componentIndex);
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

function migrateV2Images(value: unknown, componentIndex: number): ReferenceImage[] {
  if (!Array.isArray(value)) {
    throw new Error(`Stored plan component ${componentIndex} images must be an array`);
  }
  return value.map((raw, imageIndex) => {
    if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.file !== "string") {
      throw new Error(
        `Stored plan component ${componentIndex} image ${imageIndex} must have string id and file fields`,
      );
    }
    const image: ReferenceImage = { id: raw.id, file: raw.file, aspectRatio: 1 };
    if (typeof raw.caption === "string") {
      image.caption = raw.caption;
    }
    return image;
  });
}

const FRACTION_TO_NUMBER: Record<string, number> = {
  "1": 1,
  "3/4": 0.75,
  "2/3": 0.667,
  "1/2": 0.5,
  "1/3": 0.333,
  "1/4": 0.25,
};

function migrateV2Component(
  raw: unknown,
  makeId: IdFactory,
  componentIndex: number,
): PlanComponent | null {
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
      images: migrateV2Images(raw.images, componentIndex),
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
    for (const [groupIndex, group] of raw.referenceGroups.entries()) {
      if (!isRecord(group)) {
        throw new Error(`Stored plan reference group ${groupIndex} must be an object`);
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

function migrateComponents(
  rawComponents: unknown[],
  makeId: IdFactory,
  migrateComponent: (
    raw: unknown,
    makeId: IdFactory,
    componentIndex: number,
  ) => PlanComponent | null,
): PlanComponent[] {
  return rawComponents.map((raw, componentIndex) => {
    const component = migrateComponent(raw, makeId, componentIndex);
    if (!component) {
      throw new Error(`Stored plan component ${componentIndex} is malformed or unsupported`);
    }
    return component;
  });
}

export function migratePlan(raw: unknown, makeId: IdFactory = defaultIdFactory()): ProjectPlan {
  if (!isRecord(raw)) {
    throw new Error("Stored plan must be an object");
  }
  if (typeof raw.schemaVersion === "number" && raw.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(`Unsupported stored plan schema version ${raw.schemaVersion}`);
  }
  if (raw.schemaVersion === 4) {
    if (!Array.isArray(raw.components)) {
      throw new Error("Stored plan schema version 4 components must be an array");
    }
    return {
      schemaVersion: 4,
      components: migrateComponents(raw.components, makeId, normalizeV4Component),
    };
  }
  if (raw.schemaVersion === 3) {
    if (!Array.isArray(raw.components)) {
      throw new Error("Stored plan schema version 3 components must be an array");
    }
    return {
      schemaVersion: 4,
      components: migrateComponents(raw.components, makeId, migrateV3Component),
    };
  }
  if (raw.schemaVersion === 2) {
    if (!Array.isArray(raw.components)) {
      throw new Error("Stored plan schema version 2 components must be an array");
    }
    return {
      schemaVersion: 4,
      components: migrateComponents(raw.components, makeId, migrateV2Component),
    };
  }
  if (typeof raw.photographyPlan === "string" || Array.isArray(raw.referenceGroups)) {
    return migratePlan(migrateV1ToV2(raw, makeId), makeId);
  }
  throw new Error("Stored plan has an unsupported or missing schema");
}
