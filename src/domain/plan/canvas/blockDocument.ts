import type { ReferenceComponent, ReferenceImage } from "./models";

export const BLOCK_DOCUMENT_SCHEMA_VERSION = 3 as const;
export const BLOCKNOTE_PLAN_SCHEMA_VERSION = 15 as const;
export const ARTIFACT_RECORD_LIMIT = 512;
export const ARTIFACT_COLLECTION_IMAGE_LIMIT = 128;
export const ARTIFACT_IMAGE_LIMIT = 2_048;

const LEGACY_BLOCK_DOCUMENT_SCHEMA_VERSION = 2 as const;
const LEGACY_BLOCKNOTE_PLAN_SCHEMA_VERSION = 14 as const;

export type BlockPrimitive = boolean | number | string;
export type BlockProps = Record<string, BlockPrimitive>;
export type BlockTextStyles = Record<string, BlockPrimitive>;

export interface BlockStyledText {
  type: "text";
  text: string;
  styles: BlockTextStyles;
}

export interface BlockLink {
  type: "link";
  href: string;
  content: BlockStyledText[];
}

export type BlockInlineContent = BlockLink | BlockStyledText;

export interface BlockTableContent {
  type: "tableContent";
  columnWidths: Array<number | null>;
  headerRows?: number;
  headerCols?: number;
  rows: Array<{
    cells: BlockInlineContent[][];
  }>;
}

const LEGACY_PRESHOT_BLOCK_TYPES = [
  "paragraph",
  "heading",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "toggleListItem",
  "quote",
  "codeBlock",
  "table",
  "divider",
  "pageBreak",
  "imageGroup",
  "image",
  "video",
  "audio",
  "file",
  "column",
  "columnList",
] as const;

export const ARTIFACT_KINDS = [
  "shootingLocation",
  "modelCard",
  "clothing",
  "prop",
] as const;

export const PRESHOT_BLOCK_TYPES = [
  ...LEGACY_PRESHOT_BLOCK_TYPES,
  ...ARTIFACT_KINDS,
] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
export type PreshotBlockType = (typeof PRESHOT_BLOCK_TYPES)[number];

export interface PreshotBlock {
  id: string;
  type: PreshotBlockType;
  props: BlockProps;
  content: BlockInlineContent[] | BlockTableContent | undefined;
  children: PreshotBlock[];
}

export interface PreshotBlockDocument {
  format: "preshot-blocks";
  version: typeof BLOCK_DOCUMENT_SCHEMA_VERSION;
  blocks: PreshotBlock[];
}

interface LegacyPreshotBlockDocumentV2 {
  format: "preshot-blocks";
  version: typeof LEGACY_BLOCK_DOCUMENT_SCHEMA_VERSION;
  blocks: PreshotBlock[];
}

export interface ImageCollection {
  id: string;
  images: ReferenceImage[];
}

interface ArtifactBase {
  id: string;
  kind: ArtifactKind;
  revision: number;
}

export interface ShootingLocationArtifact extends ArtifactBase {
  kind: "shootingLocation";
  venueName: string;
  address: string;
  description: string;
  gallery: ImageCollection;
}

export interface ModelCardArtifact extends ArtifactBase {
  kind: "modelCard";
  modelId: string;
  heightCm: number | null;
  weightKg: number | null;
  shoeSize: string;
  samples: ImageCollection;
}

export interface ClothingArtifact extends ArtifactBase {
  kind: "clothing";
  title: string;
  mainGallery: ImageCollection;
  tryOn: {
    expanded: boolean;
    gallery: ImageCollection;
  };
  source: string;
}

export interface PropArtifact extends ArtifactBase {
  kind: "prop";
  title: string;
  gallery: ImageCollection;
  source: string;
}

export type ArtifactRecord =
  | ClothingArtifact
  | ModelCardArtifact
  | PropArtifact
  | ShootingLocationArtifact;

export interface ProjectPlanV15 {
  schemaVersion: typeof BLOCKNOTE_PLAN_SCHEMA_VERSION;
  title: string;
  document: PreshotBlockDocument;
  imageGroups: ReferenceComponent[];
  artifacts: ArtifactRecord[];
}

export interface LegacyProjectPlanV14 {
  schemaVersion: typeof LEGACY_BLOCKNOTE_PLAN_SCHEMA_VERSION;
  title: string;
  document: LegacyPreshotBlockDocumentV2;
  imageGroups: ReferenceComponent[];
}

interface LegacyProjectPlanV13 {
  schemaVersion: 13;
  title: string;
  document: {
    format: "preshot-blocks";
    version: 1;
    blocks: PreshotBlock[];
  };
  imageGroups: ReferenceComponent[];
}

/** @deprecated Use ProjectPlanV15. */
export type ProjectPlanV14 = ProjectPlanV15;
/** @deprecated Use ProjectPlanV15. */
export type ProjectPlanV13 = ProjectPlanV15;

export interface BlockDocumentContext {
  makeId(): string;
}

interface ArtifactMarker {
  id: string;
  kind: ArtifactKind;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  context: string,
): void {
  const allowedKeys = new Set(allowed);
  const unsupported = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unsupported) {
    throw new Error(`${context} has unsupported field "${unsupported}"`);
  }
}

function assertIdentifier(value: unknown, context: string): asserts value is string {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim()
  ) {
    throw new Error(`${context} must be a non-empty identifier`);
  }
}

function assertRequiredText(value: unknown, context: string): asserts value is string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value !== value.trim()
  ) {
    throw new Error(`${context} must be non-empty trimmed text`);
  }
}

function assertPrimitiveRecord(value: unknown, context: string): asserts value is BlockProps {
  if (!isRecord(value)) {
    throw new Error(`${context} props must be an object`);
  }
  for (const [key, entry] of Object.entries(value)) {
    if (
      !key ||
      (
        typeof entry !== "boolean" &&
        typeof entry !== "number" &&
        typeof entry !== "string"
      ) ||
      (typeof entry === "number" && !Number.isFinite(entry))
    ) {
      throw new Error(`${context} has invalid primitive prop "${key}"`);
    }
  }
}

function assertStyledText(value: unknown, context: string): asserts value is BlockStyledText {
  if (
    !isRecord(value) ||
    value.type !== "text" ||
    typeof value.text !== "string"
  ) {
    throw new Error(`${context} must be styled text`);
  }
  assertPrimitiveRecord(value.styles, `${context} styles`);
}

function assertInlineContent(
  value: unknown,
  context: string,
): asserts value is BlockInlineContent {
  if (!isRecord(value)) {
    throw new Error(`${context} must be inline content`);
  }
  if (value.type === "text") {
    assertStyledText(value, context);
    return;
  }
  if (
    value.type !== "link" ||
    typeof value.href !== "string" ||
    !Array.isArray(value.content)
  ) {
    throw new Error(`${context} must be text or link content`);
  }
  value.content.forEach((entry, index) =>
    assertStyledText(entry, `${context} link text ${index}`),
  );
}

function assertTableContent(
  value: unknown,
  context: string,
): asserts value is BlockTableContent {
  if (
    !isRecord(value) ||
    value.type !== "tableContent" ||
    !Array.isArray(value.columnWidths) ||
    !Array.isArray(value.rows)
  ) {
    throw new Error(`${context} must be table content`);
  }
  value.columnWidths.forEach((width, index) => {
    if (
      width !== null &&
      (
        typeof width !== "number" ||
        !Number.isFinite(width) ||
        width <= 0
      )
    ) {
      throw new Error(`${context} column ${index} has invalid width`);
    }
  });
  for (const key of ["headerRows", "headerCols"] as const) {
    const entry = value[key];
    if (
      entry !== undefined &&
      (
        typeof entry !== "number" ||
        !Number.isInteger(entry) ||
        entry < 0
      )
    ) {
      throw new Error(`${context} has invalid ${key}`);
    }
  }
  value.rows.forEach((row, rowIndex) => {
    if (!isRecord(row) || !Array.isArray(row.cells)) {
      throw new Error(`${context} row ${rowIndex} is invalid`);
    }
    row.cells.forEach((cell, cellIndex) => {
      if (!Array.isArray(cell)) {
        throw new Error(`${context} cell ${rowIndex}:${cellIndex} is invalid`);
      }
      cell.forEach((entry, index) =>
        assertInlineContent(
          entry,
          `${context} cell ${rowIndex}:${cellIndex} item ${index}`,
        ),
      );
    });
  });
}

function isArtifactKind(value: PreshotBlockType): value is ArtifactKind {
  return (ARTIFACT_KINDS as readonly string[]).includes(value);
}

function assertBlock(
  value: unknown,
  context: string,
  blockIds: Set<string>,
  imageGroupIds: string[],
  artifactMarkers: ArtifactMarker[],
  parentType: PreshotBlockType | null,
  allowedBlockTypes: readonly string[],
): asserts value is PreshotBlock {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.type !== "string" ||
    !allowedBlockTypes.includes(value.type) ||
    !Array.isArray(value.children)
  ) {
    throw new Error(`${context} is an invalid block`);
  }
  if (blockIds.has(value.id)) {
    throw new Error(`Stored block id "${value.id}" must be unique`);
  }
  blockIds.add(value.id);
  assertPrimitiveRecord(value.props, context);

  const blockType = value.type as PreshotBlockType;
  if (parentType === "columnList" && blockType !== "column") {
    throw new Error(`${context} column list children must be columns`);
  }
  if (
    parentType === "column" &&
    (blockType === "column" || blockType === "columnList")
  ) {
    throw new Error(`${context} column children must be regular blocks`);
  }

  if (blockType === "columnList") {
    if (parentType !== null) {
      throw new Error(`${context} column list must be top-level`);
    }
    if (
      value.content !== undefined ||
      value.children.length < 2 ||
      value.children.some((child) =>
        !isRecord(child) || child.type !== "column")
    ) {
      throw new Error(`${context} column list is malformed`);
    }
  } else if (blockType === "column") {
    if (
      parentType !== "columnList" ||
      value.content !== undefined ||
      typeof value.props.width !== "number" ||
      !Number.isFinite(value.props.width) ||
      value.props.width <= 0 ||
      value.children.length === 0
    ) {
      throw new Error(`${context} column is malformed`);
    }
  } else if (blockType === "imageGroup") {
    if (parentType !== null && parentType !== "column") {
      throw new Error(
        `Image group block "${value.id}" must be top-level or inside a column`,
      );
    }
    if (
      typeof value.props.groupId !== "string" ||
      !value.props.groupId ||
      value.content !== undefined ||
      value.children.length !== 0
    ) {
      throw new Error(`Image group block "${value.id}" is malformed`);
    }
    imageGroupIds.push(value.props.groupId);
  } else if (isArtifactKind(blockType)) {
    if (parentType !== null && parentType !== "column") {
      throw new Error(
        `Artifact marker block "${value.id}" must be top-level or inside a column`,
      );
    }
    if (
      typeof value.props.artifactId !== "string" ||
      !value.props.artifactId ||
      Object.keys(value.props).length !== 1 ||
      value.content !== undefined ||
      value.children.length !== 0
    ) {
      throw new Error(`Artifact marker block "${value.id}" is malformed`);
    }
    artifactMarkers.push({
      id: value.props.artifactId,
      kind: blockType,
    });
  } else if (
    blockType === "image" ||
    blockType === "video" ||
    blockType === "audio" ||
    blockType === "file"
  ) {
    const url = value.props.url;
    if (
      value.content !== undefined ||
      typeof value.props.name !== "string" ||
      typeof url !== "string" ||
      typeof value.props.caption !== "string" ||
      typeof value.props.showPreview !== "boolean" ||
      (
        url !== "" &&
        !/^https?:\/\//i.test(url) &&
        !/^media\/[^/\\]+$/i.test(url)
      ) ||
      (
        (blockType === "image" || blockType === "video") &&
        value.props.previewWidth !== undefined &&
        (
          typeof value.props.previewWidth !== "number" ||
          !Number.isFinite(value.props.previewWidth) ||
          value.props.previewWidth <= 0
        )
      )
    ) {
      throw new Error(`${context} native media block is malformed`);
    }
  } else if (blockType === "table") {
    assertTableContent(value.content, `${context} table`);
  } else if (blockType === "divider" || blockType === "pageBreak") {
    if (value.content !== undefined) {
      throw new Error(`${context} divider content must be undefined`);
    }
  } else {
    if (!Array.isArray(value.content)) {
      throw new Error(`${context} content must be an inline content array`);
    }
    value.content.forEach((entry, index) =>
      assertInlineContent(entry, `${context} content ${index}`),
    );
  }

  value.children.forEach((child, index) =>
    assertBlock(
      child,
      `${context} child ${index}`,
      blockIds,
      imageGroupIds,
      artifactMarkers,
      blockType,
      allowedBlockTypes,
    ),
  );
}

function validateBlockDocumentVersion(
  value: unknown,
  version: 2 | 3,
): {
  document: PreshotBlockDocument | LegacyPreshotBlockDocumentV2;
  imageGroupIds: string[];
  artifactMarkers: ArtifactMarker[];
} {
  if (
    !isRecord(value) ||
    value.format !== "preshot-blocks" ||
    value.version !== version ||
    !Array.isArray(value.blocks)
  ) {
    throw new Error("Stored BlockNote document is malformed or unsupported");
  }
  const blockIds = new Set<string>();
  const imageGroupIds: string[] = [];
  const artifactMarkers: ArtifactMarker[] = [];
  const allowedBlockTypes = version === BLOCK_DOCUMENT_SCHEMA_VERSION
    ? PRESHOT_BLOCK_TYPES
    : LEGACY_PRESHOT_BLOCK_TYPES;
  value.blocks.forEach((block, index) =>
    assertBlock(
      block,
      `Stored document block ${index}`,
      blockIds,
      imageGroupIds,
      artifactMarkers,
      null,
      allowedBlockTypes,
    ),
  );
  return {
    document: value as unknown as
      | LegacyPreshotBlockDocumentV2
      | PreshotBlockDocument,
    imageGroupIds,
    artifactMarkers,
  };
}

export function validateBlockDocument(value: unknown): PreshotBlockDocument {
  return validateBlockDocumentVersion(value, BLOCK_DOCUMENT_SCHEMA_VERSION)
    .document as PreshotBlockDocument;
}

function visitBlocks(
  blocks: readonly PreshotBlock[],
  visit: (block: PreshotBlock) => void,
): void {
  for (const block of blocks) {
    visit(block);
    visitBlocks(block.children, visit);
  }
}

export function imageGroupIdsInBlockDocument(
  document: Pick<PreshotBlockDocument, "blocks">,
): string[] {
  const ids: string[] = [];
  visitBlocks(document.blocks, (block) => {
    if (block.type === "imageGroup") {
      ids.push(String(block.props.groupId));
    }
  });
  return ids;
}

export function artifactIdsInBlockDocument(
  document: Pick<PreshotBlockDocument, "blocks">,
): string[] {
  const ids: string[] = [];
  visitBlocks(document.blocks, (block) => {
    if (isArtifactKind(block.type)) {
      ids.push(String(block.props.artifactId));
    }
  });
  return ids;
}

export function artifactCollectionsInPlan(
  plan: Pick<ProjectPlanV15, "artifacts">,
): ImageCollection[] {
  return plan.artifacts.flatMap((artifact) => {
    if (artifact.kind === "shootingLocation") return [artifact.gallery];
    if (artifact.kind === "modelCard") return [artifact.samples];
    if (artifact.kind === "clothing") {
      return [artifact.mainGallery, artifact.tryOn.gallery];
    }
    return [artifact.gallery];
  });
}

export function mediaFilesInBlockDocument(
  document: Pick<PreshotBlockDocument, "blocks">,
): string[] {
  const files: string[] = [];
  visitBlocks(document.blocks, (block) => {
    if (
      (
        block.type === "image" ||
        block.type === "video" ||
        block.type === "audio" ||
        block.type === "file"
      ) &&
      typeof block.props.url === "string" &&
      /^media\/[^/\\]+$/i.test(block.props.url)
    ) {
      files.push(block.props.url);
    }
  });
  return files;
}

function assertReferenceImage(
  value: unknown,
  context: string,
): asserts value is ReferenceImage {
  if (!isRecord(value)) {
    throw new Error(`${context} is malformed`);
  }
  assertExactKeys(value, [
    "id",
    "file",
    "caption",
    "aspectRatio",
    "sourceWidth",
    "sourceHeight",
    "frameWidth",
    "frameHeight",
    "frameOffsetX",
    "frameOffsetY",
    "fitMode",
    "crop",
  ], context);
  assertIdentifier(value.id, `${context} id`);
  if (
    typeof value.file !== "string" ||
    !/^references\/[^/\\]+$/i.test(value.file)
  ) {
    throw new Error(`${context} file must be a project-relative reference`);
  }
  for (const key of ["aspectRatio", "frameWidth", "frameHeight"] as const) {
    if (
      typeof value[key] !== "number" ||
      !Number.isFinite(value[key]) ||
      value[key] <= 0
    ) {
      throw new Error(`${context} has invalid ${key}`);
    }
  }
  for (const key of ["sourceWidth", "sourceHeight"] as const) {
    const entry = value[key];
    if (
      entry !== undefined &&
      (
        typeof entry !== "number" ||
        !Number.isInteger(entry) ||
        entry <= 0
      )
    ) {
      throw new Error(`${context} has invalid ${key}`);
    }
  }
  for (const key of ["frameOffsetX", "frameOffsetY"] as const) {
    const entry = value[key];
    if (
      entry !== undefined &&
      (typeof entry !== "number" || !Number.isFinite(entry))
    ) {
      throw new Error(`${context} has invalid ${key}`);
    }
  }
  if (value.caption !== undefined && typeof value.caption !== "string") {
    throw new Error(`${context} has invalid caption`);
  }
  if (
    value.fitMode !== undefined &&
    value.fitMode !== "cover" &&
    value.fitMode !== "stretch"
  ) {
    throw new Error(`${context} has invalid fitMode`);
  }
  if (value.crop !== undefined) {
    if (!isRecord(value.crop)) {
      throw new Error(`${context} has invalid crop`);
    }
    assertExactKeys(value.crop, ["x", "y", "width", "height"], `${context} crop`);
    const { x, y, width, height } = value.crop;
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof width !== "number" ||
      typeof height !== "number" ||
      ![x, y, width, height].every(Number.isFinite) ||
      x < 0 ||
      y < 0 ||
      width <= 0 ||
      height <= 0 ||
      x + width > 1 ||
      y + height > 1
    ) {
      throw new Error(`${context} has invalid crop`);
    }
  }
}

function validateImageGroups(
  value: unknown[],
  imageIds?: Set<string>,
): {
  groups: ReferenceComponent[];
  groupIds: Set<string>;
} {
  const groups = value as ReferenceComponent[];
  const groupIds = new Set<string>();
  for (const [index, group] of groups.entries()) {
    if (
      !isRecord(group) ||
      group.type !== "reference" ||
      typeof group.id !== "string" ||
      !group.id ||
      !Array.isArray(group.images)
    ) {
      throw new Error(`Stored image group ${index} is malformed`);
    }
    if (groupIds.has(group.id)) {
      throw new Error(`Stored image group id "${group.id}" must be unique`);
    }
    groupIds.add(group.id);
    group.images.forEach((image, imageIndex) => {
      if (!isRecord(image)) {
        throw new Error(`Stored image group ${index} image ${imageIndex} is malformed`);
      }
      assertIdentifier(
        image.id,
        `Stored image group ${index} image ${imageIndex} id`,
      );
      if (imageIds?.has(image.id)) {
        throw new Error(`Stored image id "${image.id}" must be globally unique`);
      }
      imageIds?.add(image.id);
    });
  }
  return { groups, groupIds };
}

function assertMarkerCorrespondence(
  markerIds: readonly string[],
  recordIds: ReadonlySet<string>,
  label: string,
): void {
  const markerCounts = new Map<string, number>();
  markerIds.forEach((id) =>
    markerCounts.set(id, (markerCounts.get(id) ?? 0) + 1),
  );
  for (const [id, count] of markerCounts) {
    if (!recordIds.has(id)) {
      throw new Error(`Stored document references missing ${label} "${id}"`);
    }
    if (count !== 1) {
      throw new Error(`Stored document references ${label} "${id}" ${count} times`);
    }
  }
  for (const id of recordIds) {
    if (markerCounts.get(id) !== 1) {
      throw new Error(`Stored ${label} "${id}" must appear exactly once`);
    }
  }
}

function assertImageCollection(
  value: unknown,
  context: string,
  collectionIds: Set<string>,
  imageIds: Set<string>,
): asserts value is ImageCollection {
  if (!isRecord(value)) {
    throw new Error(`${context} is malformed`);
  }
  assertExactKeys(value, ["id", "images"], context);
  assertIdentifier(value.id, `${context} id`);
  if (collectionIds.has(value.id)) {
    throw new Error(`Stored image collection id "${value.id}" must be unique`);
  }
  collectionIds.add(value.id);
  if (!Array.isArray(value.images)) {
    throw new Error(`${context} images must be an array`);
  }
  if (value.images.length > ARTIFACT_COLLECTION_IMAGE_LIMIT) {
    throw new Error(
      `${context} exceeds the ${ARTIFACT_COLLECTION_IMAGE_LIMIT}-image limit`,
    );
  }
  value.images.forEach((image, index) => {
    assertReferenceImage(image, `${context} image ${index}`);
    if (imageIds.has(image.id)) {
      throw new Error(`Stored image id "${image.id}" must be globally unique`);
    }
    imageIds.add(image.id);
  });
}

function assertOptionalMeasurement(
  value: unknown,
  context: string,
): asserts value is number | null {
  if (
    value !== null &&
    (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value <= 0
    )
  ) {
    throw new Error(`${context} must be null or a positive number`);
  }
}

function assertArtifactBase(
  value: Record<string, unknown>,
  context: string,
): void {
  assertIdentifier(value.id, `${context} id`);
  if (
    typeof value.revision !== "number" ||
    !Number.isInteger(value.revision) ||
    value.revision < 0
  ) {
    throw new Error(`${context} revision must be a non-negative integer`);
  }
}

function validateArtifacts(
  values: unknown[],
  artifactMarkers: readonly ArtifactMarker[],
  groupIds: ReadonlySet<string>,
  imageIds: Set<string>,
): ArtifactRecord[] {
  if (values.length > ARTIFACT_RECORD_LIMIT) {
    throw new Error(
      `Stored plan exceeds the ${ARTIFACT_RECORD_LIMIT}-artifact limit`,
    );
  }
  const artifacts = values as ArtifactRecord[];
  const artifactIds = new Set<string>();
  const artifactKinds = new Map<string, ArtifactKind>();
  const collectionIds = new Set(groupIds);
  let artifactImageCount = 0;

  artifacts.forEach((value, index) => {
    const context = `Stored artifact ${index}`;
    if (!isRecord(value) || typeof value.kind !== "string") {
      throw new Error(`${context} is malformed`);
    }
    assertArtifactBase(value, context);
    if (artifactIds.has(value.id as string)) {
      throw new Error(`Stored artifact id "${value.id}" must be unique`);
    }
    artifactIds.add(value.id as string);

    if (value.kind === "shootingLocation") {
      assertExactKeys(value, [
        "id",
        "kind",
        "revision",
        "venueName",
        "address",
        "description",
        "gallery",
      ], context);
      assertRequiredText(value.venueName, `${context} venueName`);
      if (
        typeof value.address !== "string" ||
        typeof value.description !== "string"
      ) {
        throw new Error(`${context} location text fields are malformed`);
      }
      assertImageCollection(
        value.gallery,
        `${context} gallery`,
        collectionIds,
        imageIds,
      );
      artifactImageCount += value.gallery.images.length;
    } else if (value.kind === "modelCard") {
      assertExactKeys(value, [
        "id",
        "kind",
        "revision",
        "modelId",
        "heightCm",
        "weightKg",
        "shoeSize",
        "samples",
      ], context);
      assertRequiredText(value.modelId, `${context} modelId`);
      assertOptionalMeasurement(value.heightCm, `${context} heightCm`);
      assertOptionalMeasurement(value.weightKg, `${context} weightKg`);
      if (typeof value.shoeSize !== "string") {
        throw new Error(`${context} shoeSize must be text`);
      }
      assertImageCollection(
        value.samples,
        `${context} samples`,
        collectionIds,
        imageIds,
      );
      artifactImageCount += value.samples.images.length;
    } else if (value.kind === "clothing") {
      assertExactKeys(value, [
        "id",
        "kind",
        "revision",
        "title",
        "mainGallery",
        "tryOn",
        "source",
      ], context);
      assertRequiredText(value.title, `${context} title`);
      if (typeof value.source !== "string" || !isRecord(value.tryOn)) {
        throw new Error(`${context} clothing fields are malformed`);
      }
      assertExactKeys(value.tryOn, ["expanded", "gallery"], `${context} tryOn`);
      if (typeof value.tryOn.expanded !== "boolean") {
        throw new Error(`${context} tryOn expanded must be boolean`);
      }
      assertImageCollection(
        value.mainGallery,
        `${context} mainGallery`,
        collectionIds,
        imageIds,
      );
      assertImageCollection(
        value.tryOn.gallery,
        `${context} tryOn gallery`,
        collectionIds,
        imageIds,
      );
      artifactImageCount +=
        value.mainGallery.images.length + value.tryOn.gallery.images.length;
    } else if (value.kind === "prop") {
      assertExactKeys(value, [
        "id",
        "kind",
        "revision",
        "title",
        "gallery",
        "source",
      ], context);
      assertRequiredText(value.title, `${context} title`);
      if (typeof value.source !== "string") {
        throw new Error(`${context} source must be text`);
      }
      assertImageCollection(
        value.gallery,
        `${context} gallery`,
        collectionIds,
        imageIds,
      );
      artifactImageCount += value.gallery.images.length;
    } else {
      throw new Error(`${context} has unsupported kind "${value.kind}"`);
    }
    artifactKinds.set(value.id as string, value.kind);
  });

  if (artifactImageCount > ARTIFACT_IMAGE_LIMIT) {
    throw new Error(
      `Stored plan exceeds the ${ARTIFACT_IMAGE_LIMIT}-artifact-image limit`,
    );
  }

  assertMarkerCorrespondence(
    artifactMarkers.map(({ id }) => id),
    artifactIds,
    "artifact",
  );
  for (const marker of artifactMarkers) {
    if (artifactKinds.get(marker.id) !== marker.kind) {
      throw new Error(
        `Stored artifact marker "${marker.id}" does not match its record kind`,
      );
    }
  }
  return artifacts;
}

function assertPlanHeader(
  value: unknown,
  schemaVersion: number,
  label: string,
): asserts value is Record<string, unknown> & {
  title: string;
  imageGroups: unknown[];
} {
  if (
    !isRecord(value) ||
    value.schemaVersion !== schemaVersion ||
    typeof value.title !== "string" ||
    !value.title.trim() ||
    value.title !== value.title.trim() ||
    !Array.isArray(value.imageGroups)
  ) {
    throw new Error(`Stored plan schema version ${label} is malformed`);
  }
}

function validateLegacyProjectPlanV14(value: unknown): LegacyProjectPlanV14 {
  assertPlanHeader(value, LEGACY_BLOCKNOTE_PLAN_SCHEMA_VERSION, "14");
  const validatedDocument = validateBlockDocumentVersion(
    value.document,
    LEGACY_BLOCK_DOCUMENT_SCHEMA_VERSION,
  );
  const { groups, groupIds } = validateImageGroups(value.imageGroups);
  assertMarkerCorrespondence(
    validatedDocument.imageGroupIds,
    groupIds,
    "image group",
  );
  return {
    schemaVersion: LEGACY_BLOCKNOTE_PLAN_SCHEMA_VERSION,
    title: value.title,
    document: validatedDocument.document as LegacyPreshotBlockDocumentV2,
    imageGroups: groups,
  };
}

export function validateProjectPlanV15(value: unknown): ProjectPlanV15 {
  assertPlanHeader(value, BLOCKNOTE_PLAN_SCHEMA_VERSION, "15");
  if (!Array.isArray(value.artifacts)) {
    throw new Error("Stored plan schema version 15 artifacts are malformed");
  }
  const validatedDocument = validateBlockDocumentVersion(
    value.document,
    BLOCK_DOCUMENT_SCHEMA_VERSION,
  );
  const imageIds = new Set<string>();
  const { groups, groupIds } = validateImageGroups(value.imageGroups, imageIds);
  assertMarkerCorrespondence(
    validatedDocument.imageGroupIds,
    groupIds,
    "image group",
  );
  const artifacts = validateArtifacts(
    value.artifacts,
    validatedDocument.artifactMarkers,
    groupIds,
    imageIds,
  );
  return {
    schemaVersion: BLOCKNOTE_PLAN_SCHEMA_VERSION,
    title: value.title,
    document: validatedDocument.document as PreshotBlockDocument,
    imageGroups: groups,
    artifacts,
  };
}

export function createEmptyBlockDocument(
  context: BlockDocumentContext,
): PreshotBlockDocument {
  return {
    format: "preshot-blocks",
    version: BLOCK_DOCUMENT_SCHEMA_VERSION,
    blocks: [{
      id: context.makeId(),
      type: "paragraph",
      props: {},
      content: [],
      children: [],
    }],
  };
}

export function createEmptyProjectPlanV15(
  title: string,
  context: BlockDocumentContext,
): ProjectPlanV15 {
  return {
    schemaVersion: BLOCKNOTE_PLAN_SCHEMA_VERSION,
    title: title.trim(),
    document: createEmptyBlockDocument(context),
    imageGroups: [],
    artifacts: [],
  };
}

/** @deprecated Use createEmptyProjectPlanV15. */
export const createEmptyProjectPlanV14 = createEmptyProjectPlanV15;
/** @deprecated Use createEmptyProjectPlanV15. */
export const createEmptyProjectPlanV13 = createEmptyProjectPlanV15;

/** @deprecated Use validateProjectPlanV15. Legacy v14 input is validated in place. */
export function validateProjectPlanV14(value: unknown): ProjectPlanV15 {
  return isRecord(value) && value.schemaVersion === 14
    ? validateLegacyProjectPlanV14(value) as unknown as ProjectPlanV15
    : validateProjectPlanV15(value);
}

/** @deprecated Use validateProjectPlanV15. Legacy v13/v14 input is migrated. */
export function validateProjectPlanV13(value: unknown): ProjectPlanV15 {
  if (isRecord(value) && value.schemaVersion === 13) {
    return migrateProjectPlanV13ToV15(value);
  }
  return validateProjectPlanV14(value);
}

export function migrateProjectPlanV13ToV14(
  value: unknown,
): LegacyProjectPlanV14 {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 13 ||
    !isRecord(value.document) ||
    value.document.format !== "preshot-blocks" ||
    value.document.version !== 1
  ) {
    throw new Error("Stored plan schema version 13 is malformed");
  }
  const legacy = value as unknown as LegacyProjectPlanV13;
  return validateLegacyProjectPlanV14({
    ...legacy,
    schemaVersion: LEGACY_BLOCKNOTE_PLAN_SCHEMA_VERSION,
    document: {
      ...legacy.document,
      version: LEGACY_BLOCK_DOCUMENT_SCHEMA_VERSION,
    },
  });
}

function remapDuplicateLegacyImageIds(
  groups: readonly ReferenceComponent[],
): ReferenceComponent[] {
  const reserved = new Set(
    groups.flatMap((group) => group.images.map((image) => image.id)),
  );
  const seen = new Set<string>();
  const nextSuffix = new Map<string, number>();
  let anyChanged = false;
  const remapped = groups.map((group) => {
    let groupChanged = false;
    const images = group.images.map((image) => {
      if (!seen.has(image.id)) {
        seen.add(image.id);
        return image;
      }
      let suffix = nextSuffix.get(image.id) ?? 2;
      let candidate = `${image.id}--v15-${suffix}`;
      while (reserved.has(candidate) || seen.has(candidate)) {
        suffix += 1;
        candidate = `${image.id}--v15-${suffix}`;
      }
      nextSuffix.set(image.id, suffix + 1);
      reserved.add(candidate);
      seen.add(candidate);
      groupChanged = true;
      return { ...image, id: candidate };
    });
    if (!groupChanged) return group;
    anyChanged = true;
    return { ...group, images };
  });
  return anyChanged ? remapped : groups as ReferenceComponent[];
}

export function migrateProjectPlanV14ToV15(value: unknown): ProjectPlanV15 {
  const legacy = validateLegacyProjectPlanV14(value);
  return validateProjectPlanV15({
    schemaVersion: BLOCKNOTE_PLAN_SCHEMA_VERSION,
    title: legacy.title,
    document: {
      ...legacy.document,
      version: BLOCK_DOCUMENT_SCHEMA_VERSION,
    },
    imageGroups: remapDuplicateLegacyImageIds(legacy.imageGroups),
    artifacts: [],
  });
}

export function migrateProjectPlanV13ToV15(value: unknown): ProjectPlanV15 {
  return migrateProjectPlanV14ToV15(migrateProjectPlanV13ToV14(value));
}
