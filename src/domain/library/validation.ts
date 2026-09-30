import { validateArtifactContentLayout } from "../plan/canvas/artifactContentLayout";
import {
  artifactCollectionsInPlan,
  validateProjectPlanV15,
  type ProjectPlanV15,
} from "../plan/canvas/blockDocument";
import type { ReferenceImage } from "../plan/canvas/models";
import {
  MATERIAL_KINDS,
  type MaterialMetadata,
  type MaterialPayload,
  type PortableCollection,
  type PortableComponent,
  type PortableImage,
} from "./models";
import {
  buildMaterialInstance,
  componentImages,
  componentText,
  instancePlan,
} from "./materialStructure";

const IMAGE_LIMIT = 128;
const TEXT_LIMIT = 200_000;
const PAYLOAD_BYTE_LIMIT = 1024 * 1024;
const IMAGE_KEYS = [
  "localImageId", "caption", "aspectRatio", "sourceWidth", "sourceHeight",
  "frameWidth", "frameHeight", "frameOffsetX", "frameOffsetY", "fitMode", "crop",
] as const;

export function exactRecord(
  value: unknown,
  keys: readonly string[],
  context: string,
): Record<string, unknown> {
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw new Error(`${context} must be a plain object`);
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (
      typeof key !== "string" || !keys.includes(key) ||
      !descriptor.enumerable || !("value" in descriptor)
    ) {
      throw new Error(`${context} has an unsupported field`);
    }
  }
  return value as Record<string, unknown>;
}

function boundedArray(value: unknown, limit: number, context: string): unknown[] {
  if (
    !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > limit
  ) {
    throw new Error(`${context} must be an array within the ${limit} limit`);
  }
  if (Reflect.ownKeys(value).length !== value.length + 1) {
    throw new Error(`${context} must be a dense plain array`);
  }
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (!descriptor || !("value" in descriptor)) {
      throw new Error(`${context} must contain plain values`);
    }
  }
  return value;
}

function codePointLength(value: string): number {
  let length = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff) {
      throw new Error("Material text must contain valid Unicode");
    }
    length++;
  }
  return length;
}

function utf8ByteLength(value: string): number {
  let length = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    length += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return length;
}

export function assertLocalImageId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) {
    throw new Error("Material localImageId must be a bounded portable identifier");
  }
}

export function assertReferenceFile(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.startsWith("references/")) {
    throw new Error("Material image file must be a project-relative reference");
  }
  const filename = value.slice("references/".length);
  if (
    filename.length > 255 || !/\.(?:jpe?g|png)$/i.test(filename) ||
    /[<>:"/\\|?*%\p{Cc}\uD800-\uDFFF]/u.test(filename) || /[. ]$/.test(filename) ||
    /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(filename)
  ) {
    throw new Error("Material image file must be a safe project-local JPG or PNG path");
  }
}

export function validateReferenceImages(images: ReferenceImage[]): void {
  // v15 validates artifact images more strictly than image-group sidecars.
  // Use that same image contract for groups, without invoking material parsing.
  for (let start = 0; start < images.length; start += IMAGE_LIMIT) {
    validateProjectPlanV15({
      schemaVersion: 17,
      title: "Material image validation",
      document: {
        format: "preshot-blocks", version: 5,
        blocks: [{
          id: "validation-block", type: "prop", props: { artifactId: "validation-artifact" },
          content: undefined, children: [],
        }],
      },
      imageGroups: [],
      artifacts: [{
        id: "validation-artifact", revision: 0, kind: "prop", title: "Image validation",
        source: "", gallery: { id: "validation-gallery", images: images.slice(start, start + IMAGE_LIMIT) },
      }],
    });
  }
}

export function validateMaterialPayload(input: unknown): MaterialPayload {
  const header = exactRecord(input, ["format", "version", "kind", "component"], "Material payload");
  if (
    header.format !== "preshot-material" || (header.version !== 1 && header.version !== 2) ||
    !(MATERIAL_KINDS as readonly unknown[]).includes(header.kind)
  ) {
    throw new Error("Material payload format, version or kind is unsupported");
  }
  let textLength = 0;
  const text = (value: unknown, context: string): string => {
    if (typeof value !== "string" || value.length > TEXT_LIMIT * 2) {
      throw new Error(`${context} must be text within the ${TEXT_LIMIT} limit`);
    }
    textLength += codePointLength(value);
    if (textLength > TEXT_LIMIT) {
      throw new Error(`Material text exceeds the ${TEXT_LIMIT} code point limit`);
    }
    return value;
  };
  const seen = new Set<string>();
  const images = (value: unknown): PortableImage[] =>
    boundedArray(value, IMAGE_LIMIT, "Material images").map((entry) => {
      const image = exactRecord(entry, IMAGE_KEYS, "Material image");
      assertLocalImageId(image.localImageId);
      if (seen.has(image.localImageId)) {
        throw new Error("Material localImageId must be unique");
      }
      seen.add(image.localImageId);
      const result: Record<string, unknown> = { ...image };
      if (image.caption !== undefined) result.caption = text(image.caption, "Image caption");
      if (image.crop !== undefined) {
        result.crop = { ...exactRecord(image.crop, ["x", "y", "width", "height"], "Image crop") };
      }
      return result as unknown as PortableImage;
    });
  const collection = (value: unknown): PortableCollection => {
    const record = exactRecord(value, ["images"], "Material collection");
    return { images: images(record.images) };
  };
  let component: PortableComponent;
  switch (header.kind) {
    case "image":
    case "imageGroup": {
      const value = exactRecord(header.component, ["kind", "name", "description", "images"], "Image group");
      const entries = images(value.images);
      if (header.kind === "image" && entries.length > 1) throw new Error("图片素材只能包含一张图片。");
      component = { kind: header.kind, name: text(value.name, "Group name"),
        description: text(value.description, "Group description"), images: entries };
      break;
    }
    case "shootingLocation": {
      const value = exactRecord(header.component,
        ["kind", "venueName", "address", "description", "gallery", "contentLayout"], "Location");
      component = { kind: "shootingLocation", venueName: text(value.venueName, "Venue name"),
        address: text(value.address, "Address"), description: text(value.description, "Location description"),
        gallery: collection(value.gallery) };
      break;
    }
    case "modelCard": {
      const value = exactRecord(header.component,
        ["kind", "modelId", "heightCm", "weightKg", "shoeSize", "notes", "samples"], "Model");
      component = {
        kind: "modelCard", modelId: text(value.modelId, "Model name"),
        heightCm: value.heightCm as number | null, weightKg: value.weightKg as number | null,
        shoeSize: text(value.shoeSize, "Shoe size"),
        ...(value.notes === undefined ? {} : { notes: text(value.notes, "Model notes") }),
        samples: collection(value.samples),
      };
      break;
    }
    case "prop": {
      const value = exactRecord(header.component, ["kind", "title", "source", "gallery", "contentLayout"], "Prop");
      component = { kind: "prop", title: text(value.title, "Prop title"),
        source: text(value.source, "Prop source"), gallery: collection(value.gallery) };
      break;
    }
    case "clothing": {
      const value = exactRecord(header.component, ["kind", "title", "source", "mainGallery", "contentLayout"], "Clothing");
      component = { kind: "clothing", title: text(value.title, "Clothing title"),
        source: text(value.source, "Clothing source"), mainGallery: collection(value.mainGallery) };
      break;
    }
    default: throw new Error("Material kind is unsupported");
  }
  if ((header.component as Record<string, unknown>).kind !== component.kind) {
    throw new Error("Material component kind does not match the payload kind");
  }
  const layout = (header.component as Record<string, unknown>).contentLayout;
  if (layout !== undefined) {
    if (header.version !== 2 || !["prop", "clothing", "shootingLocation"].includes(component.kind)) throw new Error("Unsupported card layout");
    component = { ...component, contentLayout: validateArtifactContentLayout(layout) };
  }
  const payload: MaterialPayload = { format: "preshot-material", version: header.version as 1 | 2, kind: component.kind, component };
  const portableImages = componentImages(component);
  const sources = new Map(portableImages.map((image, index) =>
    [image.localImageId, `references/validation-${index}.png`]));
  let id = 0;
  const instance = buildMaterialInstance(payload, sources, () => `validation-${++id}`);
  validateProjectPlanV15(instancePlan(instance));
  if (instance.imageGroup) validateReferenceImages(instance.imageGroup.images);
  if (componentText(component).reduce((sum, entry) => sum + codePointLength(entry), 0) > TEXT_LIMIT) {
    throw new Error(`Material searchable text exceeds the ${TEXT_LIMIT} code point limit`);
  }
  if (utf8ByteLength(JSON.stringify(payload)) > PAYLOAD_BYTE_LIMIT) {
    throw new Error("Material payload JSON exceeds the 1 MiB byte limit");
  }
  return payload;
}

export function validateMaterialMetadata(input: MaterialMetadata): MaterialMetadata {
  const value = exactRecord(input, ["name", "description", "tags", "favorite"], "Material metadata");
  const normalize = (input: unknown, limit: number, label: string, multiline = false): string => {
    if (typeof input !== "string" || input.length > (limit + 1024) * 2) {
      throw new Error(`Material ${label} must be bounded text`);
    }
    const normalized = input.trim().normalize("NFC");
    const withoutLineBreaks = multiline ? normalized.replace(/[\t\n\r]/g, "") : normalized;
    if (codePointLength(normalized) > limit || /\p{Cc}/u.test(withoutLineBreaks)) {
      throw new Error(`Material ${label} exceeds its ${limit} character limit or contains control characters`);
    }
    return normalized;
  };
  const name = normalize(value.name, 80, "name");
  if (!name) throw new Error("Material name is required");
  const description = normalize(value.description, 1000, "description", true);
  const tags: string[] = [];
  const keys = new Set<string>();
  for (const entry of boundedArray(value.tags, 128, "Material tags")) {
    const tag = normalize(entry, 24, "tag");
    if (!tag) throw new Error("Material tags must not be empty");
    const key = tag.toLowerCase();
    if (!keys.has(key)) {
      keys.add(key);
      tags.push(tag);
    }
  }
  if (tags.length > 12) throw new Error("Material tags exceed the 12 tag limit");
  if (typeof value.favorite !== "boolean") throw new Error("Material favorite must be boolean");
  return { name, description, tags, favorite: value.favorite };
}

export function validateLibraryPlan(plan: ProjectPlanV15): ProjectPlanV15 {
  const validated = validateProjectPlanV15(plan);
  for (const group of validated.imageGroups) {
    exactRecord(group, [
      "id", "name", "type", "x", "width", "height", "frameOffsetY", "description", "images",
    ], "Image group");
    if (
      typeof group.name !== "string" || typeof group.description !== "string" ||
      !Number.isFinite(group.x) || !Number.isFinite(group.width) || group.width <= 0 ||
      !Number.isFinite(group.height) || group.height <= 0 ||
      (group.frameOffsetY !== undefined && !Number.isFinite(group.frameOffsetY))
    ) {
      throw new Error("Image group fields are malformed");
    }
    validateReferenceImages(group.images);
    group.images.forEach((image) => assertReferenceFile(image.file));
  }
  for (const collection of artifactCollectionsInPlan(validated)) {
    collection.images.forEach((image) => assertReferenceFile(image.file));
  }
  return validated;
}
