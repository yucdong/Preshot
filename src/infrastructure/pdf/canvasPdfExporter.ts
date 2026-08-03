import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { containSize, GUTTER, type Rect } from "../../domain/plan/canvas/geometry";
import { DESCRIPTION_BAND, slotCaptionSplit, TITLE_BAND } from "../../domain/plan/canvas/engine";
import type { ProjectPlan, ReferenceComponent } from "../../domain/plan/canvas/models";
import { buildCanvasLayout } from "../../domain/plan/canvas/pdf/exportDocument";
import { parseHtmlToBlocks, type Block, type Run } from "./htmlToBlocks";
import { slotToPageRect } from "./slotPageRect";

const TITLE_SIZE = 14;
const BODY_SIZE = 11;
const CAPTION_SIZE = 9;
const H1_SIZE = 16;
const H2_SIZE = 13;
const LINE = 1.35;
const PARA_GAP = 6;
const LIST_INDENT = 16;
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

function drawRichText(
  page: PDFPage,
  blocks: Block[],
  rect: Rect,
  regular: PDFFont,
  bold: PDFFont,
): void {
  let cursorY = rect.y + rect.height;

  const drawRuns = (runs: Run[], defaultSize: number, boldDefault: boolean, indent = 0) => {
    // Early check: if we're already past the bottom, don't process at all
    if (cursorY - defaultSize * LINE < rect.y) return;
    
    const maxWidth = rect.width - indent;
    const tokens = runs.flatMap((run) => tokenizeRun(run, run.bold || boldDefault ? bold : regular, run.size ?? defaultSize));
    let line: Token[] = [];
    let width = 0;
    const flushLine = () => {
      if (line.length === 0) return;
      const lineSize = line.reduce((max, t) => Math.max(max, t.size), defaultSize);
      const lineHeight = lineSize * LINE;
      if (cursorY - lineHeight < rect.y) {
        // Clipped: discard without drawing (don't pollute font subset)
        line = [];
        width = 0;
        return;
      }
      let x = rect.x + indent;
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
    flushLine();
  };

  for (const block of blocks) {
    if (cursorY - BODY_SIZE * LINE < rect.y) break; // clipped
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
        if (cursorY - BODY_SIZE * LINE < rect.y) return;
        page.drawText(marker, { x: rect.x, y: cursorY - BODY_SIZE, size: BODY_SIZE, font: regular, color: TEXT_COLOR });
        drawRuns(item, BODY_SIZE, false, LIST_INDENT);
      });
      cursorY -= PARA_GAP;
    }
  }
}

export function createCanvasPdfExporter(loadFonts: () => Promise<Fonts>) {
  return {
    async export(plan: ProjectPlan, images: Record<string, string>): Promise<Uint8Array> {
      const pdf = await PDFDocument.create();
      pdf.registerFontkit(fontkit);

      const layout = buildCanvasLayout(plan.components);

      if (layout.pageCount === 0) {
        return pdf.save();
      }

      const fonts = await loadFonts();
      // Embed with subset: true for small output (full-font embeds are ~16 MB). fontkit's
      // CFFSubset.encode throws on an EMPTY subset, so a font that is embedded but never
      // drawn (e.g. no bold text in the document) would crash at save — the fonts are primed
      // with an invisible glyph below to guarantee both subsets are non-empty.
      const regular = await pdf.embedFont(fonts.regular, { subset: true });
      const bold = await pdf.embedFont(fonts.bold, { subset: true });

      const embedded = new Map<string, PDFImage>();

      const embed = async (dataUrl: string): Promise<PDFImage> => {
        const { mime, bytes } = dataUrlToBytes(dataUrl);
        return mime.includes("png") ? pdf.embedPng(bytes) : pdf.embedJpg(bytes);
      };

      const pages: PDFPage[] = [];
      for (let i = 0; i < layout.pageCount; i += 1) {
        pages.push(pdf.addPage([595.28, 841.89]));
      }

      // Prime both fonts with an invisible space so neither CFF subset is ever empty
      // (an unused subset:true font otherwise makes fontkit's CFFSubset.encode throw).
      for (const font of [regular, bold]) {
        pages[0].drawText(" ", { x: 0, y: 0, size: 1, font, color: rgb(1, 1, 1) });
      }

      for (const placement of layout.placements) {
        const page = pages[placement.pageIndex];
        const component = plan.components.find((c) => c.id === placement.componentId);
        if (!component) continue;

        const pageY = 841.89 - 48 - placement.rect.y;
        const contentRect: Rect = {
          x: 48 + placement.rect.x + GUTTER / 2,
          y: pageY - placement.rect.height + GUTTER / 2,
          width: placement.rect.width - GUTTER,
          height: placement.rect.height - GUTTER,
        };

        if (component.type === "plan") {
          const blocks = parseHtmlToBlocks(component.html);
          drawRichText(page, blocks, contentRect, regular, bold);
        } else if (component.type === "reference") {
          const ref = component as ReferenceComponent;
          const titleY = contentRect.y + contentRect.height - TITLE_SIZE;
          page.drawText(ref.title, { x: contentRect.x, y: titleY, size: TITLE_SIZE, font: bold, color: TEXT_COLOR });

          if (ref.description.trim()) {
            const descRect: Rect = {
              x: contentRect.x,
              y: contentRect.y + contentRect.height - TITLE_BAND - DESCRIPTION_BAND,
              width: contentRect.width,
              height: DESCRIPTION_BAND,
            };
            const descBlocks = parseHtmlToBlocks(ref.description);
            drawRichText(page, descBlocks, descRect, regular, bold);
          }

          if (placement.imageSlots) {
            for (let i = 0; i < placement.imageSlots.length && i < ref.images.length; i += 1) {
              const slot = placement.imageSlots[i];
              const imageFile = ref.images[i].file;
              const dataUrl = images[imageFile];
              if (!dataUrl) continue;

              let image = embedded.get(imageFile);
              if (!image) {
                image = await embed(dataUrl);
                embedded.set(imageFile, image);
              }

              const split = slotCaptionSplit(slot, ref.showCaptions);
              const imageSlotInPage: Rect = slotToPageRect(contentRect, split.image);

              page.drawRectangle({
                x: imageSlotInPage.x,
                y: imageSlotInPage.y,
                width: imageSlotInPage.width,
                height: imageSlotInPage.height,
                borderColor: FRAME_COLOR,
                borderWidth: 0.75,
              });

              const fit = containSize(imageSlotInPage.width, imageSlotInPage.height, image.width, image.height);
              page.drawImage(image, {
                x: imageSlotInPage.x + fit.offsetX,
                y: imageSlotInPage.y + fit.offsetY,
                width: fit.width,
                height: fit.height,
              });

              if (ref.showCaptions && ref.images[i].caption) {
                const captionRect: Rect = slotToPageRect(contentRect, split.caption);
                const savedY = captionRect.y + captionRect.height - CAPTION_SIZE;
                page.drawText(ref.images[i].caption ?? "", { x: captionRect.x, y: savedY, size: CAPTION_SIZE, font: regular, color: TEXT_COLOR });
              }
            }
          }
        }
      }

      return pdf.save();
    },
  };
}
