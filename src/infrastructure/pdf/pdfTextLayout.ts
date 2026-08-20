import type { Block, Run } from "./htmlToBlocks";
import type { ReferenceComponent } from "../../domain/plan/canvas/models";
import { contentSize, DEFAULT_PAGE_GEOMETRY } from "../../domain/plan/canvas/geometry";
import {
  DOCUMENT_IMAGE_GROUP_INSET,
  layoutDocumentImageGroupForWidth,
} from "../../domain/plan/canvas/documentImageGroupLayout";

export const PDF_BODY_SIZE = 11;
export const PDF_H1_SIZE = 16;
export const PDF_H2_SIZE = 13;
export const PDF_LINE_HEIGHT = 1.35;
export const PDF_PARAGRAPH_GAP = 6;
export const PDF_LIST_INDENT = 16;
export const PDF_COLUMN_GAP = 10;

export interface PdfTextMetricFont {
  widthOfTextAtSize(text: string, size: number): number;
}

export interface PdfTextFonts<Font extends PdfTextMetricFont> {
  regular: Font;
  bold: Font;
}

export interface PdfTextCommand<Font extends PdfTextMetricFont> {
  text: string;
  font: Font;
  size: number;
  x: number;
  baselineFromTop: number;
  isSpace: boolean;
  link?: string;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  keepTogetherGroup?: string;
}

export interface PdfImageCommand {
  src: string;
  x: number;
  topFromTop: number;
  width: number;
  height: number;
  crop?: { x: number; y: number; width: number; height: number };
  keepTogetherGroup?: string;
}

export interface PdfKeepTogetherGroup {
  id: string;
  topFromTop: number;
  height: number;
}

export interface PdfRichTextLayoutOptions {
  imageGroups?: ReadonlyMap<string, ReferenceComponent>;
}

export interface PdfTextLayout<Font extends PdfTextMetricFont> {
  height: number;
  commands: PdfTextCommand<Font>[];
  images: PdfImageCommand[];
  keepTogetherGroups: PdfKeepTogetherGroup[];
}

export interface PaginatedPdfTextCommand<Font extends PdfTextMetricFont>
  extends PdfTextCommand<Font> {
  pageIndex: number;
  baselineFromPageTop: number;
}

export interface PaginatedPdfTextLayout<Font extends PdfTextMetricFont> {
  height: number;
  commands: PaginatedPdfTextCommand<Font>[];
  images: (PdfImageCommand & {
    pageIndex: number;
    topFromPageTop: number;
  })[];
}

interface Token<Font extends PdfTextMetricFont> {
  text: string;
  font: Font;
  size: number;
  isSpace: boolean;
  link?: string;
  underline?: boolean;
  strike?: boolean;
  color?: string;
}

function isCjk(ch: string): boolean {
  const codePoint = ch.codePointAt(0) ?? 0;
  return (
    (codePoint >= 0x3000 && codePoint <= 0x9fff) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7af) ||
    (codePoint >= 0xff00 && codePoint <= 0xffef) ||
    (codePoint >= 0x20000 && codePoint <= 0x2ffff)
  );
}

function tokenizeRun<Font extends PdfTextMetricFont>(
  run: Run,
  font: Font,
  size: number,
): Token<Font>[] {
  const tokens: Token<Font>[] = [];
  let word = "";
  const flush = () => {
    if (!word) {
      return;
    }
    tokens.push({
      text: word,
      font,
      size,
      isSpace: false,
      link: run.link,
      underline: run.underline,
      strike: run.strike,
      color: run.color,
    });
    word = "";
  };

  for (const ch of run.text) {
    if (ch === " " || ch === "\n" || ch === "\t") {
      flush();
      tokens.push({ text: " ", font, size, isSpace: true });
    } else if (isCjk(ch)) {
      flush();
      tokens.push({
        text: ch,
        font,
        size,
        isSpace: false,
        link: run.link,
        underline: run.underline,
        strike: run.strike,
        color: run.color,
      });
    } else {
      word += ch;
    }
  }
  flush();
  return tokens;
}

export function layoutPdfRichText<Font extends PdfTextMetricFont>(
  blocks: Block[],
  width: number,
  fonts: PdfTextFonts<Font>,
  options: PdfRichTextLayoutOptions = {},
): PdfTextLayout<Font> {
  const commands: PdfTextCommand<Font>[] = [];
  const images: PdfImageCommand[] = [];
  const keepTogetherGroups: PdfKeepTogetherGroup[] = [];
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 0;
  let cursorFromTop = 0;

  const layoutRuns = (
    runs: Run[],
    defaultSize: number,
    boldDefault: boolean,
    indent = 0,
  ) => {
    const maxWidth = Math.max(0, safeWidth - indent);
    const tokens = runs.flatMap((run) =>
      tokenizeRun(
        run,
        run.bold || boldDefault ? fonts.bold : fonts.regular,
        run.size ?? defaultSize,
      ),
    );
    let line: Token<Font>[] = [];
    let lineWidth = 0;

    const flushLine = () => {
      if (line.length === 0) {
        return;
      }

      const lineSize = line.reduce(
        (largest, token) => Math.max(largest, token.size),
        defaultSize,
      );
      const baselineFromTop = cursorFromTop + lineSize;
      let x = indent;
      for (const token of line) {
        commands.push({
          ...token,
          x,
          baselineFromTop,
        });
        x += token.font.widthOfTextAtSize(token.text, token.size);
      }

      cursorFromTop += lineSize * PDF_LINE_HEIGHT;
      line = [];
      lineWidth = 0;
    };

    for (const token of tokens) {
      const tokenWidth = token.font.widthOfTextAtSize(token.text, token.size);
      if (!token.isSpace && line.length > 0 && lineWidth + tokenWidth > maxWidth) {
        flushLine();
      }
      if (token.isSpace && line.length === 0) {
        continue;
      }
      line.push(token);
      lineWidth += tokenWidth;
    }
    flushLine();
  };

  for (const block of blocks) {
    if (block.type === "columns") {
      const columnCount = block.columns.length;
      if (columnCount === 0) continue;
      const availableWidth = Math.max(
        0,
        safeWidth - PDF_COLUMN_GAP * (columnCount - 1),
      );
      const totalWeight = block.columns.reduce(
        (total, column) =>
          total + (
            Number.isFinite(column.weight) && column.weight > 0
              ? column.weight
              : 1
          ),
        0,
      );
      const layouts = block.columns.map((column) =>
        layoutPdfRichText(
          column.blocks,
          availableWidth * column.weight / totalWeight,
          fonts,
          options,
        ),
      );
      const rowHeight = Math.max(0, ...layouts.map((layout) => layout.height));
      const keepTogetherGroup =
        `columns-${keepTogetherGroups.length}-${cursorFromTop}`;
      let xOffset = 0;
      for (let index = 0; index < layouts.length; index += 1) {
        const layout = layouts[index];
        commands.push(...layout.commands.map((command) => ({
          ...command,
          x: command.x + xOffset,
          baselineFromTop: command.baselineFromTop + cursorFromTop,
          keepTogetherGroup,
        })));
        images.push(...layout.images.map((image) => ({
          ...image,
          x: image.x + xOffset,
          topFromTop: image.topFromTop + cursorFromTop,
          keepTogetherGroup,
        })));
        const weight = block.columns[index].weight;
        xOffset +=
          availableWidth * weight / totalWeight +
          PDF_COLUMN_GAP;
      }
      keepTogetherGroups.push({
        id: keepTogetherGroup,
        topFromTop: cursorFromTop,
        height: rowHeight,
      });
      cursorFromTop += rowHeight;
      cursorFromTop += PDF_PARAGRAPH_GAP;
    } else if (block.type === "heading") {
      cursorFromTop += PDF_PARAGRAPH_GAP;
      layoutRuns(
        block.runs,
        block.level === 1 ? PDF_H1_SIZE : PDF_H2_SIZE,
        true,
      );
      cursorFromTop += PDF_PARAGRAPH_GAP / 2;
    } else if (block.type === "paragraph") {
      layoutRuns(block.runs, PDF_BODY_SIZE, false);
      cursorFromTop += PDF_PARAGRAPH_GAP;
    } else if (block.type === "image") {
      const naturalWidth = block.width ?? safeWidth;
      const naturalHeight = block.height ?? naturalWidth * 0.75;
      const width = Math.min(safeWidth, naturalWidth);
      const height = naturalWidth > 0 ? width * naturalHeight / naturalWidth : 0;
      images.push({
        src: block.src,
        x: 0,
        topFromTop: cursorFromTop,
        width,
        height,
      });
      cursorFromTop += height + PDF_PARAGRAPH_GAP;
    } else if (block.type === "imageGroup") {
      const group = options.imageGroups?.get(block.groupId);
      if (!group || group.images.length === 0) {
        continue;
      }
      const documentWidth = contentSize(DEFAULT_PAGE_GEOMETRY).width;
      const pdfScale = safeWidth / documentWidth;
      const groupWidth = Math.min(documentWidth, Math.max(1, group.width));
      const groupOffsetY = group.frameOffsetY ?? 0;
      const groupX = Math.max(0, Math.min(group.x, documentWidth - groupWidth));
      const layout = layoutDocumentImageGroupForWidth(
        group.images,
        groupWidth,
      );
      const groupHeight = Math.max(1, group.height, layout.height);
      const imagesById = new Map(group.images.map((image) => [image.id, image]));
      for (const slot of layout.slots) {
        const source = imagesById.get(slot.id);
        if (!source) continue;
        images.push({
          src: source.file,
          x: (groupX + DOCUMENT_IMAGE_GROUP_INSET + slot.x) * pdfScale,
          topFromTop:
            cursorFromTop +
            (groupOffsetY + DOCUMENT_IMAGE_GROUP_INSET + slot.y) * pdfScale,
          width: slot.width * pdfScale,
          height: slot.height * pdfScale,
          ...(source.crop ? { crop: source.crop } : {}),
        });
      }
      cursorFromTop +=
        (groupHeight + groupOffsetY) * pdfScale +
        PDF_PARAGRAPH_GAP;
    } else {
      block.items.forEach((item, index) => {
        commands.push({
          text: block.ordered ? `${index + 1}. ` : "• ",
          font: fonts.regular,
          size: PDF_BODY_SIZE,
          x: 0,
          baselineFromTop: cursorFromTop + PDF_BODY_SIZE,
          isSpace: false,
        });
        layoutRuns(item, PDF_BODY_SIZE, false, PDF_LIST_INDENT);
      });
      cursorFromTop += PDF_PARAGRAPH_GAP;
    }
  }

  return { height: cursorFromTop, commands, images, keepTogetherGroups };
}

export function paginatePdfTextLayout<Font extends PdfTextMetricFont>(
  layout: PdfTextLayout<Font>,
  input: {
    textStartFromDocumentTop: number;
    pageHeight: number;
    pageMargin: number;
  },
): PaginatedPdfTextLayout<Font> {
  const { pageHeight, pageMargin, textStartFromDocumentTop } = input;
  if (
    !Number.isFinite(pageHeight) ||
    pageHeight <= 0 ||
    !Number.isFinite(pageMargin) ||
    pageMargin < 0 ||
    !Number.isFinite(textStartFromDocumentTop)
  ) {
    return {
      height: layout.height,
      commands: layout.commands.map((command) => ({
        ...command,
        pageIndex: 0,
        baselineFromPageTop: command.baselineFromTop,
      })),
      images: layout.images.map((image) => ({
        ...image,
        pageIndex: 0,
        topFromPageTop: image.topFromTop,
      })),
    };
  }

  const commandsByBaseline = new Map<number, PdfTextCommand<Font>[]>();
  for (const command of layout.commands) {
    if (command.keepTogetherGroup) continue;
    const commands = commandsByBaseline.get(command.baselineFromTop) ?? [];
    commands.push(command);
    commandsByBaseline.set(command.baselineFromTop, commands);
  }

  const groupedCommandIds = new Set(
    layout.commands.flatMap((command) =>
      command.keepTogetherGroup ? [command.keepTogetherGroup] : []),
  );
  const groupedImageIds = new Set(
    layout.images.flatMap((image) =>
      image.keepTogetherGroup ? [image.keepTogetherGroup] : []),
  );
  const items = [
    ...Array.from(commandsByBaseline, ([baselineFromTop, lineCommands]) => {
      const lineSize = lineCommands.reduce(
        (largest, command) => Math.max(largest, command.size),
        0,
      );
      return {
        kind: "text" as const,
        topFromTop: baselineFromTop - lineSize,
        height: lineSize * PDF_LINE_HEIGHT,
        lineCommands,
      };
    }),
    ...layout.images
      .filter((image) => !image.keepTogetherGroup)
      .map((image) => ({
      kind: "image" as const,
      topFromTop: image.topFromTop,
      height: image.height,
      image,
    })),
    ...layout.keepTogetherGroups
      .filter((group) =>
        groupedCommandIds.has(group.id) || groupedImageIds.has(group.id))
      .map((group) => ({
        kind: "group" as const,
        topFromTop: group.topFromTop,
        height: group.height,
        commands: layout.commands.filter(
          (command) => command.keepTogetherGroup === group.id,
        ),
        images: layout.images.filter(
          (image) => image.keepTogetherGroup === group.id,
        ),
      })),
  ].sort((first, second) => first.topFromTop - second.topFromTop);

  const paginatedCommands: PaginatedPdfTextCommand<Font>[] = [];
  const paginatedImages: PaginatedPdfTextLayout<Font>["images"] = [];
  let accumulatedSpacer = 0;
  const pageContentHeight = Math.max(0, pageHeight - pageMargin * 2);

  for (const item of items) {
    let itemTopInDocument =
      textStartFromDocumentTop + item.topFromTop + accumulatedSpacer;
    let pageIndex = Math.max(0, Math.floor(itemTopInDocument / pageHeight));
    let contentStart = pageIndex * pageHeight + pageMargin;
    let contentEnd = (pageIndex + 1) * pageHeight - pageMargin;

    if (itemTopInDocument < contentStart) {
      accumulatedSpacer += contentStart - itemTopInDocument;
      itemTopInDocument = contentStart;
    }

    if (
      item.height <= pageContentHeight &&
      itemTopInDocument + item.height > contentEnd + 0.01
    ) {
      const nextContentStart = (pageIndex + 1) * pageHeight + pageMargin;
      accumulatedSpacer += nextContentStart - itemTopInDocument;
      itemTopInDocument = nextContentStart;
      pageIndex += 1;
      contentStart = pageIndex * pageHeight + pageMargin;
      contentEnd = (pageIndex + 1) * pageHeight - pageMargin;
    }

    if (item.kind === "group") {
      for (const command of item.commands) {
        const baselineInDocument =
          itemTopInDocument +
          command.baselineFromTop -
          item.topFromTop;
        paginatedCommands.push({
          ...command,
          pageIndex,
          baselineFromPageTop:
            baselineInDocument - pageIndex * pageHeight,
        });
      }
      for (const image of item.images) {
        const topInDocument =
          itemTopInDocument + image.topFromTop - item.topFromTop;
        paginatedImages.push({
          ...image,
          pageIndex,
          topFromPageTop: topInDocument - pageIndex * pageHeight,
        });
      }
    } else if (item.kind === "image") {
      paginatedImages.push({
        ...item.image,
        pageIndex,
        topFromPageTop: itemTopInDocument - pageIndex * pageHeight,
      });
    } else {
      for (const command of item.lineCommands) {
        const baselineInDocument =
          textStartFromDocumentTop +
          command.baselineFromTop +
          accumulatedSpacer;
        const commandPageIndex = Math.max(
          0,
          Math.floor(baselineInDocument / pageHeight),
        );
        paginatedCommands.push({
          ...command,
          pageIndex: commandPageIndex,
          baselineFromPageTop:
            baselineInDocument - commandPageIndex * pageHeight,
        });
      }
    }
  }

  return {
    height: layout.height + accumulatedSpacer,
    commands: paginatedCommands,
    images: paginatedImages,
  };
}
