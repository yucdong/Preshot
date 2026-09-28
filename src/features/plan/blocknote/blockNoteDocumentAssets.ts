import {
  BLOCK_DOCUMENT_SCHEMA_VERSION,
  validateBlockDocument,
  type PreshotBlockDocument,
  type PreshotBlock,
} from "../../../domain/plan/canvas/blockDocument";
import type { PreshotEditorPartialBlock } from "./preshotBlockNoteSchema";

const NATIVE_MEDIA_TYPES = new Set([
  "audio",
  "file",
  "image",
  "video",
]);

interface SerializableEditorBlock {
  id?: string;
  type: string;
  props: Record<string, unknown>;
  children: SerializableEditorBlock[];
}

export function serializeBlockNoteDocumentAssets(
  blocks: unknown,
  persistMediaUrl: (url: string, blockId?: string) => string,
): PreshotBlockDocument {
  const jsonSafeBlocks = JSON.parse(JSON.stringify(blocks)) as SerializableEditorBlock[];
  const normalize = (block: SerializableEditorBlock) => {
    if (NATIVE_MEDIA_TYPES.has(block.type) && typeof block.props.url === "string") {
      block.props.url = persistMediaUrl(block.props.url, block.id);
    }
    block.children.forEach(normalize);
  };
  jsonSafeBlocks.forEach(normalize);
  return validateBlockDocument({
    format: "preshot-blocks",
    version: BLOCK_DOCUMENT_SCHEMA_VERSION,
    blocks: jsonSafeBlocks,
  });
}

function resolveBlock(
  block: PreshotBlock,
  resolveMediaUrl: (url: string) => string,
): unknown {
  const content = block.content;
  const normalizedContent =
    block.type !== "table" ||
      content === undefined ||
      Array.isArray(content) ||
      content.type !== "tableContent"
      ? content
      : {
          ...content,
          columnWidths: content.columnWidths.map((width) =>
            width === null ? undefined : width),
        };
  const url = block.props.url;
  return {
    ...block,
    props:
      NATIVE_MEDIA_TYPES.has(block.type) && typeof url === "string"
        ? { ...block.props, url: resolveMediaUrl(url) }
        : block.props,
    content: normalizedContent,
    children: block.children.map((child) =>
      resolveBlock(child, resolveMediaUrl)),
  };
}

export function resolveBlockNoteDocumentAssets(
  document: PreshotBlockDocument,
  resolveMediaUrl: (url: string) => string,
): PreshotEditorPartialBlock[] {
  return structuredClone(document.blocks)
    .map((block) => resolveBlock(block, resolveMediaUrl)) as
      PreshotEditorPartialBlock[];
}
