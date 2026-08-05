import type { Block, Run } from "./htmlToBlocks";

export const PDF_BODY_SIZE = 11;
export const PDF_H1_SIZE = 16;
export const PDF_H2_SIZE = 13;
export const PDF_LINE_HEIGHT = 1.35;
export const PDF_PARAGRAPH_GAP = 6;
export const PDF_LIST_INDENT = 16;

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
}

export interface PdfTextLayout<Font extends PdfTextMetricFont> {
  height: number;
  commands: PdfTextCommand<Font>[];
}

export interface PaginatedPdfTextCommand<Font extends PdfTextMetricFont>
  extends PdfTextCommand<Font> {
  pageIndex: number;
  baselineFromPageTop: number;
}

export interface PaginatedPdfTextLayout<Font extends PdfTextMetricFont> {
  height: number;
  commands: PaginatedPdfTextCommand<Font>[];
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
): PdfTextLayout<Font> {
  const commands: PdfTextCommand<Font>[] = [];
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
    if (block.type === "heading") {
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

  return { height: cursorFromTop, commands };
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
    };
  }

  const commandsByBaseline = new Map<number, PdfTextCommand<Font>[]>();
  for (const command of layout.commands) {
    const commands = commandsByBaseline.get(command.baselineFromTop) ?? [];
    commands.push(command);
    commandsByBaseline.set(command.baselineFromTop, commands);
  }

  const paginatedCommands: PaginatedPdfTextCommand<Font>[] = [];
  let accumulatedSpacer = 0;
  const pageContentHeight = Math.max(0, pageHeight - pageMargin * 2);

  for (const [baselineFromTop, lineCommands] of commandsByBaseline) {
    const lineSize = lineCommands.reduce(
      (largest, command) => Math.max(largest, command.size),
      0,
    );
    const lineTop = baselineFromTop - lineSize;
    const lineHeight = lineSize * PDF_LINE_HEIGHT;
    let lineTopInDocument =
      textStartFromDocumentTop + lineTop + accumulatedSpacer;
    let pageIndex = Math.max(0, Math.floor(lineTopInDocument / pageHeight));
    let contentStart = pageIndex * pageHeight + pageMargin;
    let contentEnd = (pageIndex + 1) * pageHeight - pageMargin;

    if (lineTopInDocument < contentStart) {
      accumulatedSpacer += contentStart - lineTopInDocument;
      lineTopInDocument = contentStart;
    }

    if (
      lineHeight <= pageContentHeight &&
      lineTopInDocument + lineHeight > contentEnd + 0.01
    ) {
      const nextContentStart = (pageIndex + 1) * pageHeight + pageMargin;
      accumulatedSpacer += nextContentStart - lineTopInDocument;
      lineTopInDocument = nextContentStart;
      pageIndex += 1;
      contentStart = pageIndex * pageHeight + pageMargin;
      contentEnd = (pageIndex + 1) * pageHeight - pageMargin;
    }

    for (const command of lineCommands) {
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

  return {
    height: layout.height + accumulatedSpacer,
    commands: paginatedCommands,
  };
}
