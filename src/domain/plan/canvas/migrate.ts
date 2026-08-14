import { ROW_CAPACITY_EPSILON } from "./fraction";
import {
  clampImageHeight,
  clampWidth,
  CURRENT_SCHEMA_VERSION,
  DEFAULT_CONTENT_SCALE,
  DEFAULT_IMAGE_HEIGHT,
  MAX_CONTENT_SCALE,
  MAX_IMAGE_HEIGHT,
  MIN_COMPONENT_HEIGHT,
  MIN_COMPONENT_WIDTH,
  MIN_CONTENT_SCALE,
  MIN_IMAGE_HEIGHT,
  MIN_WIDTH,
  UNTITLED_PLAN_TITLE,
  type PlanComponent,
  type PlanTextComponent,
  type ProjectPlan,
  type PlanTextNode,
  type ReferenceComponent,
} from "./models";
import {
  contentSize,
  DEFAULT_PAGE_GEOMETRY,
  EDITABLE_COMPONENT_FRAME_CHROME,
  clampCardRect,
} from "./geometry";
import { layoutPlan } from "./engine";
import type {
  LegacyV6PlanComponent,
  LegacyV6ProjectPlan,
  LegacyV6ReferenceImage,
} from "./legacyV6";
import { smallestFreeSuffixedName } from "./naming";
import { centeredCoverCrop } from "./imageView";
import {
  escapeDocumentText,
  htmlFragment,
  imageGroupIdsInHtml,
  imageGroupMarker,
} from "./document";
import { layoutTextTree } from "./textTree";

export interface PlanMigrationContext {
  projectName: string;
  makeId?: (prefix: string) => string;
}

type IdFactory = (prefix: string) => string;

interface V11ProjectPlan {
  schemaVersion: 11;
  title: string;
  components: PlanComponent[];
}

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
      images: LegacyV6ReferenceImage[];
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
      images: LegacyV6ReferenceImage[];
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

function legacyImages(
  value: unknown,
  componentIndex: number,
  makeId: IdFactory,
): LegacyV6ReferenceImage[] {
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
    const image: LegacyV6ReferenceImage = {
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
  components: readonly {
    id: string;
    type: string;
    images?: readonly { id: string }[];
  }[],
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

function v6FromLegacy(
  components: LegacyComponent[],
  context: PlanMigrationContext,
): LegacyV6ProjectPlan {
  validateLogicalIds(components);
  const names = new Set<string>();
  const result: LegacyV6PlanComponent[] = components.map((component) => {
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
    schemaVersion: 6,
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

function v5Image(
  raw: unknown,
  componentIndex: number,
  imageIndex: number,
): LegacyV6ReferenceImage {
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
  const image: LegacyV6ReferenceImage = {
    id: raw.id,
    file: raw.file,
    aspectRatio: raw.aspectRatio,
  };
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

function v6FromV5(components: V5Component[], title: string): LegacyV6ProjectPlan {
  validateLogicalIds(components);
  validateComponentNames(components);
  return {
    schemaVersion: 6,
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

function requireOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  context: string,
  schemaVersion = 6,
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error(`Stored plan ${context} has unsupported v${schemaVersion} fields`);
  }
}

function v6Image(
  raw: unknown,
  componentIndex: number,
  imageIndex: number,
): LegacyV6ReferenceImage {
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
  const image: LegacyV6ReferenceImage = {
    id: raw.id,
    file: raw.file,
    aspectRatio: raw.aspectRatio,
  };
  if (typeof raw.caption === "string") {
    image.caption = raw.caption;
  }
  if (typeof raw.displayHeight === "number") {
    image.displayHeight = raw.displayHeight;
  }
  return image;
}

function v6Component(raw: unknown, componentIndex: number): LegacyV6PlanComponent {
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

function v7Image(
  raw: unknown,
  componentIndex: number,
  imageIndex: number,
  allowView = false,
  allowOffsets = false,
) {
  if (!isRecord(raw)) {
    throw new Error(`Stored plan component ${componentIndex} image ${imageIndex} must be an object`);
  }
  requireOnlyKeys(
    raw,
    allowView
      ? [
          "id",
          "file",
          "caption",
          "aspectRatio",
          "sourceWidth",
          "sourceHeight",
          "frameWidth",
          "frameHeight",
          "crop",
          ...(allowOffsets ? ["frameOffsetX", "frameOffsetY"] : []),
        ]
      : ["id", "file", "caption", "aspectRatio", "frameWidth", "frameHeight"],
    `component ${componentIndex} image ${imageIndex}`,
    7,
  );
  if (
    typeof raw.id !== "string" ||
    !raw.id ||
    typeof raw.file !== "string" ||
    !raw.file ||
    typeof raw.aspectRatio !== "number" ||
    !Number.isFinite(raw.aspectRatio) ||
    raw.aspectRatio <= 0 ||
    typeof raw.frameWidth !== "number" ||
    !Number.isFinite(raw.frameWidth) ||
    raw.frameWidth <= 0 ||
    typeof raw.frameHeight !== "number" ||
    !Number.isFinite(raw.frameHeight) ||
    raw.frameHeight <= 0 ||
    (allowOffsets && raw.frameOffsetX !== undefined && (
      typeof raw.frameOffsetX !== "number" || !Number.isFinite(raw.frameOffsetX)
    )) ||
    (allowOffsets && raw.frameOffsetY !== undefined && (
      typeof raw.frameOffsetY !== "number" || !Number.isFinite(raw.frameOffsetY)
    )) ||
    (raw.caption !== undefined && typeof raw.caption !== "string") ||
    (allowView && (raw.sourceWidth === undefined) !== (raw.sourceHeight === undefined)) ||
    (raw.sourceWidth !== undefined && (
      typeof raw.sourceWidth !== "number" ||
      !Number.isFinite(raw.sourceWidth) ||
      raw.sourceWidth <= 0 ||
      typeof raw.sourceHeight !== "number" ||
      !Number.isFinite(raw.sourceHeight) ||
      raw.sourceHeight <= 0
    ))
  ) {
    throw new Error(`Stored plan component ${componentIndex} image ${imageIndex} has invalid v7 fields`);
  }
  let crop: { x: number; y: number; width: number; height: number } | undefined;
  if (allowView && raw.crop !== undefined) {
    if (!isRecord(raw.crop)) {
      throw new Error(`Stored plan component ${componentIndex} image ${imageIndex} crop must be an object`);
    }
    requireOnlyKeys(raw.crop, ["x", "y", "width", "height"], `component ${componentIndex} image ${imageIndex} crop`, 10);
    const { x, y, width, height } = raw.crop;
    if (
      typeof x !== "number" || !Number.isFinite(x) || x < 0 ||
      typeof y !== "number" || !Number.isFinite(y) || y < 0 ||
      typeof width !== "number" || !Number.isFinite(width) || width <= 0 || width > 1 ||
      typeof height !== "number" || !Number.isFinite(height) || height <= 0 || height > 1 ||
      x + width > 1.000001 || y + height > 1.000001
    ) {
      throw new Error(`Stored plan component ${componentIndex} image ${imageIndex} has invalid crop`);
    }
    const cropAspectRatio = width * raw.aspectRatio / height;
    const frameAspectRatio = raw.frameWidth / raw.frameHeight;
    if (Math.abs(cropAspectRatio - frameAspectRatio) > 0.0001) {
      throw new Error(`Stored plan component ${componentIndex} image ${imageIndex} crop does not match its frame ratio`);
    }
    crop = { x, y, width, height };
  }
  return {
    id: raw.id,
    file: raw.file,
    ...(typeof raw.caption === "string" ? { caption: raw.caption } : {}),
    aspectRatio: raw.aspectRatio,
    ...(typeof raw.sourceWidth === "number" && typeof raw.sourceHeight === "number"
      ? { sourceWidth: raw.sourceWidth, sourceHeight: raw.sourceHeight }
      : {}),
    frameWidth: raw.frameWidth,
    frameHeight: raw.frameHeight,
    ...(allowOffsets && typeof raw.frameOffsetX === "number"
      ? { frameOffsetX: raw.frameOffsetX }
      : {}),
    ...(allowOffsets && typeof raw.frameOffsetY === "number"
      ? { frameOffsetY: raw.frameOffsetY }
      : {}),
    ...(crop ? { crop } : {}),
  };
}

function v7Component(raw: unknown, componentIndex: number) {
  if (!isRecord(raw)) {
    throw new Error(`Stored plan component ${componentIndex} has invalid v7 fields`);
  }

  const canvasWidth = contentSize(DEFAULT_PAGE_GEOMETRY).width;
  if (
    typeof raw.id !== "string" ||
    !raw.id ||
    typeof raw.name !== "string" ||
    !raw.name ||
    raw.name !== raw.name.trim() ||
    typeof raw.x !== "number" ||
    !Number.isFinite(raw.x) ||
    raw.x < 0 ||
    typeof raw.y !== "number" ||
    !Number.isFinite(raw.y) ||
    raw.y < 0 ||
    typeof raw.width !== "number" ||
    !Number.isFinite(raw.width) ||
    raw.width < MIN_COMPONENT_WIDTH ||
    raw.width > canvasWidth ||
    typeof raw.height !== "number" ||
    !Number.isFinite(raw.height) ||
    raw.height < MIN_COMPONENT_HEIGHT ||
    raw.x + raw.width > canvasWidth + 0.0001
  ) {
    throw new Error(`Stored plan component ${componentIndex} has invalid v7 card bounds`);
  }

  if (raw.type === "plan") {
    requireOnlyKeys(
      raw,
      ["id", "name", "type", "x", "y", "width", "height", "html"],
      `component ${componentIndex}`,
      7,
    );
    if (typeof raw.html !== "string") {
      throw new Error(`Stored plan component ${componentIndex} html must be a string`);
    }
    return {
      id: raw.id,
      name: raw.name,
      type: "plan" as const,
      x: raw.x,
      y: raw.y,
      width: raw.width,
      height: raw.height,
      html: raw.html,
    };
  }

  if (raw.type === "reference") {
    requireOnlyKeys(
      raw,
      ["id", "name", "type", "x", "y", "width", "height", "description", "images"],
      `component ${componentIndex}`,
      7,
    );
    if (typeof raw.description !== "string" || !Array.isArray(raw.images)) {
      throw new Error(`Stored plan component ${componentIndex} has invalid v7 reference fields`);
    }
    return {
      id: raw.id,
      name: raw.name,
      type: "reference" as const,
      x: raw.x,
      y: raw.y,
      width: raw.width,
      height: raw.height,
      description: raw.description,
      images: raw.images.map((image, imageIndex) => v7Image(image, componentIndex, imageIndex)),
    };
  }
  throw new Error(`Stored plan component ${componentIndex} is malformed or unsupported v7`);
}

function v8Component(raw: unknown, componentIndex: number) {
  if (!isRecord(raw)) {
    throw new Error(`Stored plan component ${componentIndex} has invalid v8 fields`);
  }

  const canvasWidth = contentSize(DEFAULT_PAGE_GEOMETRY).width;
  if (
    typeof raw.id !== "string" ||
    !raw.id ||
    typeof raw.name !== "string" ||
    !raw.name ||
    raw.name !== raw.name.trim() ||
    typeof raw.x !== "number" ||
    !Number.isFinite(raw.x) ||
    raw.x < 0 ||
    typeof raw.width !== "number" ||
    !Number.isFinite(raw.width) ||
    raw.width < MIN_COMPONENT_WIDTH ||
    raw.width > canvasWidth ||
    typeof raw.height !== "number" ||
    !Number.isFinite(raw.height) ||
    raw.height < MIN_COMPONENT_HEIGHT ||
    raw.x + raw.width > canvasWidth + 0.0001
  ) {
    throw new Error(`Stored plan component ${componentIndex} has invalid v8 card bounds`);
  }

  if (raw.type === "plan") {
    requireOnlyKeys(
      raw,
      ["id", "name", "type", "x", "width", "height", "contentScale", "html"],
      `component ${componentIndex}`,
      8,
    );
    if (
      typeof raw.html !== "string" ||
      (raw.contentScale !== undefined &&
        (typeof raw.contentScale !== "number" ||
          !Number.isFinite(raw.contentScale) ||
          raw.contentScale < MIN_CONTENT_SCALE ||
          raw.contentScale > MAX_CONTENT_SCALE))
    ) {
      throw new Error(`Stored plan component ${componentIndex} html and contentScale must be valid`);
    }
    return {
      id: raw.id,
      name: raw.name,
      type: "plan" as const,
      x: raw.x,
      width: raw.width,
      height: raw.height,
      ...(typeof raw.contentScale === "number" ? { contentScale: raw.contentScale } : {}),
      html: raw.html,
    };
  }

  if (raw.type === "reference") {
    requireOnlyKeys(
      raw,
      ["id", "name", "type", "x", "width", "height", "description", "images"],
      `component ${componentIndex}`,
      8,
    );
    if (typeof raw.description !== "string" || !Array.isArray(raw.images)) {
      throw new Error(`Stored plan component ${componentIndex} has invalid v8 reference fields`);
    }
    return {
      id: raw.id,
      name: raw.name,
      type: "reference" as const,
      x: raw.x,
      width: raw.width,
      height: raw.height,
      description: raw.description,
      images: raw.images.map((image, imageIndex) => v7Image(image, componentIndex, imageIndex)),
    };
  }
  throw new Error(`Stored plan component ${componentIndex} is malformed or unsupported v8`);
}

type V8Component = ReturnType<typeof v8Component>;

interface V8ProjectPlan {
  schemaVersion: 8;
  title: string;
  components: V8Component[];
}

interface V9TextLeaf {
  kind: "leaf";
  id: string;
  title: string;
  html: string;
}

interface V9TextSplit {
  kind: "split";
  id: string;
  direction: "columns" | "rows";
  gap: number;
  children: [V9TextNode, V9TextNode];
}

type V9TextNode = V9TextLeaf | V9TextSplit;

function v9TextNode(
  raw: unknown,
  componentIndex: number,
  occupiedIds: Set<string>,
): V9TextNode {
  if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id) {
    throw new Error(`Stored plan component ${componentIndex} has an invalid v9 text node`);
  }
  if (occupiedIds.has(raw.id)) {
    throw new Error(`Stored plan component ${componentIndex} has duplicate text node id "${raw.id}"`);
  }
  occupiedIds.add(raw.id);

  if (raw.kind === "leaf") {
    requireOnlyKeys(raw, ["kind", "id", "title", "html"], `component ${componentIndex} text node`, 9);
    if (typeof raw.title !== "string" || typeof raw.html !== "string") {
      throw new Error(`Stored plan component ${componentIndex} has invalid v9 leaf fields`);
    }
    return { kind: "leaf", id: raw.id, title: raw.title, html: raw.html };
  }
  if (raw.kind === "split") {
    requireOnlyKeys(
      raw,
      ["kind", "id", "direction", "gap", "children"],
      `component ${componentIndex} text node`,
      9,
    );
    if (
      (raw.direction !== "columns" && raw.direction !== "rows") ||
      typeof raw.gap !== "number" ||
      !Number.isFinite(raw.gap) ||
      raw.gap <= 0 ||
      !Array.isArray(raw.children) ||
      raw.children.length !== 2
    ) {
      throw new Error(`Stored plan component ${componentIndex} has invalid v9 split fields`);
    }
    return {
      kind: "split",
      id: raw.id,
      direction: raw.direction,
      gap: raw.gap,
      children: [
        v9TextNode(raw.children[0], componentIndex, occupiedIds),
        v9TextNode(raw.children[1], componentIndex, occupiedIds),
      ],
    };
  }
  throw new Error(`Stored plan component ${componentIndex} has unsupported v9 text node kind`);
}

function v9Component(raw: unknown, componentIndex: number) {
  if (!isRecord(raw)) {
    throw new Error(`Stored plan component ${componentIndex} has invalid v9 fields`);
  }
  const canvasWidth = contentSize(DEFAULT_PAGE_GEOMETRY).width;
  if (
    typeof raw.id !== "string" ||
    !raw.id ||
    typeof raw.name !== "string" ||
    !raw.name.trim() ||
    raw.name !== raw.name.trim() ||
    typeof raw.x !== "number" ||
    !Number.isFinite(raw.x) ||
    raw.x < 0 ||
    typeof raw.width !== "number" ||
    !Number.isFinite(raw.width) ||
    raw.width < MIN_COMPONENT_WIDTH ||
    raw.width > canvasWidth ||
    typeof raw.height !== "number" ||
    !Number.isFinite(raw.height) ||
    raw.height < MIN_COMPONENT_HEIGHT ||
    raw.x + raw.width > canvasWidth + 0.0001
  ) {
    throw new Error(`Stored plan component ${componentIndex} has invalid v9 card bounds`);
  }

  if (raw.type === "plan") {
    requireOnlyKeys(
      raw,
      ["id", "name", "type", "x", "width", "height", "contentScale", "textRoot"],
      `component ${componentIndex}`,
      9,
    );
    if (
      raw.contentScale !== undefined &&
      (typeof raw.contentScale !== "number" ||
        !Number.isFinite(raw.contentScale) ||
        raw.contentScale < MIN_CONTENT_SCALE ||
        raw.contentScale > MAX_CONTENT_SCALE)
    ) {
      throw new Error(`Stored plan component ${componentIndex} contentScale must be valid`);
    }
    return {
      id: raw.id,
      name: raw.name,
      type: "plan" as const,
      x: raw.x,
      width: raw.width,
      height: raw.height,
      ...(typeof raw.contentScale === "number" ? { contentScale: raw.contentScale } : {}),
      textRoot: v9TextNode(raw.textRoot, componentIndex, new Set()),
    };
  }

  if (raw.type === "reference") {
    requireOnlyKeys(
      raw,
      ["id", "name", "type", "x", "width", "height", "description", "images"],
      `component ${componentIndex}`,
      9,
    );
    if (typeof raw.description !== "string" || !Array.isArray(raw.images)) {
      throw new Error(`Stored plan component ${componentIndex} has invalid v9 reference fields`);
    }
    return {
      id: raw.id,
      name: raw.name,
      type: "reference" as const,
      x: raw.x,
      width: raw.width,
      height: raw.height,
      description: raw.description,
      images: raw.images.map((image, imageIndex) => v7Image(image, componentIndex, imageIndex)),
    };
  }
  throw new Error(`Stored plan component ${componentIndex} is malformed or unsupported v9`);
}

type V9Component = ReturnType<typeof v9Component>;

interface V9ProjectPlan {
  schemaVersion: 9;
  title: string;
  components: V9Component[];
}

function v10TextNode(
  raw: unknown,
  componentIndex: number,
  occupiedIds: Set<string>,
): PlanTextNode {
  if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id) {
    throw new Error(`Stored plan component ${componentIndex} has an invalid v10 text node`);
  }
  if (occupiedIds.has(raw.id)) {
    throw new Error(`Stored plan component ${componentIndex} has duplicate text node id "${raw.id}"`);
  }
  occupiedIds.add(raw.id);

  if (raw.kind === "leaf") {
    requireOnlyKeys(raw, ["kind", "id", "html"], `component ${componentIndex} text node`, 10);
    if (typeof raw.html !== "string") {
      throw new Error(`Stored plan component ${componentIndex} has invalid v10 leaf fields`);
    }
    return { kind: "leaf", id: raw.id, html: raw.html };
  }
  if (raw.kind === "split") {
    requireOnlyKeys(
      raw,
      ["kind", "id", "direction", "gap", "children"],
      `component ${componentIndex} text node`,
      10,
    );
    if (
      (raw.direction !== "columns" && raw.direction !== "rows") ||
      typeof raw.gap !== "number" ||
      !Number.isFinite(raw.gap) ||
      raw.gap <= 0 ||
      !Array.isArray(raw.children) ||
      raw.children.length !== 2
    ) {
      throw new Error(`Stored plan component ${componentIndex} has invalid v10 split fields`);
    }
    return {
      kind: "split",
      id: raw.id,
      direction: raw.direction,
      gap: raw.gap,
      children: [
        v10TextNode(raw.children[0], componentIndex, occupiedIds),
        v10TextNode(raw.children[1], componentIndex, occupiedIds),
      ],
    };
  }
  throw new Error(`Stored plan component ${componentIndex} has unsupported v10 text node kind`);
}

function v10Component(raw: unknown, componentIndex: number) {
  if (!isRecord(raw)) {
    throw new Error(`Stored plan component ${componentIndex} has invalid v10 fields`);
  }
  const canvasWidth = contentSize(DEFAULT_PAGE_GEOMETRY).width;
  if (
    typeof raw.id !== "string" ||
    !raw.id ||
    typeof raw.name !== "string" ||
    !raw.name.trim() ||
    raw.name !== raw.name.trim() ||
    typeof raw.x !== "number" ||
    !Number.isFinite(raw.x) ||
    raw.x < 0 ||
    typeof raw.width !== "number" ||
    !Number.isFinite(raw.width) ||
    raw.width < MIN_COMPONENT_WIDTH ||
    raw.width > canvasWidth ||
    typeof raw.height !== "number" ||
    !Number.isFinite(raw.height) ||
    raw.height < MIN_COMPONENT_HEIGHT ||
    raw.x + raw.width > canvasWidth + 0.0001
  ) {
    throw new Error(`Stored plan component ${componentIndex} has invalid v10 card bounds`);
  }

  if (raw.type === "plan") {
    requireOnlyKeys(
      raw,
      ["id", "name", "type", "x", "width", "height", "contentScale", "textRoot"],
      `component ${componentIndex}`,
      10,
    );
    if (
      raw.contentScale !== undefined &&
      (typeof raw.contentScale !== "number" ||
        !Number.isFinite(raw.contentScale) ||
        raw.contentScale < MIN_CONTENT_SCALE ||
        raw.contentScale > MAX_CONTENT_SCALE)
    ) {
      throw new Error(`Stored plan component ${componentIndex} contentScale must be valid`);
    }
    return {
      id: raw.id,
      name: raw.name,
      type: "plan" as const,
      x: raw.x,
      width: raw.width,
      height: raw.height,
      ...(typeof raw.contentScale === "number" ? { contentScale: raw.contentScale } : {}),
      textRoot: v10TextNode(raw.textRoot, componentIndex, new Set()),
    };
  }

  if (raw.type === "reference") {
    requireOnlyKeys(
      raw,
      ["id", "name", "type", "x", "width", "height", "description", "images"],
      `component ${componentIndex}`,
      10,
    );
    if (typeof raw.description !== "string" || !Array.isArray(raw.images)) {
      throw new Error(`Stored plan component ${componentIndex} has invalid v10 reference fields`);
    }
    return {
      id: raw.id,
      name: raw.name,
      type: "reference" as const,
      x: raw.x,
      width: raw.width,
      height: raw.height,
      description: raw.description,
      images: raw.images.map((image, imageIndex) => v7Image(image, componentIndex, imageIndex)),
    };
  }
  throw new Error(`Stored plan component ${componentIndex} is malformed or unsupported v10`);
}

function v11Component(raw: unknown, componentIndex: number, allowOffsets = false) {
  if (!isRecord(raw)) {
    throw new Error(`Stored plan component ${componentIndex} has invalid v11 fields`);
  }
  if (raw.type === "plan") {
    return v10Component(raw, componentIndex);
  }
  const canvasWidth = contentSize(DEFAULT_PAGE_GEOMETRY).width;
  if (
    raw.type !== "reference" ||
    typeof raw.id !== "string" || !raw.id ||
    typeof raw.name !== "string" || !raw.name.trim() || raw.name !== raw.name.trim() ||
    typeof raw.x !== "number" || !Number.isFinite(raw.x) || raw.x < 0 ||
    typeof raw.width !== "number" || !Number.isFinite(raw.width) || raw.width < MIN_COMPONENT_WIDTH || raw.width > canvasWidth ||
    typeof raw.height !== "number" || !Number.isFinite(raw.height) || raw.height < MIN_COMPONENT_HEIGHT ||
    raw.x + raw.width > canvasWidth + 0.0001
  ) {
    throw new Error(`Stored plan component ${componentIndex} has invalid v11 card bounds`);
  }
  requireOnlyKeys(
    raw,
    [
      "id",
      "name",
      "type",
      "x",
      "width",
      "height",
      "description",
      "images",
      ...(allowOffsets ? ["frameOffsetY"] : []),
    ],
    `component ${componentIndex}`,
    11,
  );
  if (
    typeof raw.description !== "string" ||
    !Array.isArray(raw.images) ||
    (allowOffsets && raw.frameOffsetY !== undefined && (
      typeof raw.frameOffsetY !== "number" || !Number.isFinite(raw.frameOffsetY)
    ))
  ) {
    throw new Error(`Stored plan component ${componentIndex} has invalid v11 reference fields`);
  }
  return {
    id: raw.id,
    name: raw.name,
    type: "reference" as const,
    x: raw.x,
    width: raw.width,
    height: raw.height,
    ...(allowOffsets && typeof raw.frameOffsetY === "number"
      ? { frameOffsetY: raw.frameOffsetY }
      : {}),
    description: raw.description,
    images: raw.images.map((image, imageIndex) =>
      v7Image(image, componentIndex, imageIndex, true, allowOffsets)
    ),
  };
}

function v11FromV10(plan: V11ProjectPlan): V11ProjectPlan {
  return {
    schemaVersion: 11,
    title: plan.title,
    components: plan.components.map((component) =>
      component.type === "reference"
        ? {
            ...component,
            images: component.images.map((image) => ({
              ...image,
              crop: image.crop ?? centeredCoverCrop(
                image.aspectRatio,
                image.frameWidth / image.frameHeight,
              ),
            })),
          }
        : component
    ),
  };
}

function removeV9TextTitles(node: V9TextNode): PlanTextNode {
  if (node.kind === "leaf") {
    return { kind: "leaf", id: node.id, html: node.html };
  }
  return {
    ...node,
    children: [removeV9TextTitles(node.children[0]), removeV9TextTitles(node.children[1])],
  };
}

function v10FromV9(plan: V9ProjectPlan): V11ProjectPlan {
  return v11FromV10({
    schemaVersion: 11,
    title: plan.title,
    components: plan.components.map((component) =>
      component.type === "plan"
        ? { ...component, textRoot: removeV9TextTitles(component.textRoot) }
        : component,
    ),
  });
}

type V7Component = ReturnType<typeof v7Component>;

interface V7ProjectPlan {
  schemaVersion: 7;
  title: string;
  components: V7Component[];
}

function v8FromV7(plan: V7ProjectPlan): V8ProjectPlan {
  const components = plan.components
    .map((component, sourceIndex) => ({ component, sourceIndex }))
    .sort((left, right) =>
      left.component.y - right.component.y ||
      left.component.x - right.component.x ||
      left.sourceIndex - right.sourceIndex,
    )
    .map(({ component }) => {
      const { y: _legacyY, ...current } = component;
      return {
        ...current,
        height: Math.min(current.height, contentSize(DEFAULT_PAGE_GEOMETRY).height),
      };
    });

  return { schemaVersion: 8, title: plan.title, components };
}

function v10FromV8(plan: V8ProjectPlan): V11ProjectPlan {
  return {
    schemaVersion: 11,
    title: plan.title,
    components: plan.components.map((component) =>
      component.type === "plan"
        ? {
            id: component.id,
            name: component.name,
            type: "plan" as const,
            x: component.x,
            width: component.width,
            height: component.height,
            ...(component.contentScale === undefined
              ? {}
              : { contentScale: component.contentScale }),
            textRoot: {
              kind: "leaf" as const,
              id: `${component.id}:root`,
              html: component.html,
            },
          }
        : component,
    ),
  };
}

function v7FromV6(plan: LegacyV6ProjectPlan): V7ProjectPlan {
  const geometry = DEFAULT_PAGE_GEOMETRY;
  const content = contentSize(geometry);
  const layout = layoutPlan(plan.components, geometry, undefined, {
    frameChrome: EDITABLE_COMPONENT_FRAME_CHROME,
    includeDocumentTitle: true,
    includeReferenceAddTile: true,
  });
  const roundPoint = (value: number) => Math.round(value * 1000) / 1000;
  const components = plan.components.map((component) => {
    const fragments = layout.placements.filter(
      (placement) => placement.componentId === component.id,
    );
    const first = fragments[0];
    if (!first) {
      throw new Error(`Unable to derive v7 position for component "${component.id}"`);
    }
    const continuousY = (pageIndex: number, y: number) => pageIndex * content.height + y;
    const start = continuousY(first.pageIndex, first.rect.y);
    const end = Math.max(
      ...fragments.map((fragment) =>
        continuousY(fragment.pageIndex, fragment.rect.y) + fragment.rect.height,
      ),
    );
    const card = clampCardRect(
      {
        x: roundPoint(first.rect.x),
        y: roundPoint(start),
        width: roundPoint(first.rect.width),
        height: roundPoint(Math.max(MIN_COMPONENT_HEIGHT, end - start)),
      },
      content.width,
    );

    if (component.type === "plan") {
      return {
        id: component.id,
        name: component.name,
        type: "plan" as const,
        ...card,
        html: component.html,
      };
    }

    return {
      id: component.id,
      name: component.name,
      type: "reference" as const,
      ...card,
      description: component.description,
      images: component.images.map((image) => {
        const frameHeight = image.displayHeight ?? component.imageHeight;
        return {
          id: image.id,
          file: image.file,
          ...(image.caption === undefined ? {} : { caption: image.caption }),
          aspectRatio: image.aspectRatio,
          frameWidth: frameHeight * image.aspectRatio,
          frameHeight,
        };
      }),
    };
  });

  return { schemaVersion: 7, title: plan.title, components };
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

function visualTextHtml(component: PlanTextComponent): string {
  return layoutTextTree(component.textRoot, {
    x: 0,
    y: 0,
    width: component.width,
    height: component.height,
  })
    .map((placement, sourceIndex) => ({ ...placement, sourceIndex }))
    .sort((left, right) =>
      left.rect.y - right.rect.y ||
      left.rect.x - right.rect.x ||
      left.sourceIndex - right.sourceIndex,
    )
    .map(({ leaf }) => htmlFragment(leaf.html))
    .join("");
}

function v12Reference(component: ReferenceComponent): ReferenceComponent {
  return {
    ...component,
    x: 0,
    width: contentSize(DEFAULT_PAGE_GEOMETRY).width,
    description: "",
  };
}

function validateV12Document(documentHtml: string, components: readonly PlanComponent[]): void {
  const references = components.filter(
    (component): component is ReferenceComponent => component.type === "reference",
  );
  if (references.length !== components.length) {
    throw new Error("Stored plan schema version 12 components may only contain image groups");
  }
  const markerIds = imageGroupIdsInHtml(documentHtml);
  const markerCounts = new Map<string, number>();
  markerIds.forEach((id) => markerCounts.set(id, (markerCounts.get(id) ?? 0) + 1));
  const groupIds = new Set(references.map((component) => component.id));
  for (const [id, count] of markerCounts) {
    if (!groupIds.has(id)) {
      throw new Error(`Stored canvas document references missing image group "${id}"`);
    }
    if (count !== 1) {
      throw new Error(`Stored canvas document references image group "${id}" ${count} times`);
    }
  }
  for (const id of groupIds) {
    if (markerCounts.get(id) !== 1) {
      throw new Error(`Stored image group "${id}" must appear exactly once in the canvas document`);
    }
  }
}

function v12FromV11(plan: V11ProjectPlan): ProjectPlan {
  const fragments: string[] = [];
  const components: ReferenceComponent[] = [];
  for (const component of plan.components) {
    if (component.type === "plan") {
      fragments.push(visualTextHtml(component));
      continue;
    }
    if (component.name.trim()) {
      fragments.push(`<h2>${escapeDocumentText(component.name.trim())}</h2>`);
    }
    fragments.push(htmlFragment(component.description));
    fragments.push(imageGroupMarker(component.id));
    components.push(v12Reference(component));
  }
  const documentHtml = `${fragments.join("")}<p></p>`;
  validateV12Document(documentHtml, components);
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    title: plan.title,
    documentHtml,
    components,
  };
}

export function migratePlan(raw: unknown, context: PlanMigrationContext): ProjectPlan {
  if (!isRecord(raw)) {
    throw new Error("Stored plan must be an object");
  }
  const makeId = context.makeId ?? defaultIdFactory();
  if (typeof raw.schemaVersion === "number" && raw.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(`Unsupported stored plan schema version ${raw.schemaVersion}`);
  }
  if (raw.schemaVersion === 12) {
    requireOnlyKeys(raw, ["schemaVersion", "title", "documentHtml", "components"], "document", 12);
    if (
      typeof raw.title !== "string" ||
      !raw.title.trim() ||
      raw.title !== raw.title.trim() ||
      typeof raw.documentHtml !== "string" ||
      !raw.documentHtml.trim() ||
      !Array.isArray(raw.components)
    ) {
      throw new Error("Stored plan schema version 12 title, documentHtml and components must be valid");
    }
    const components = raw.components.map((component, index) =>
      v11Component(component, index, true)
    );
    validateLogicalIds(components);
    validateV12Document(raw.documentHtml, components);
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      title: raw.title,
      documentHtml: raw.documentHtml,
      components,
    };
  }
  if (raw.schemaVersion === 11) {
    requireOnlyKeys(raw, ["schemaVersion", "title", "components"], "document", 11);
    if (
      typeof raw.title !== "string" ||
      !raw.title.trim() ||
      raw.title !== raw.title.trim() ||
      !Array.isArray(raw.components)
    ) {
      throw new Error("Stored plan schema version 11 title and components must be valid");
    }
    const components = raw.components.map((component, index) => v11Component(component, index));
    validateLogicalIds(components);
    return v12FromV11({ schemaVersion: 11, title: raw.title, components });
  }
  if (raw.schemaVersion === 10) {
    requireOnlyKeys(raw, ["schemaVersion", "title", "components"], "document", 10);
    if (
      typeof raw.title !== "string" ||
      !raw.title.trim() ||
      raw.title !== raw.title.trim() ||
      !Array.isArray(raw.components)
    ) {
      throw new Error("Stored plan schema version 10 title and components must be valid");
    }
    const components = raw.components.map((component, index) => v10Component(component, index));
    validateLogicalIds(components);
    return v12FromV11(v11FromV10({ schemaVersion: 11, title: raw.title, components }));
  }
  if (raw.schemaVersion === 9) {
    requireOnlyKeys(raw, ["schemaVersion", "title", "components"], "document", 9);
    if (
      typeof raw.title !== "string" ||
      !raw.title.trim() ||
      raw.title !== raw.title.trim() ||
      !Array.isArray(raw.components)
    ) {
      throw new Error("Stored plan schema version 9 title and components must be valid");
    }
    const components = raw.components.map((component, index) => v9Component(component, index));
    validateLogicalIds(components);
    return v12FromV11(v10FromV9({ schemaVersion: 9, title: raw.title, components }));
  }
  if (raw.schemaVersion === 8) {
    requireOnlyKeys(raw, ["schemaVersion", "title", "components"], "document", 8);
    if (
      typeof raw.title !== "string" ||
      !raw.title.trim() ||
      raw.title !== raw.title.trim() ||
      !Array.isArray(raw.components)
    ) {
      throw new Error("Stored plan schema version 8 title and components must be valid");
    }
    const components = raw.components.map((component, index) => v8Component(component, index));
    validateLogicalIds(components);
    return v12FromV11(v10FromV8({ schemaVersion: 8, title: raw.title, components }));
  }
  if (raw.schemaVersion === 7) {
    requireOnlyKeys(raw, ["schemaVersion", "title", "components"], "document", 7);
    if (
      typeof raw.title !== "string" ||
      !raw.title.trim() ||
      raw.title !== raw.title.trim() ||
      !Array.isArray(raw.components)
    ) {
      throw new Error("Stored plan schema version 7 title and components must be valid");
    }
    const components = raw.components.map((component, index) => v7Component(component, index));
    validateLogicalIds(components);
    validateComponentNames(components);
    return v12FromV11(v10FromV8(v8FromV7({ schemaVersion: 7, title: raw.title, components })));
  }
  if (raw.schemaVersion === 6) {
    requireOnlyKeys(raw, ["schemaVersion", "title", "components"], "document");
    if (typeof raw.title !== "string" || !raw.title.trim() || raw.title !== raw.title.trim() || !Array.isArray(raw.components)) {
      throw new Error("Stored plan schema version 6 title and components must be valid");
    }
    const components = raw.components.map((component, index) => v6Component(component, index));
    validateLogicalIds(components);
    validateComponentNames(components);
    return v12FromV11(v10FromV8(v8FromV7(v7FromV6({ schemaVersion: 6, title: raw.title, components }))));
  }
  if (raw.schemaVersion === 5) {
    if (typeof raw.title !== "string" || !Array.isArray(raw.components)) {
      throw new Error("Stored plan schema version 5 title and components must be valid");
    }
    const title = raw.title.trim();
    if (!title) {
      throw new Error("Stored plan schema version 5 title must be non-blank");
    }
    return v12FromV11(v10FromV8(v8FromV7(v7FromV6(
      v6FromV5(raw.components.map((component, index) => v5Component(component, index)), title),
    ))));
  }
  if (raw.schemaVersion === 4 || raw.schemaVersion === 3) {
    if (!Array.isArray(raw.components)) {
      throw new Error(`Stored plan schema version ${raw.schemaVersion} components must be an array`);
    }
    const multiplier = raw.schemaVersion === 3 ? 0.75 : 1;
    return v12FromV11(v10FromV8(v8FromV7(v7FromV6(
      v6FromLegacy(
        migrateComponents(raw.components, makeId, (component, ids, index) =>
          legacyComponent(component, ids, index, {
            allowMissingId: false,
            imageHeightMultiplier: multiplier,
          }),
        ),
        context,
      ),
    ))));
  }
  if (raw.schemaVersion === 2) {
    if (!Array.isArray(raw.components)) {
      throw new Error("Stored plan schema version 2 components must be an array");
    }
    return v12FromV11(v10FromV8(v8FromV7(v7FromV6(
      v6FromLegacy(
        remapLegacyLogicalIds(migrateComponents(raw.components, makeId, v2Component)),
        context,
      ),
    ))));
  }
  if (typeof raw.photographyPlan === "string" || Array.isArray(raw.referenceGroups)) {
    return migratePlan(migrateV1ToV2(raw, makeId), context);
  }
  throw new Error("Stored plan has an unsupported or missing schema");
}
