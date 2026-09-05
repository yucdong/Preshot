import type {
  BlockInlineContent,
  PreshotBlock,
  PreshotBlockDocument,
} from "../../domain/plan/canvas/blockDocument";
import type { Block, Run } from "./htmlToBlocks";

function runsOf(content: BlockInlineContent[]): Run[] {
  return content.flatMap((entry): Run[] => {
    if (entry.type === "link") {
      return entry.content.map((text) => ({
        text: text.text,
        link: entry.href,
        ...(text.styles.bold === true ? { bold: true } : {}),
        ...(text.styles.italic === true ? { italic: true } : {}),
        ...(text.styles.underline === true ? { underline: true } : {}),
        ...(text.styles.strike === true ? { strike: true } : {}),
        ...(typeof text.styles.textColor === "string"
          ? { color: text.styles.textColor }
          : {}),
      }));
    }
    return [{
      text: entry.text,
      ...(entry.styles.bold === true ? { bold: true } : {}),
      ...(entry.styles.italic === true ? { italic: true } : {}),
      ...(entry.styles.underline === true ? { underline: true } : {}),
      ...(entry.styles.strike === true ? { strike: true } : {}),
      ...(typeof entry.styles.textColor === "string"
        ? { color: entry.styles.textColor }
        : {}),
    }];
  });
}

function plainText(content: BlockInlineContent[]): string {
  return content.flatMap((entry) =>
    entry.type === "link"
      ? entry.content.map((text) => text.text)
      : [entry.text],
  ).join("");
}

function convertBlock(block: PreshotBlock): Block[] {
  const children = block.children.flatMap(convertBlock);
  if (block.type === "image") {
    const url = String(block.props.url ?? "");
    if (!url) return children;
    if (/^media\/[^/\\]+$/i.test(url)) {
      return [{
        type: "image",
        src: url,
        alt: String(block.props.caption || block.props.name || ""),
        ...(typeof block.props.previewWidth === "number"
          ? { width: block.props.previewWidth }
          : {}),
      }, ...children];
    }
    return [{
      type: "paragraph",
      runs: [{
        text: String(block.props.caption || block.props.name || "图片"),
        ...(url ? { link: url } : {}),
      }],
    }, ...children];
  }
  if (block.type === "video" || block.type === "audio") {
    const url = String(block.props.url ?? "");
    const label = block.type === "video" ? "视频" : "音频";
    const name = String(block.props.caption || block.props.name || label);
    return [{
      type: "paragraph",
      runs: [{
        text: `[${label}] ${name}`,
        ...(/^https?:\/\//i.test(url) ? { link: url } : {}),
      }],
    }, ...children];
  }
  if (block.type === "imageGroup") {
    return [
      { type: "imageGroup", groupId: String(block.props.groupId) },
      ...children,
    ];
  }
  if (block.type === "divider") {
    return [{ type: "paragraph", runs: [{ text: "────────" }] }, ...children];
  }
  const tableContent = block.content;
  if (
    block.type === "table" &&
    tableContent !== undefined &&
    !Array.isArray(tableContent) &&
    tableContent.type === "tableContent"
  ) {
    return [
      ...tableContent.rows.map((row) => ({
        type: "paragraph" as const,
        runs: row.cells.flatMap((cell, index) => [
          ...(index > 0 ? [{ text: " | " }] : []),
          ...runsOf(cell),
        ]),
      })),
      ...children,
    ];
  }
  const content = Array.isArray(block.content) ? block.content : [];
  if (block.type === "heading") {
    const level = Number(block.props.level);
    return [
      {
        type: "heading",
        level: level === 1 ? 1 : 2,
        runs: runsOf(content),
      },
      ...children,
    ];
  }
  if (
    block.type === "bulletListItem" ||
    block.type === "numberedListItem" ||
    block.type === "checkListItem" ||
    block.type === "toggleListItem"
  ) {
    const prefix = block.type === "checkListItem"
      ? block.props.checked === true ? "☑ " : "☐ "
      : "";
    return [
      {
        type: "list",
        ordered: block.type === "numberedListItem",
        items: [[
          ...(prefix ? [{ text: prefix }] : []),
          ...runsOf(content),
        ]],
      },
      ...children,
    ];
  }
  if (block.type === "codeBlock") {
    return [
      { type: "paragraph", runs: [{ text: plainText(content) }] },
      ...children,
    ];
  }
  if (block.type === "quote") {
    return [
      { type: "paragraph", runs: [{ text: "“" }, ...runsOf(content), { text: "”" }] },
      ...children,
    ];
  }
  return [{ type: "paragraph", runs: runsOf(content) }, ...children];
}

export function blockDocumentToPdfBlocks(
  document: PreshotBlockDocument,
): Block[] {
  return document.blocks.flatMap(convertBlock);
}
