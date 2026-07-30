import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { A4, contentBox, containSize, MARGIN, squareSlotGrid } from "../../domain/plan/pdf/geometry";
import type { PdfExportDocument } from "../../domain/plan/pdf/document";
import type { PdfExporter } from "../../domain/plan/pdf/ports";
import { parseHtmlToBlocks, type Block, type Run } from "./htmlToBlocks";

const TITLE_SIZE = 18;
const H1_SIZE = 18;
const H2_SIZE = 14;
const BODY_SIZE = 11;
const LINE = 1.35;
const PARA_GAP = 6;
const LIST_INDENT = 16;
const GRID_GAP = 12;
const TEXT_COLOR = rgb(0.11, 0.1, 0.09);
const LINK_COLOR = rgb(0.15, 0.39, 0.92);
const FRAME_COLOR = rgb(0.85, 0.85, 0.85);

type Rgb = ReturnType<typeof rgb>;

interface Fonts {
  regular: Uint8Array;
  bold: Uint8Array;
}

interface Token {
  text: string;
  font: PDFFont;
  size: number;
  isSpace: boolean;
  link?: string;
  underline?: boolean;
  strike?: boolean;
  color?: Rgb;
}

function isCjk(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (c >= 0x3000 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af) || (c >= 0xff00 && c <= 0xffef) || (c >= 0x20000 && c <= 0x2ffff);
}

function parseColor(value: string): Rgb | undefined {
  const v = value.trim();
  const hex6 = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex6) {
    const n = Number.parseInt(hex6[1], 16);
    return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }
  const hex3 = /^#([0-9a-f]{3})$/i.exec(v);
  if (hex3) {
    const r = Number.parseInt(hex3[1][0] + hex3[1][0], 16);
    const g = Number.parseInt(hex3[1][1] + hex3[1][1], 16);
    const b = Number.parseInt(hex3[1][2] + hex3[1][2], 16);
    return rgb(r / 255, g / 255, b / 255);
  }
  const rgbMatch = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(v);
  if (rgbMatch) {
    return rgb(Number(rgbMatch[1]) / 255, Number(rgbMatch[2]) / 255, Number(rgbMatch[3]) / 255);
  }
  return undefined;
}

function tokenizeRun(run: Run, font: PDFFont, size: number): Token[] {
  const color = run.color ? parseColor(run.color) : undefined;
  const tokens: Token[] = [];
  let word = "";
  const flush = () => {
    if (word) {
      tokens.push({ text: word, font, size, isSpace: false, link: run.link, underline: run.underline, strike: run.strike, color });
      word = "";
    }
  };
  for (const ch of run.text) {
    if (ch === " " || ch === "\n" || ch === "\t") {
      flush();
      tokens.push({ text: " ", font, size, isSpace: true });
    } else if (isCjk(ch)) {
      flush();
      tokens.push({ text: ch, font, size, isSpace: false, link: run.link, underline: run.underline, strike: run.strike, color });
    } else {
      word += ch;
    }
  }
  flush();
  return tokens;
}

function dataUrlToBytes(dataUrl: string): { mime: string; bytes: Uint8Array } {
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!match) throw new Error("Unsupported image data URL");
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return { mime: match[1], bytes };
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

export function createPdfLibExporter(loadFonts: () => Promise<Fonts>): PdfExporter {
  return {
    async export(document: PdfExportDocument, images: Record<string, string>): Promise<Uint8Array> {
      const pdf = await PDFDocument.create();
      pdf.registerFontkit(fontkit);
      const fonts = await loadFonts();
      const regular = await pdf.embedFont(fonts.regular, { subset: true });
      const bold = await pdf.embedFont(fonts.bold, { subset: true });
      const box = contentBox();
      const embedded = new Map<string, PDFImage>();

      let page: PDFPage = pdf.addPage([A4.width, A4.height]);
      let cursorY = A4.height - MARGIN;

      const newPage = () => {
        page = pdf.addPage([A4.width, A4.height]);
        cursorY = A4.height - MARGIN;
      };
      const ensure = (height: number) => {
        if (cursorY - height < MARGIN) newPage();
      };

      const drawRuns = (runs: Run[], defaultSize: number, boldDefault: boolean, indent = 0) => {
        const maxWidth = box.width - indent;
        const tokens = runs.flatMap((run) => tokenizeRun(run, run.bold || boldDefault ? bold : regular, run.size ?? defaultSize));
        let line: Token[] = [];
        let width = 0;
        const flushLine = () => {
          const lineSize = line.reduce((max, t) => Math.max(max, t.size), defaultSize);
          const lineHeight = lineSize * LINE;
          ensure(lineHeight);
          let x = box.x + indent;
          const baseline = cursorY - lineSize;
          for (const t of line) {
            const w = t.font.widthOfTextAtSize(t.text, t.size);
            const color = t.link ? LINK_COLOR : t.color ?? TEXT_COLOR;
            page.drawText(t.text, { x, y: baseline, size: t.size, font: t.font, color });
            if (!t.isSpace) {
              if (t.link || t.underline) {
                page.drawLine({ start: { x, y: baseline - 1.5 }, end: { x: x + w, y: baseline - 1.5 }, thickness: 0.5, color });
              }
              if (t.strike) {
                page.drawLine({ start: { x, y: baseline + t.size * 0.3 }, end: { x: x + w, y: baseline + t.size * 0.3 }, thickness: 0.5, color });
              }
            }
            x += w;
          }
          cursorY -= lineHeight;
          line = [];
          width = 0;
        };
        for (const t of tokens) {
          const w = t.font.widthOfTextAtSize(t.text, t.size);
          if (!t.isSpace && width + w > maxWidth && line.length > 0) flushLine();
          if (t.isSpace && line.length === 0) continue;
          line.push(t);
          width += w;
        }
        if (line.length > 0) flushLine();
      };

      const drawBlocks = (blocks: Block[]) => {
        for (const block of blocks) {
          if (block.type === "heading") {
            cursorY -= PARA_GAP;
            drawRuns(block.runs, block.level === 1 ? H1_SIZE : H2_SIZE, true);
            cursorY -= PARA_GAP / 2;
          } else if (block.type === "paragraph") {
            drawRuns(block.runs, BODY_SIZE, false);
            cursorY -= PARA_GAP;
          } else {
            block.items.forEach((item, index) => {
              const marker = block.ordered ? `${index + 1}. ` : "• ";
              ensure(BODY_SIZE * LINE);
              page.drawText(marker, { x: box.x, y: cursorY - BODY_SIZE, size: BODY_SIZE, font: regular, color: TEXT_COLOR });
              drawRuns(item, BODY_SIZE, false, LIST_INDENT);
            });
            cursorY -= PARA_GAP;
          }
        }
      };

      const embed = async (dataUrl: string): Promise<PDFImage> => {
        const { mime, bytes } = dataUrlToBytes(dataUrl);
        return mime.includes("png") ? pdf.embedPng(bytes) : pdf.embedJpg(bytes);
      };

      const drawGrid = async (columns: number, files: string[]) => {
        const grid = squareSlotGrid(box.width, columns, GRID_GAP);
        for (const rowFiles of chunk(files, columns)) {
          ensure(grid.slotSize + GRID_GAP);
          const rowTop = cursorY;
          for (let i = 0; i < rowFiles.length; i += 1) {
            const slotX = box.x + grid.xOffsets[i];
            const slotBottomY = rowTop - grid.slotSize;
            page.drawRectangle({
              x: slotX,
              y: slotBottomY,
              width: grid.slotSize,
              height: grid.slotSize,
              borderColor: FRAME_COLOR,
              borderWidth: 0.75,
            });
            const dataUrl = images[rowFiles[i]];
            if (!dataUrl) continue;
            let image = embedded.get(rowFiles[i]);
            if (!image) {
              image = await embed(dataUrl);
              embedded.set(rowFiles[i], image);
            }
            const fit = containSize(grid.slotSize, image.width, image.height);
            page.drawImage(image, {
              x: slotX + fit.offsetX,
              y: slotBottomY + fit.offsetY,
              width: fit.width,
              height: fit.height,
            });
          }
          cursorY = rowTop - grid.slotSize - GRID_GAP;
        }
      };

      // Document title.
      drawRuns([{ text: document.title }], TITLE_SIZE, true);
      cursorY -= PARA_GAP;

      for (const section of document.sections) {
        if (section.heading) {
          cursorY -= PARA_GAP;
          drawRuns([{ text: section.heading }], H2_SIZE, true);
          cursorY -= PARA_GAP / 2;
        }
        if (section.html.trim()) drawBlocks(parseHtmlToBlocks(section.html));
        if (section.imageGrid) await drawGrid(section.imageGrid.columns, section.imageGrid.files);
      }

      return pdf.save();
    },
  };
}
