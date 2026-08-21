import type {
  PreshotBlockDocument,
  PreshotBlock,
} from "../../../domain/plan/canvas/blockDocument";
import type { PreshotEditorPartialBlock } from "./preshotBlockNoteSchema";

const NATIVE_MEDIA_TYPES = new Set([
  "audio",
  "file",
  "image",
  "video",
]);

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
