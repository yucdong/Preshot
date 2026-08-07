import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  clip,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import { normalizeCrop } from "../../domain/plan/canvas/crop";
import {
  A4,
  componentFrameChromeHeight,
  containSize,
  contentSize,
  DEFAULT_PAGE_GEOMETRY,
  SPACING,
  type PageGeometry,
  type Rect,
} from "../../domain/plan/canvas/geometry";
import type {
  ComponentFragmentPlacement,
  LayoutMeasurements,
  LayoutResult,
} from "../../domain/plan/canvas/engine";
import type {
  ProjectPlan,
  ReferenceComponent,
  ReferenceImage,
} from "../../domain/plan/canvas/models";
import {
  buildCanvasLayout,
  PDF_COMPONENT_FRAME_CHROME,
} from "../../domain/plan/canvas/pdf/exportDocument";
import {
  COMPONENT_INSET,
  REFERENCE_HEADER_HEIGHT,
  type ReferenceFlowSlot,
} from "../../domain/plan/canvas/referenceLayout";
import { parseHtmlToBlocks } from "./htmlToBlocks";
import {
  layoutPdfRichText,
  paginatePdfTextLayout,
  type PaginatedPdfTextLayout,
  type PdfTextCommand,
  type PdfTextLayout,
} from "./pdfTextLayout";
import { slotToPageRect } from "./slotPageRect";

const TITLE_SIZE = 14;
const CAPTION_SIZE = 9;
const TEXT_COLOR = rgb(0.11, 0.1, 0.09);
const LINK_COLOR = rgb(0.15, 0.39, 0.92);
const FRAME_COLOR = rgb(0.85, 0.85, 0.85);

type Rgb = ReturnType<typeof rgb>;

interface Fonts {
  regular: Uint8Array;
  bold: Uint8Array;
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


function dataUrlToBytes(dataUrl: string): { mime: string; bytes: Uint8Array } {
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!match) throw new Error("Unsupported image data URL");
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return { mime: match[1], bytes };
}

function requireReferenceImageData(
  images: Record<string, string>,
  componentId: string,
  image: ReferenceImage,
): string {
  const dataUrl = images[image.file];
  if (!dataUrl) {
    throw new Error(
      `Missing reference image data for "${image.file}" (component "${componentId}", image "${image.id}")`,
    );
  }
  return dataUrl;
}

function validateReferenceImageData(
  plan: ProjectPlan,
  images: Record<string, string>,
): void {
  for (const component of plan.components) {
    if (component.type !== "reference") {
      continue;
    }
    for (const image of component.images) {
      requireReferenceImageData(images, component.id, image);
    }
  }
}

function drawTextCommand(
  page: PDFPage,
  command: PdfTextCommand<PDFFont>,
  x: number,
  baseline: number,
): void {
  const width = command.font.widthOfTextAtSize(command.text, command.size);
  const color = command.link
    ? LINK_COLOR
    : command.color
      ? parseColor(command.color) ?? TEXT_COLOR
      : TEXT_COLOR;
  page.drawText(command.text, {
    x,
    y: baseline,
    size: command.size,
    font: command.font,
    color,
  });
  if (!command.isSpace) {
    if (command.link || command.underline) {
      page.drawLine({
        start: { x, y: baseline - 1.5 },
        end: { x: x + width, y: baseline - 1.5 },
        thickness: 0.5,
        color,
      });
    }
    if (command.strike) {
      page.drawLine({
        start: { x, y: baseline + command.size * 0.3 },
        end: { x: x + width, y: baseline + command.size * 0.3 },
        thickness: 0.5,
        color,
      });
    }
  }
}

function drawPaginatedRichTextLayout(
  pages: PDFPage[],
  layout: PaginatedPdfTextLayout<PDFFont>,
  x: number,
  pageHeight: number,
): void {
  for (const command of layout.commands) {
    const page = pages[command.pageIndex];
    if (!page) {
      continue;
    }
    drawTextCommand(
      page,
      command,
      x + command.x,
      pageHeight - command.baselineFromPageTop,
    );
  }
}

function splitReferenceSlot(slot: ReferenceFlowSlot): { image: Rect; caption: Rect } {
  return {
    image: { x: slot.x, y: slot.y, width: slot.width, height: slot.imageHeight },
    caption: {
      x: slot.x,
      y: slot.y + slot.imageHeight,
      width: slot.width,
      height: slot.captionHeight,
    },
  };
}

function referenceImageDrawBox(slotRect: Rect, image: PDFImage): Rect {
  if (
    !Number.isFinite(image.width) ||
    image.width <= 0 ||
    !Number.isFinite(image.height) ||
    image.height <= 0
  ) {
    return slotRect;
  }

  const fit = containSize(slotRect.width, slotRect.height, image.width, image.height);
  return {
    x: slotRect.x + fit.offsetX,
    y: slotRect.y + fit.offsetY,
    width: fit.width,
    height: fit.height,
  };
}

interface PdfTextLayouts {
  measurements: LayoutMeasurements;
  planLayouts: ReadonlyMap<string, PdfTextLayout<PDFFont>>;
  referenceDescriptionLayouts: ReadonlyMap<string, PdfTextLayout<PDFFont>>;
}

function preparePdfTextLayouts(
  components: ProjectPlan["components"],
  geometry: PageGeometry,
  regular: PDFFont,
  bold: PDFFont,
): PdfTextLayouts {
  const pageContent = contentSize(geometry);
  const planHeights = new Map<string, number>();
  const referenceDescriptionHeights = new Map<string, number>();
  const planLayouts = new Map<string, PdfTextLayout<PDFFont>>();
  const referenceDescriptionLayouts = new Map<string, PdfTextLayout<PDFFont>>();

  for (const component of components) {
    const componentWidth = component.width * pageContent.width;
    const textWidth = Math.max(0, componentWidth - COMPONENT_INSET * 2);

    if (component.type === "plan") {
      const textLayout = layoutPdfRichText(
        parseHtmlToBlocks(component.html),
        textWidth,
        { regular, bold },
      );
      planLayouts.set(component.id, textLayout);
      planHeights.set(component.id, textLayout.height + COMPONENT_INSET * 2);
      continue;
    }

    if (component.description.trim()) {
      const descriptionLayout = layoutPdfRichText(
        parseHtmlToBlocks(component.description),
        textWidth,
        { regular, bold },
      );
      referenceDescriptionLayouts.set(component.id, descriptionLayout);
      referenceDescriptionHeights.set(component.id, descriptionLayout.height);
    }
  }

  return {
    measurements: { planHeights, referenceDescriptionHeights },
    planLayouts,
    referenceDescriptionLayouts,
  };
}

interface ResolvedPdfLayout {
  layout: LayoutResult;
  paginatedPlanLayouts: ReadonlyMap<string, PaginatedPdfTextLayout<PDFFont>>;
  paginatedReferenceDescriptionLayouts: ReadonlyMap<
    string,
    PaginatedPdfTextLayout<PDFFont>
  >;
}

function planPlacement(
  layout: LayoutResult,
  componentId: string,
): ComponentFragmentPlacement | undefined {
  return layout.placements.find(
    (placement) => placement.componentId === componentId,
  );
}

function samePlanHeights(
  previous: ReadonlyMap<string, number>,
  next: ReadonlyMap<string, number>,
): boolean {
  if (previous.size !== next.size) {
    return false;
  }
  return Array.from(previous).every(
    ([id, height]) => Math.abs((next.get(id) ?? Number.NaN) - height) < 0.01,
  );
}

function resolvePdfLayout(
  components: ProjectPlan["components"],
  geometry: PageGeometry,
  textLayouts: PdfTextLayouts,
  documentTitle: string,
): ResolvedPdfLayout {
  let measurements: LayoutMeasurements = {
    planHeights: new Map(textLayouts.measurements.planHeights),
    referenceDescriptionHeights:
      textLayouts.measurements.referenceDescriptionHeights,
  };
  const seenHeightSignatures = new Set<string>();

  for (;;) {
    const signature = JSON.stringify({
      plan: Array.from(measurements.planHeights),
      reference: Array.from(measurements.referenceDescriptionHeights),
    });
    if (seenHeightSignatures.has(signature)) {
      throw new Error("Unable to stabilize PDF text pagination");
    }
    seenHeightSignatures.add(signature);

    const layout = buildCanvasLayout(components, geometry, measurements, documentTitle);
    const frameChromeHeight = componentFrameChromeHeight(PDF_COMPONENT_FRAME_CHROME);
    const paginatedPlanLayouts = new Map<
      string,
      PaginatedPdfTextLayout<PDFFont>
    >();
    const paginatedReferenceDescriptionLayouts = new Map<
      string,
      PaginatedPdfTextLayout<PDFFont>
    >();
    const nextPlanHeights = new Map<string, number>();
    const nextReferenceDescriptionHeights = new Map<string, number>();

    for (const component of components) {
      const placement = planPlacement(layout, component.id);
      if (!placement) {
        continue;
      }

      if (component.type === "reference") {
        const descriptionLayout =
          textLayouts.referenceDescriptionLayouts.get(component.id);
        if (!descriptionLayout) {
          continue;
        }

        const paginated = paginatePdfTextLayout(descriptionLayout, {
          textStartFromDocumentTop:
            placement.pageIndex * geometry.page.height +
            geometry.margin +
            placement.rect.y +
            COMPONENT_INSET +
            frameChromeHeight +
            REFERENCE_HEADER_HEIGHT,
          pageHeight: geometry.page.height,
          pageMargin: geometry.margin,
        });
        paginatedReferenceDescriptionLayouts.set(component.id, paginated);
        nextReferenceDescriptionHeights.set(component.id, paginated.height);
        continue;
      }

      const textLayout = textLayouts.planLayouts.get(component.id);
      if (!textLayout) {
        continue;
      }
      const paginated = paginatePdfTextLayout(textLayout, {
        textStartFromDocumentTop:
          placement.pageIndex * geometry.page.height +
          geometry.margin +
          placement.rect.y +
          COMPONENT_INSET +
          frameChromeHeight,
        pageHeight: geometry.page.height,
        pageMargin: geometry.margin,
      });
      paginatedPlanLayouts.set(component.id, paginated);
      nextPlanHeights.set(
        component.id,
        paginated.height + COMPONENT_INSET * 2,
      );
    }

    if (
      samePlanHeights(measurements.planHeights, nextPlanHeights) &&
      samePlanHeights(
        measurements.referenceDescriptionHeights,
        nextReferenceDescriptionHeights,
      )
    ) {
      return {
        layout,
        paginatedPlanLayouts,
        paginatedReferenceDescriptionLayouts,
      };
    }

    measurements = {
      planHeights: nextPlanHeights,
      referenceDescriptionHeights: nextReferenceDescriptionHeights,
    };
  }
}

export function createCanvasPdfExporter(loadFonts: () => Promise<Fonts>) {
  return {
    async export(plan: ProjectPlan, images: Record<string, string>): Promise<Uint8Array> {
      validateReferenceImageData(plan, images);
      const pdf = await PDFDocument.create();
      pdf.registerFontkit(fontkit);

      const fonts = await loadFonts();
      // Embed with subset: true for small output (full-font embeds are ~16 MB). fontkit's
      // CFFSubset.encode throws on an EMPTY subset, so a font that is embedded but never
      // drawn (e.g. no bold text in the document) would crash at save — the fonts are primed
      // with an invisible glyph below to guarantee both subsets are non-empty.
      const regular = await pdf.embedFont(fonts.regular, { subset: true });
      const bold = await pdf.embedFont(fonts.bold, { subset: true });
      const textLayouts = preparePdfTextLayouts(
        plan.components,
        DEFAULT_PAGE_GEOMETRY,
        regular,
        bold,
      );
      const {
        layout,
        paginatedPlanLayouts,
        paginatedReferenceDescriptionLayouts,
      } = resolvePdfLayout(
        plan.components,
        DEFAULT_PAGE_GEOMETRY,
        textLayouts,
        plan.title,
      );

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

      if (plan.title.trim()) {
        pages[0].drawText(plan.title, {
          x: SPACING,
          y: A4.height - SPACING - TITLE_SIZE,
          size: TITLE_SIZE,
          font: bold,
          color: TEXT_COLOR,
        });
      }

      const frameChromeHeight = componentFrameChromeHeight(PDF_COMPONENT_FRAME_CHROME);
      for (const placement of layout.placements) {
        const page = pages[placement.pageIndex];
        const component = plan.components.find((c) => c.id === placement.componentId);
        if (!component) continue;

        const pageY = A4.height - SPACING - placement.rect.y;
        const contentRect: Rect = {
          x: SPACING + placement.rect.x + COMPONENT_INSET,
          y: pageY - placement.rect.height + COMPONENT_INSET,
          width: placement.rect.width - COMPONENT_INSET * 2,
          height: placement.rect.height - COMPONENT_INSET * 2 - frameChromeHeight,
        };

        if (placement.kind !== "continuation") {
          page.drawText(component.name, {
            x: contentRect.x,
            y: pageY - COMPONENT_INSET - TITLE_SIZE,
            size: TITLE_SIZE,
            font: bold,
            color: TEXT_COLOR,
          });
        }

        if (component.type === "plan") {
          const textLayout = paginatedPlanLayouts.get(component.id);
          if (textLayout) {
            drawPaginatedRichTextLayout(
              pages,
              textLayout,
              contentRect.x,
              DEFAULT_PAGE_GEOMETRY.page.height,
            );
          }
        } else if (component.type === "reference") {
          const ref = component as ReferenceComponent;
          const isContinuation = placement.kind === "continuation";

          if (!isContinuation && ref.description.trim()) {
            const descriptionLayout =
              paginatedReferenceDescriptionLayouts.get(component.id);
            if (descriptionLayout) {
              drawPaginatedRichTextLayout(
                pages,
                descriptionLayout,
                contentRect.x,
                DEFAULT_PAGE_GEOMETRY.page.height,
              );
            }
          }

          if (placement.imageSlots) {
            const imagesById = new Map(ref.images.map((image) => [image.id, image]));
            for (const slot of placement.imageSlots) {
              if (slot.kind !== "image") {
                continue;
              }

              const imageRecord = imagesById.get(slot.id);
              if (!imageRecord) {
                continue;
              }

              const imageFile = imageRecord.file;
              const dataUrl = requireReferenceImageData(
                images,
                ref.id,
                imageRecord,
              );

              let image = embedded.get(imageFile);
              if (!image) {
                image = await embed(dataUrl);
                embedded.set(imageFile, image);
              }

              const split = splitReferenceSlot(slot);
              const imageSlotInPage: Rect = slotToPageRect(contentRect, split.image);

              page.drawRectangle({
                x: imageSlotInPage.x,
                y: imageSlotInPage.y,
                width: imageSlotInPage.width,
                height: imageSlotInPage.height,
                borderColor: FRAME_COLOR,
                borderWidth: 0.75,
              });

              const crop = imageRecord.crop && normalizeCrop(imageRecord.crop);
              if (crop) {
                const width = imageSlotInPage.width / crop.width;
                const height = imageSlotInPage.height / crop.height;
                page.pushOperators(
                  pushGraphicsState(),
                  rectangle(
                    imageSlotInPage.x,
                    imageSlotInPage.y,
                    imageSlotInPage.width,
                    imageSlotInPage.height,
                  ),
                  clip(),
                  endPath(),
                );
                page.drawImage(image, {
                  x: imageSlotInPage.x - crop.x * width,
                  y: imageSlotInPage.y - (1 - crop.y - crop.height) * height,
                  width,
                  height,
                });
                page.pushOperators(popGraphicsState());
              } else {
                const imageRect = referenceImageDrawBox(imageSlotInPage, image);
                page.drawImage(image, {
                  x: imageRect.x,
                  y: imageRect.y,
                  width: imageRect.width,
                  height: imageRect.height,
                });
              }

              const shouldExportCaption = Boolean(imageRecord.caption?.trim());
              if (shouldExportCaption) {
                const captionRect: Rect = slotToPageRect(contentRect, split.caption);
                const savedY = captionRect.y + captionRect.height - CAPTION_SIZE;
                page.drawText(imageRecord.caption!, {
                  x: captionRect.x,
                  y: savedY,
                  size: CAPTION_SIZE,
                  font: regular,
                  color: TEXT_COLOR,
                });
              }
            }
          }
        }
      }

      return pdf.save();
    },
  };
}
