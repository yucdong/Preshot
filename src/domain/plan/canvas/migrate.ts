import { ROW_CAPACITY_EPSILON } from "./fraction";
import {
  clampImageHeight,
  clampWidth,
  CURRENT_SCHEMA_VERSION,
  DEFAULT_CONTENT_SCALE,
  DEFAULT_IMAGE_HEIGHT,
  MAX_CONTENT_SCALE,
  MAX_IMAGE_HEIGHT,
  MIN_CONTENT_SCALE,
  MIN_IMAGE_HEIGHT,
  MIN_WIDTH,
  UNTITLED_PLAN_TITLE,
  type PlanComponent,
  type ProjectPlan,
  type ReferenceImage,
} from "./models";
import { smallestFreeSuffixedName } from "./naming";

export interface PlanMigrationContext {
  projectName: string;
  makeId?: (prefix: string) => string;
}

type IdFactory = (prefix: string) => string;

type LegacyComponent =
  | { id: string; type: "plan"; width: number; html: string }
  | {
      id: string;
      type: "reference";
      width: number;
      title: string;
      description: string;
      showCaptions: boolean;
      imageHeight: number;
      images: ReferenceImage[];
    };

type V5Component =
  | { id: string; name: string; type: "plan"; width: number; html: string }
  | {
      id: string;
      name: string;
      type: "reference";
      width: number;
      description: string;
      showCaptions: boolean;
      imageHeight: number;
      images: ReferenceImage[];
    };

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

function titleFromProjectName(projectName: string): string {
  return projectName.trim() || UNTITLED_PLAN_TITLE;
}

function normalizeAspectRatio(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 1;
}

function legacyImages(value: unknown, componentIndex: number, makeId: IdFactory): ReferenceImage[] {
  if (!Array.isArray(value)) {
    throw new Error(`Stored plan component ${componentIndex} images must be an array`);
  }
  return value.map((raw, imageIndex) => {
    if (!isRecord(raw) || typeof raw.file !== "string" || !raw.file) {
      throw new Error(
        `Stored plan component ${componentIndex} image ${imageIndex} must have non-empty string file fields`,
      );
    }
    if (raw.caption !== undefined && typeof raw.caption !== "string") {
      throw new Error(
        `Stored plan component ${componentIndex} image ${imageIndex} caption must be a string`,
      );
    }
    const image: ReferenceImage = {
      id: typeof raw.id === "string" && raw.id ? raw.id : makeId("img"),
      file: raw.file,
      aspectRatio: normalizeAspectRatio(raw.aspectRatio),
    };
    if (typeof raw.caption === "string") {
      image.caption = raw.caption;
    }
    return image;
  });
}

function legacyComponent(
  raw: unknown,
  makeId: IdFactory,
  componentIndex: number,
  options: { allowMissingId: boolean; imageHeightMultiplier: number },
): LegacyComponent | null {
  if (!isRecord(raw) || typeof raw.width !== "number" || !Number.isFinite(raw.width)) {
    return null;
  }
  const id =
    typeof raw.id === "string" && raw.id
      ? raw.id
      : options.allowMissingId
        ? makeId("cmp")
        : "";
  if (!id) {
    throw new Error(`Stored plan component ${componentIndex} id must be a non-empty string`);
  }
  const width = clampWidth(raw.width);
  if (raw.type === "plan") {
    if (typeof raw.html !== "string") {
      throw new Error(`Stored plan component ${componentIndex} html must be a string`);
    }
    return { id, type: "plan", width, html: raw.html };
  }
  if (raw.type === "reference") {
    if (typeof raw.title !== "string") {
      throw new Error(`Stored plan component ${componentIndex} title must be a string`);
    }
    if (typeof raw.description !== "string") {
      throw new Error(`Stored plan component ${componentIndex} description must be a string`);
    }
    if (typeof raw.showCaptions !== "boolean") {
      throw new Error(`Stored plan component ${componentIndex} showCaptions must be a boolean`);
    }
    if (typeof raw.imageHeight !== "number" || !Number.isFinite(raw.imageHeight)) {
      return null;
    }
    return {
      id,
      type: "reference",
      width,
      title: raw.title,
      description: raw.description,
      showCaptions: raw.showCaptions,
      imageHeight: clampImageHeight(raw.imageHeight * options.imageHeightMultiplier),
      images: legacyImages(raw.images, componentIndex, makeId),
    };
  }
  return null;
}

const FRACTION_TO_NUMBER: Record<string, number> = {
  "1": 1,
  "3/4": 0.75,
  "2/3": 0.667,
  "1/2": 0.5,
  "1/3": 0.333,
  "1/4": 0.25,
};

function v2Component(raw: unknown, makeId: IdFactory, componentIndex: number): LegacyComponent | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = typeof raw.id === "string" && raw.id ? raw.id : makeId("cmp");
  const width = FRACTION_TO_NUMBER[typeof raw.widthFraction === "string" ? raw.widthFraction : "1"] ?? 1;
  if (raw.type === "plan") {
    return { id, type: "plan", width, html: asString(raw.html) };
  }
  if (raw.type === "reference") {
    return {
      id,
      type: "reference",
      width,
      title: asString(raw.title ?? raw.name),
      description: asString(raw.description),
      showCaptions: raw.showCaptions === true,
      imageHeight: DEFAULT_IMAGE_HEIGHT,
      images: legacyImages(raw.images, componentIndex, makeId),
    };
  }
  return null;
}

function migrateComponents(
  rawComponents: unknown[],
  makeId: IdFactory,
  migrateComponent: (raw: unknown, makeId: IdFactory, componentIndex: number) => LegacyComponent | null,
): LegacyComponent[] {
  return rawComponents.map((raw, componentIndex) => {
    const component = migrateComponent(raw, makeId, componentIndex);
    if (!component) {
      throw new Error(`Stored plan component ${componentIndex} is malformed or unsupported`);
    }
    return component;
  });
}

function remapLegacyLogicalIds(components: LegacyComponent[]): LegacyComponent[] {
  const reservedIds = new Set<string>();
  for (const component of components) {
    reservedIds.add(component.id);
    if (component.type === "reference") {
      component.images.forEach((image) => reservedIds.add(image.id));
    }
  }
  const used = new Set<string>();
  const unique = (id: string): string => {
    if (!used.has(id)) {
      used.add(id);
      return id;
    }
    let suffix = 2;
    let candidate = `${id}-${suffix}`;
    while (used.has(candidate) || reservedIds.has(candidate)) {
      candidate = `${id}-${++suffix}`;
    }
    used.add(candidate);
    return candidate;
  };
  return components.map((component) => {
    const id = unique(component.id);
    return component.type === "plan"
      ? { ...component, id }
      : { ...component, id, images: component.images.map((image) => ({ ...image, id: unique(image.id) })) };
  });
}

function validateLogicalIds(
  components: readonly { id: string; type: string; images?: ReferenceImage[] }[],
): void {
  const componentPositions = new Map<string, number>();
  components.forEach((component, componentIndex) => {
    const previousIndex = componentPositions.get(component.id);
    if (previousIndex !== undefined) {
      throw new Error(
        `Stored plan duplicate component id "${component.id}" at component ${componentIndex}; first used at component ${previousIndex}`,
      );
    }
    componentPositions.set(component.id, componentIndex);
  });
  const imagePositions = new Map<string, { componentIndex: number; imageIndex: number }>();
  components.forEach((component, componentIndex) => {
    if (component.type !== "reference") {
      return;
    }
    for (const [imageIndex, image] of (component.images ?? []).entries()) {
      const componentPosition = componentPositions.get(image.id);
      if (componentPosition !== undefined) {
        throw new Error(
          `Stored plan duplicate logical id "${image.id}" at component ${componentIndex} image ${imageIndex}; first used at component ${componentPosition}`,
        );
      }
      const previous = imagePositions.get(image.id);
      if (previous) {
        throw new Error(
          `Stored plan duplicate image id "${image.id}" at component ${componentIndex} image ${imageIndex}; first used at component ${previous.componentIndex} image ${previous.imageIndex}`,
        );
      }
      imagePositions.set(image.id, { componentIndex, imageIndex });
    }
  });
}

function validateComponentNames(components: readonly { name: string }[]): void {
  const positions = new Map<string, number>();
  components.forEach((component, componentIndex) => {
    const name = component.name.trim();
    const previousIndex = positions.get(name);
    if (previousIndex !== undefined) {
      throw new Error(
        `Stored plan duplicate component name "${name}" at component ${componentIndex}; first used at component ${previousIndex}`,
      );
    }
    positions.set(name, componentIndex);
  });
}

function uniqueName(base: string, names: Set<string>): string {
  if (!names.has(base)) {
    names.add(base);
    return base;
  }
  const name = smallestFreeSuffixedName(names, base);
  names.add(name);
  return name;
}

function v6FromLegacy(components: LegacyComponent[], context: PlanMigrationContext): ProjectPlan {
  validateLogicalIds(components);
  const names = new Set<string>();
  const result: PlanComponent[] = components.map((component) => {
    const name = component.type === "plan"
      ? uniqueGeneratedName("文案", names)
      : component.title.trim()
        ? uniqueName(component.title.trim(), names)
        : uniqueGeneratedName("图片组", names);
    return component.type === "plan"
      ? {
          id: component.id,
          name,
          type: "plan" as const,
          width: component.width,
          contentScale: DEFAULT_CONTENT_SCALE,
          html: component.html,
        }
      : {
          id: component.id,
          name,
          type: "reference" as const,
          width: component.width,
          contentScale: DEFAULT_CONTENT_SCALE,
          description: component.description,
          showDescription: true,
          imageHeight: component.imageHeight,
          images: component.images,
        };
  });

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    title: titleFromProjectName(context.projectName),
    components: result,
  };

  function uniqueGeneratedName(label: string, usedNames: Set<string>): string {
    const name = smallestFreeSuffixedName(usedNames, label);
    usedNames.add(name);
    return name;
  }
}

function validCrop(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    typeof value.width === "number" &&
    typeof value.height === "number" &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.width) &&
    Number.isFinite(value.height) &&
    value.x >= 0 &&
    value.y >= 0 &&
    value.width > 0 &&
    value.height > 0 &&
    value.x + value.width <= 1 &&
    value.y + value.height <= 1
  );
}

function v5Image(raw: unknown, componentIndex: number, imageIndex: number): ReferenceImage {
  if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id || typeof raw.file !== "string" || !raw.file) {
    throw new Error(`Stored plan component ${componentIndex} image ${imageIndex} must have non-empty string id and file fields`);
  }
  if (typeof raw.aspectRatio !== "number" || !Number.isFinite(raw.aspectRatio) || raw.aspectRatio <= 0) {
    throw new Error(`Stored plan component ${componentIndex} image ${imageIndex} aspectRatio must be positive`);
  }
  if (raw.caption !== undefined && typeof raw.caption !== "string") {
    throw new Error(`Stored plan component ${componentIndex} image ${imageIndex} caption must be a string`);
  }
  if (raw.crop !== undefined && !validCrop(raw.crop)) {
    throw new Error(`Stored plan component ${componentIndex} image ${imageIndex} crop must be within image bounds`);
  }
  const image: ReferenceImage = { id: raw.id, file: raw.file, aspectRatio: raw.aspectRatio };
  if (typeof raw.caption === "string") {
    image.caption = raw.caption;
  }
  return image;
}

function v5Component(raw: unknown, componentIndex: number): V5Component {
  const rawWidth =
    isRecord(raw) && typeof raw.width === "number" && Number.isFinite(raw.width)
      ? raw.width
      : Number.NaN;
  const width = clampWidth(rawWidth);
  if (
    !isRecord(raw) ||
    typeof raw.id !== "string" ||
    !raw.id ||
    typeof raw.name !== "string" ||
    !raw.name ||
    raw.name !== raw.name.trim() ||
    !Number.isFinite(rawWidth) ||
    rawWidth < MIN_WIDTH - ROW_CAPACITY_EPSILON ||
    rawWidth > 1 + ROW_CAPACITY_EPSILON ||
    typeof raw.rowId !== "string" ||
    !raw.rowId ||
    rawWidth < MIN_WIDTH - ROW_CAPACITY_EPSILON ||
    rawWidth > 1 + ROW_CAPACITY_EPSILON
  ) {
    throw new Error(`Stored plan component ${componentIndex} has invalid v5 fields`);
  }
  if (raw.type === "plan") {
    if (typeof raw.html !== "string") {
      throw new Error(`Stored plan component ${componentIndex} html must be a string`);
    }
    return { id: raw.id, name: raw.name, type: "plan", width, html: raw.html };
  }
  if (raw.type === "reference") {
    if (
      typeof raw.description !== "string" ||
      typeof raw.showCaptions !== "boolean" ||
      typeof raw.imageHeight !== "number" ||
      !Number.isFinite(raw.imageHeight) ||
      raw.imageHeight < MIN_IMAGE_HEIGHT ||
      raw.imageHeight > MAX_IMAGE_HEIGHT
    ) {
      throw new Error(`Stored plan component ${componentIndex} imageHeight must be between ${MIN_IMAGE_HEIGHT} and ${MAX_IMAGE_HEIGHT}`);
    }
    if (!Array.isArray(raw.images)) {
      throw new Error(`Stored plan component ${componentIndex} has invalid reference fields`);
    }
    return {
      id: raw.id,
      name: raw.name,
      type: "reference",
      width,
      description: raw.description,
      showCaptions: raw.showCaptions,
      imageHeight: raw.imageHeight,
      images: raw.images.map((image, imageIndex) => v5Image(image, componentIndex, imageIndex)),
    };
  }
  throw new Error(`Stored plan component ${componentIndex} is malformed or unsupported`);
}

function v6FromV5(components: V5Component[], title: string): ProjectPlan {
  validateLogicalIds(components);
  validateComponentNames(components);
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    title,
    components: components.map((component) =>
      component.type === "plan"
        ? {
            ...component,
            contentScale: DEFAULT_CONTENT_SCALE,
          }
        : (() => {
            const { showCaptions: _showCaptions, ...reference } = component;
            return {
              ...reference,
              contentScale: DEFAULT_CONTENT_SCALE,
              showDescription: true,
            };
          })(),
    ),
  };
}

function requireOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], context: string): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error(`Stored plan ${context} has unsupported v6 fields`);
  }
}

function v6Image(raw: unknown, componentIndex: number, imageIndex: number): ReferenceImage {
  if (!isRecord(raw)) {
    throw new Error(`Stored plan component ${componentIndex} image ${imageIndex} must be an object`);
  }
  requireOnlyKeys(raw, ["id", "file", "caption", "aspectRatio", "displayHeight"], `component ${componentIndex} image ${imageIndex}`);
  if (typeof raw.id !== "string" || !raw.id || typeof raw.file !== "string" || !raw.file) {
    throw new Error(`Stored plan component ${componentIndex} image ${imageIndex} must have non-empty string id and file fields`);
  }
  if (typeof raw.aspectRatio !== "number" || !Number.isFinite(raw.aspectRatio) || raw.aspectRatio <= 0) {
    throw new Error(`Stored plan component ${componentIndex} image ${imageIndex} aspectRatio must be positive`);
  }
  if (raw.caption !== undefined && typeof raw.caption !== "string") {
    throw new Error(`Stored plan component ${componentIndex} image ${imageIndex} caption must be a string`);
  }
  if (
    raw.displayHeight !== undefined &&
    (typeof raw.displayHeight !== "number" ||
      !Number.isFinite(raw.displayHeight) ||
      raw.displayHeight <= 0)
  ) {
    throw new Error(`Stored plan component ${componentIndex} image ${imageIndex} displayHeight must be positive`);
  }
  const image: ReferenceImage = { id: raw.id, file: raw.file, aspectRatio: raw.aspectRatio };
  if (typeof raw.caption === "string") {
    image.caption = raw.caption;
  }
  if (typeof raw.displayHeight === "number") {
    image.displayHeight = raw.displayHeight;
  }
  return image;
}

function v6Component(raw: unknown, componentIndex: number): PlanComponent {
  if (!isRecord(raw)) {
    throw new Error(`Stored plan component ${componentIndex} has invalid v6 fields`);
  }
  if (
    typeof raw.id !== "string" ||
    !raw.id ||
    typeof raw.name !== "string" ||
    !raw.name ||
    raw.name !== raw.name.trim() ||
    typeof raw.width !== "number" ||
    !Number.isFinite(raw.width) ||
    raw.width < MIN_WIDTH ||
    raw.width > 1 ||
    typeof raw.contentScale !== "number" ||
    !Number.isFinite(raw.contentScale) ||
    raw.contentScale < MIN_CONTENT_SCALE ||
    raw.contentScale > MAX_CONTENT_SCALE
  ) {
    throw new Error(`Stored plan component ${componentIndex} has invalid v6 fields including contentScale`);
  }
  if (raw.type === "plan") {
    requireOnlyKeys(raw, ["id", "name", "type", "width", "contentScale", "html"], `component ${componentIndex}`);
    if (typeof raw.html !== "string") {
      throw new Error(`Stored plan component ${componentIndex} html must be a string`);
    }
    return {
      id: raw.id,
      name: raw.name,
      type: "plan",
      width: raw.width,
      contentScale: raw.contentScale,
      html: raw.html,
    };
  }
  if (raw.type === "reference") {
    requireOnlyKeys(
      raw,
      [
        "id",
        "name",
        "type",
        "width",
        "contentScale",
        "description",
        "showDescription",
        "imageHeight",
        "images",
      ],
      `component ${componentIndex}`,
    );
    if (
      typeof raw.description !== "string" ||
      typeof raw.showDescription !== "boolean" ||
      typeof raw.imageHeight !== "number" ||
      !Number.isFinite(raw.imageHeight) ||
      raw.imageHeight < MIN_IMAGE_HEIGHT ||
      raw.imageHeight > MAX_IMAGE_HEIGHT ||
      !Array.isArray(raw.images)
    ) {
      throw new Error(`Stored plan component ${componentIndex} has invalid v6 reference fields`);
    }
    return {
      id: raw.id,
      name: raw.name,
      type: "reference",
      width: raw.width,
      contentScale: raw.contentScale,
      description: raw.description,
      showDescription: raw.showDescription,
      imageHeight: raw.imageHeight,
      images: raw.images.map((image, imageIndex) => v6Image(image, componentIndex, imageIndex)),
    };
  }
  throw new Error(`Stored plan component ${componentIndex} is malformed or unsupported`);
}

function migrateV1ToV2(raw: Record<string, unknown>, makeId: IdFactory): Record<string, unknown> {
  const components: unknown[] = [];
  if (asString(raw.photographyPlan).trim()) {
    components.push({ id: makeId("plan"), type: "plan", widthFraction: "1", html: raw.photographyPlan });
  }
  if (Array.isArray(raw.referenceGroups)) {
    raw.referenceGroups.forEach((group, groupIndex) => {
      if (!isRecord(group)) {
        throw new Error(`Stored plan reference group ${groupIndex} must be an object`);
      }
      const id = typeof group.id === "string" && group.id ? group.id : makeId("ref");
      components.push({
        id,
        type: "reference",
        widthFraction: "1",
        title: asString(group.title ?? group.name),
        description: asString(group.description),
        showCaptions: false,
        images: group.images,
      });
    });
  }
  return { schemaVersion: 2, components };
}

export function migratePlan(raw: unknown, context: PlanMigrationContext): ProjectPlan {
  if (!isRecord(raw)) {
    throw new Error("Stored plan must be an object");
  }
  const makeId = context.makeId ?? defaultIdFactory();
  if (typeof raw.schemaVersion === "number" && raw.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(`Unsupported stored plan schema version ${raw.schemaVersion}`);
  }
  if (raw.schemaVersion === 6) {
    requireOnlyKeys(raw, ["schemaVersion", "title", "components"], "document");
    if (typeof raw.title !== "string" || !raw.title.trim() || raw.title !== raw.title.trim() || !Array.isArray(raw.components)) {
      throw new Error("Stored plan schema version 6 title and components must be valid");
    }
    const components = raw.components.map((component, index) => v6Component(component, index));
    validateLogicalIds(components);
    validateComponentNames(components);
    return { schemaVersion: CURRENT_SCHEMA_VERSION, title: raw.title, components };
  }
  if (raw.schemaVersion === 5) {
    if (typeof raw.title !== "string" || !Array.isArray(raw.components)) {
      throw new Error("Stored plan schema version 5 title and components must be valid");
    }
    const title = raw.title.trim();
    if (!title) {
      throw new Error("Stored plan schema version 5 title must be non-blank");
    }
    return v6FromV5(raw.components.map((component, index) => v5Component(component, index)), title);
  }
  if (raw.schemaVersion === 4 || raw.schemaVersion === 3) {
    if (!Array.isArray(raw.components)) {
      throw new Error(`Stored plan schema version ${raw.schemaVersion} components must be an array`);
    }
    const multiplier = raw.schemaVersion === 3 ? 0.75 : 1;
    return v6FromLegacy(
      migrateComponents(raw.components, makeId, (component, ids, index) =>
        legacyComponent(component, ids, index, {
          allowMissingId: false,
          imageHeightMultiplier: multiplier,
        }),
      ),
      context,
    );
  }
  if (raw.schemaVersion === 2) {
    if (!Array.isArray(raw.components)) {
      throw new Error("Stored plan schema version 2 components must be an array");
    }
    return v6FromLegacy(
      remapLegacyLogicalIds(migrateComponents(raw.components, makeId, v2Component)),
      context,
    );
  }
  if (typeof raw.photographyPlan === "string" || Array.isArray(raw.referenceGroups)) {
    return migratePlan(migrateV1ToV2(raw, makeId), context);
  }
  throw new Error("Stored plan has an unsupported or missing schema");
}
