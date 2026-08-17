import type { ReferenceComponent } from "./models";

export const BLOCK_DOCUMENT_SCHEMA_VERSION = 1 as const;
export const BLOCKNOTE_PLAN_SCHEMA_VERSION = 13 as const;

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

export const PRESHOT_BLOCK_TYPES = [
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
  "imageGroup",
] as const;

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

export interface ProjectPlanV13 {
  schemaVersion: typeof BLOCKNOTE_PLAN_SCHEMA_VERSION;
  title: string;
  document: PreshotBlockDocument;
  imageGroups: ReferenceComponent[];
}

export interface BlockDocumentContext {
  makeId(): string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function assertBlock(
  value: unknown,
  context: string,
  blockIds: Set<string>,
  imageGroupIds: string[],
  topLevel: boolean,
): asserts value is PreshotBlock {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.type !== "string" ||
    !(PRESHOT_BLOCK_TYPES as readonly string[]).includes(value.type) ||
    !Array.isArray(value.children)
  ) {
    throw new Error(`${context} is an invalid block`);
  }
  if (blockIds.has(value.id)) {
    throw new Error(`Stored block id "${value.id}" must be unique`);
  }
  blockIds.add(value.id);
  assertPrimitiveRecord(value.props, context);

  if (value.type === "imageGroup") {
    if (!topLevel) {
      throw new Error(`Image group block "${value.id}" must be top-level`);
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
  } else if (value.type === "table") {
    assertTableContent(value.content, `${context} table`);
  } else if (value.type === "divider") {
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
      false,
    ),
  );
}

export function validateBlockDocument(value: unknown): PreshotBlockDocument {
  if (
    !isRecord(value) ||
    value.format !== "preshot-blocks" ||
    value.version !== BLOCK_DOCUMENT_SCHEMA_VERSION ||
    !Array.isArray(value.blocks)
  ) {
    throw new Error("Stored BlockNote document is malformed or unsupported");
  }
  const blockIds = new Set<string>();
  const imageGroupIds: string[] = [];
  value.blocks.forEach((block, index) =>
    assertBlock(
      block,
      `Stored document block ${index}`,
      blockIds,
      imageGroupIds,
      true,
    ),
  );
  return value as unknown as PreshotBlockDocument;
}

export function imageGroupIdsInBlockDocument(
  document: PreshotBlockDocument,
): string[] {
  return document.blocks
    .filter((block) => block.type === "imageGroup")
    .map((block) => String(block.props.groupId));
}

export function validateProjectPlanV13(value: unknown): ProjectPlanV13 {
  if (
    !isRecord(value) ||
    value.schemaVersion !== BLOCKNOTE_PLAN_SCHEMA_VERSION ||
    typeof value.title !== "string" ||
    !value.title.trim() ||
    value.title !== value.title.trim() ||
    !Array.isArray(value.imageGroups)
  ) {
    throw new Error("Stored plan schema version 13 is malformed");
  }
  const document = validateBlockDocument(value.document);
  const groups = value.imageGroups as ReferenceComponent[];
  const groupIds = new Set<string>();
  for (const [index, group] of groups.entries()) {
    if (
      !isRecord(group) ||
      group.type !== "reference" ||
      typeof group.id !== "string" ||
      !group.id
    ) {
      throw new Error(`Stored image group ${index} is malformed`);
    }
    if (groupIds.has(group.id)) {
      throw new Error(`Stored image group id "${group.id}" must be unique`);
    }
    groupIds.add(group.id);
  }
  const markerIds = imageGroupIdsInBlockDocument(document);
  const markerCounts = new Map<string, number>();
  markerIds.forEach((id) =>
    markerCounts.set(id, (markerCounts.get(id) ?? 0) + 1),
  );
  for (const [id, count] of markerCounts) {
    if (!groupIds.has(id)) {
      throw new Error(`Stored document references missing image group "${id}"`);
    }
    if (count !== 1) {
      throw new Error(`Stored document references image group "${id}" ${count} times`);
    }
  }
  for (const id of groupIds) {
    if (markerCounts.get(id) !== 1) {
      throw new Error(`Stored image group "${id}" must appear exactly once`);
    }
  }
  return {
    schemaVersion: BLOCKNOTE_PLAN_SCHEMA_VERSION,
    title: value.title,
    document,
    imageGroups: groups,
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

export function createEmptyProjectPlanV13(
  title: string,
  context: BlockDocumentContext,
): ProjectPlanV13 {
  return {
    schemaVersion: BLOCKNOTE_PLAN_SCHEMA_VERSION,
    title: title.trim(),
    document: createEmptyBlockDocument(context),
    imageGroups: [],
  };
}
