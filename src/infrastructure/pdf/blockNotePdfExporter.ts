import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import type { ProjectPlanV14 } from "../../domain/plan/canvas/blockDocument";
import {
  A4,
  contentSize,
  DEFAULT_PAGE_GEOMETRY,
} from "../../domain/plan/canvas/geometry";
import { blockDocumentToPdfBlocks } from "./blockDocumentToBlocks";
import {
  layoutPdfRichText,
  paginatePdfTextLayout,
  type PdfTextCommand,
} from "./pdfTextLayout";
import {
  optimizePdfImage,
  type PdfImageDrawBox,
  type PdfImageOptimizer,
} from "./pdfImageOptimizer";
import { subsetPdfFont } from "./pdfFontSubset";

interface Fonts {
  regular: Uint8Array;
  bold: Uint8Array;
}

const TEXT_COLOR = rgb(0.11, 0.1, 0.09);
const LINK_COLOR = rgb(0.15, 0.39, 0.92);

function parseColor(value: string) {
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return undefined;
  const number = Number.parseInt(match[1], 16);
  return rgb(
    ((number >> 16) & 255) / 255,
    ((number >> 8) & 255) / 255,
    (number & 255) / 255,
  );
}

function drawText(
  page: PDFPage,
  command: PdfTextCommand<PDFFont>,
  x: number,
  baseline: number,
): void {
  const color = command.link
    ? LINK_COLOR
    : command.color
      ? parseColor(command.color) ?? TEXT_COLOR
      : TEXT_COLOR;
  const width = command.font.widthOfTextAtSize(command.text, command.size);
  page.drawText(command.text, {
    x,
    y: baseline,
    size: command.size,
    font: command.font,
    color,
  });
  if (!command.isSpace && (command.link || command.underline)) {
    page.drawLine({
      start: { x, y: baseline - 1.5 },
      end: { x: x + width, y: baseline - 1.5 },
      thickness: 0.5,
      color,
    });
  }
  if (!command.isSpace && command.strike) {
    page.drawLine({
      start: { x, y: baseline + command.size * 0.3 },
      end: { x: x + width, y: baseline + command.size * 0.3 },
      thickness: 0.5,
      color,
    });
  }
}

export function createBlockNotePdfExporter(
  loadFonts: () => Promise<Fonts>,
  options: { optimizeImage?: PdfImageOptimizer } = {},
) {
  const optimizeImage = options.optimizeImage ?? optimizePdfImage;
  return {
    async export(
      plan: ProjectPlanV14,
      images: Record<string, string>,
    ): Promise<Uint8Array> {
      const pdf = await PDFDocument.create();
      pdf.registerFontkit(fontkit);
      const fonts = await loadFonts();
      const fontText = `${plan.title}\n${JSON.stringify(plan.document.blocks)}`;
      const regular = await pdf.embedFont(subsetPdfFont(fonts.regular, fontText), {
        subset: false,
      });
      const bold = await pdf.embedFont(subsetPdfFont(fonts.bold, fontText), {
        subset: false,
      });
      const imageGroups = new Map(
        plan.imageGroups.map((group) => [group.id, group]),
      );
      const layout = layoutPdfRichText(
        blockDocumentToPdfBlocks(plan.document),
        contentSize(DEFAULT_PAGE_GEOMETRY).width,
        { regular, bold },
        { imageGroups },
      );
      const paginated = paginatePdfTextLayout(layout, {
        textStartFromDocumentTop: DEFAULT_PAGE_GEOMETRY.margin,
        pageHeight: A4.height,
        pageMargin: DEFAULT_PAGE_GEOMETRY.margin,
      });
      const maximumPage = Math.max(
        0,
        ...paginated.commands.map((command) => command.pageIndex),
        ...paginated.images.map((image) => image.pageIndex),
      );
      const pages = Array.from(
        { length: maximumPage + 1 },
        () => pdf.addPage([A4.width, A4.height]),
      );
      const embedded = new Map<string, PDFImage>();

      const resolveImage = async (
        src: string,
        drawBox: PdfImageDrawBox,
        crop?: { x: number; y: number; width: number; height: number },
      ) => {
        const key = `${src}:${drawBox.width}:${drawBox.height}:${JSON.stringify(crop)}`;
        const cached = embedded.get(key);
        if (cached) return cached;
        const dataUrl = images[src];
        if (!dataUrl) {
          throw new Error(`Missing reference image data for "${src}"`);
        }
        const optimized = await optimizeImage(
          dataUrl,
          drawBox,
          crop ? { crop } : undefined,
        );
        const image = optimized.mime === "image/jpeg"
          ? await pdf.embedJpg(optimized.bytes)
          : await pdf.embedPng(optimized.bytes);
        embedded.set(key, image);
        return image;
      };

      for (const command of paginated.commands) {
        const page = pages[command.pageIndex];
        drawText(
          page,
          command,
          DEFAULT_PAGE_GEOMETRY.margin + command.x,
          A4.height - command.baselineFromPageTop,
        );
      }
      for (const command of paginated.images) {
        const page = pages[command.pageIndex];
        const image = await resolveImage(command.src, command, command.crop);
        page.drawImage(image, {
          x: DEFAULT_PAGE_GEOMETRY.margin + command.x,
          y: A4.height - command.topFromPageTop - command.height,
          width: command.width,
          height: command.height,
        });
      }
      return pdf.save();
    },
  };
}

export type BlockNotePdfExporter = ReturnType<typeof createBlockNotePdfExporter>;
