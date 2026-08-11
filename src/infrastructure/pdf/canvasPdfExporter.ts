import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import {
  A4,
  componentFrameChromeHeight,
  containSize,
  contentSize,
  DEFAULT_PAGE_GEOMETRY,
  PLAN_COMPONENT_VISUAL_INSET,
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
} from "../../domain/plan/canvas/models";
import { clampContentScale } from "../../domain/plan/canvas/models";
import type {
  LegacyV6PlanComponent,
  LegacyV6ReferenceImage,
} from "../../domain/plan/canvas/legacyV6";
import {
  buildCanvasLayout,
  PDF_COMPONENT_FRAME_CHROME,
  PDF_PLAN_COMPONENT_FRAME_CHROME,
  temporaryPagedExportPlan,
} from "../../domain/plan/canvas/pdf/exportDocument";
import {
  COMPONENT_INSET,
  REFERENCE_HEADER_HEIGHT,
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
import {
  optimizePdfImage,
  type PdfImageDrawBox,
  type PdfImageOptimizer,
} from "./pdfImageOptimizer";
import { pdfDocumentText, subsetPdfFont } from "./pdfFontSubset";
import { layoutTextTree } from "../../domain/plan/canvas/textTree";

const TITLE_SIZE = 14;
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

function requireReferenceImageData(
  images: Record<string, string>,
  componentId: string,
  image: Pick<LegacyV6ReferenceImage, "id" | "file">,
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

function scalePdfTextLayout(
  layout: PdfTextLayout<PDFFont>,
  scale: number,
): PdfTextLayout<PDFFont> {
  return {
    height: layout.height * scale,
    commands: layout.commands.map((command) => ({
      ...command,
      baselineFromTop: command.baselineFromTop * scale,
      size: command.size * scale,
      x: command.x * scale,
    })),
  };
}

function scaleRect(rect: Rect, scale: number): Rect {
  return {
    x: rect.x * scale,
    y: rect.y * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}

function preparePdfTextLayouts(
  components: LegacyV6PlanComponent[],
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
    const contentScale = clampContentScale(component.contentScale);
    const componentWidth = component.width * pageContent.width;
    const frameInset = component.type === "plan"
      ? PLAN_COMPONENT_VISUAL_INSET
      : COMPONENT_INSET;
    const textWidth = Math.max(
      0,
      componentWidth / contentScale - frameInset * 2,
    );

    if (component.type === "plan") {
      const textLayout = layoutPdfRichText(
        parseHtmlToBlocks(component.html),
        textWidth,
        { regular, bold },
      );
      planLayouts.set(component.id, textLayout);
      planHeights.set(component.id, textLayout.height + frameInset * 2);
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

function placementContentRect(
  placement: ComponentFragmentPlacement,
  contentScale: number,
  frameInset: number,
  frameChromeHeight: number,
): { contentRect: Rect; pageY: number } {
  const pageY = A4.height - SPACING - placement.rect.y;
  return {
    pageY,
    contentRect: {
      x: SPACING + placement.rect.x + frameInset * contentScale,
      y: pageY - placement.rect.height + frameInset * contentScale,
      width: Math.max(0, placement.rect.width - frameInset * 2 * contentScale),
      height: Math.max(
        0,
        placement.rect.height -
          frameInset * 2 * contentScale -
          frameChromeHeight,
      ),
    },
  };
}

function largestImageDrawBoxes(
  layout: LayoutResult,
  components: readonly LegacyV6PlanComponent[],
  frameChromeHeight: number,
): ReadonlyMap<string, PdfImageDrawBox> {
  const boxes = new Map<string, PdfImageDrawBox>();
  for (const placement of layout.placements) {
    const component = components.find((entry) => entry.id === placement.componentId);
    if (component?.type !== "reference" || !placement.imageSlots) continue;
    const contentScale = clampContentScale(component.contentScale);
    const { contentRect } = placementContentRect(
      placement,
      contentScale,
      COMPONENT_INSET,
      frameChromeHeight,
    );
    const imagesById = new Map(component.images.map((image) => [image.id, image]));
    for (const slot of placement.imageSlots) {
      if (slot.kind !== "image") continue;
      const image = imagesById.get(slot.id);
      if (!image) continue;
      const drawBox = slotToPageRect(
        contentRect,
        scaleRect(
          {
            x: slot.x,
            y: slot.y,
            width: slot.width,
            height: slot.imageHeight,
          },
          contentScale,
        ),
      );
      const previous = boxes.get(image.file);
      boxes.set(image.file, {
        width: Math.max(previous?.width ?? 0, drawBox.width),
        height: Math.max(previous?.height ?? 0, drawBox.height),
      });
    }
  }
  return boxes;
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
  components: LegacyV6PlanComponent[],
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
    const referenceFrameChromeHeight = componentFrameChromeHeight(
      PDF_COMPONENT_FRAME_CHROME,
    );
    const planFrameChromeHeight = componentFrameChromeHeight(
      PDF_PLAN_COMPONENT_FRAME_CHROME,
    );
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
      const contentScale = clampContentScale(component.contentScale);

      if (component.type === "reference") {
        const descriptionLayout =
          textLayouts.referenceDescriptionLayouts.get(component.id);
        if (!descriptionLayout) {
          continue;
        }

        const paginated = paginatePdfTextLayout(
          scalePdfTextLayout(descriptionLayout, contentScale),
          {
          textStartFromDocumentTop:
            placement.pageIndex * geometry.page.height +
            geometry.margin +
            placement.rect.y +
            COMPONENT_INSET * contentScale +
            referenceFrameChromeHeight +
            REFERENCE_HEADER_HEIGHT * contentScale,
          pageHeight: geometry.page.height,
          pageMargin: geometry.margin,
          },
        );
        paginatedReferenceDescriptionLayouts.set(component.id, paginated);
        nextReferenceDescriptionHeights.set(
          component.id,
          paginated.height / contentScale,
        );
        continue;
      }

      const textLayout = textLayouts.planLayouts.get(component.id);
      if (!textLayout) {
        continue;
      }
      const paginated = paginatePdfTextLayout(
        scalePdfTextLayout(textLayout, contentScale),
        {
        textStartFromDocumentTop:
          placement.pageIndex * geometry.page.height +
          geometry.margin +
          placement.rect.y +
          PLAN_COMPONENT_VISUAL_INSET * contentScale +
          planFrameChromeHeight,
        pageHeight: geometry.page.height,
        pageMargin: geometry.margin,
        },
      );
      paginatedPlanLayouts.set(component.id, paginated);
      nextPlanHeights.set(
        component.id,
        paginated.height / contentScale + PLAN_COMPONENT_VISUAL_INSET * 2,
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

export function createCanvasPdfExporter(
  loadFonts: () => Promise<Fonts>,
  options: { optimizeImage?: PdfImageOptimizer } = {},
) {
  const optimizeImage = options.optimizeImage ?? optimizePdfImage;
  return {
    async export(plan: ProjectPlan, images: Record<string, string>): Promise<Uint8Array> {
      validateReferenceImageData(plan, images);
      const temporaryPlan = temporaryPagedExportPlan(plan);
      const pdf = await PDFDocument.create();
      pdf.registerFontkit(fontkit);

      const fonts = await loadFonts();
      const fontText = pdfDocumentText(plan);
      // fontkit corrupts some CJK glyf records when it subsets these fonts. Build valid,
      // document-specific TTFs first, then embed them without a second subset pass.
      const regular = await pdf.embedFont(subsetPdfFont(fonts.regular, fontText), {
        subset: false,
      });
      const bold = await pdf.embedFont(subsetPdfFont(fonts.bold, fontText), {
        subset: false,
      });
      const textLayouts = preparePdfTextLayouts(
        temporaryPlan.components,
        DEFAULT_PAGE_GEOMETRY,
        regular,
        bold,
      );
      const {
        layout,
        paginatedPlanLayouts,
        paginatedReferenceDescriptionLayouts,
      } = resolvePdfLayout(
        temporaryPlan.components,
        DEFAULT_PAGE_GEOMETRY,
        textLayouts,
        plan.title,
      );

      const embedded = new Map<string, PDFImage>();
      const referenceFrameChromeHeight = componentFrameChromeHeight(
        PDF_COMPONENT_FRAME_CHROME,
      );
      const imageDrawBoxes = largestImageDrawBoxes(
        layout,
        temporaryPlan.components,
        referenceFrameChromeHeight,
      );

      const embed = async (
        dataUrl: string,
        drawBox: PdfImageDrawBox,
      ): Promise<PDFImage> => {
        const { mime, bytes } = await optimizeImage(dataUrl, drawBox);
        return mime.includes("png") ? pdf.embedPng(bytes) : pdf.embedJpg(bytes);
      };

      const pages: PDFPage[] = [];
      for (let i = 0; i < layout.pageCount; i += 1) {
        pages.push(pdf.addPage([595.28, 841.89]));
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

      for (const placement of layout.placements) {
        const page = pages[placement.pageIndex];
        const component = temporaryPlan.components.find((c) => c.id === placement.componentId);
        if (!component) continue;
        const contentScale = clampContentScale(component.contentScale);

        const { contentRect, pageY } = placementContentRect(
          placement,
          contentScale,
          component.type === "plan" ? PLAN_COMPONENT_VISUAL_INSET : COMPONENT_INSET,
          component.type === "plan"
            ? componentFrameChromeHeight(PDF_PLAN_COMPONENT_FRAME_CHROME)
            : referenceFrameChromeHeight,
        );

        if (placement.kind !== "continuation" && component.type === "reference") {
          page.drawText(component.name, {
            x: contentRect.x,
            y: pageY - COMPONENT_INSET * contentScale - TITLE_SIZE * contentScale,
            size: TITLE_SIZE * contentScale,
            font: bold,
            color: TEXT_COLOR,
          });
        }

        if (component.type === "plan") {
          const sourceComponent = plan.components.find(
            (entry) => entry.id === component.id && entry.type === "plan",
          );
          if (sourceComponent?.type === "plan" && sourceComponent.textRoot.kind === "split") {
            for (const leafPlacement of layoutTextTree(sourceComponent.textRoot, contentRect)) {
              const leafLayout = scalePdfTextLayout(
                layoutPdfRichText(
                  parseHtmlToBlocks(leafPlacement.leaf.html),
                  leafPlacement.rect.width / contentScale,
                  { regular, bold },
                ),
                contentScale,
              );
              for (const command of leafLayout.commands) {
                drawTextCommand(
                  page,
                  command,
                  leafPlacement.rect.x + command.x,
                  leafPlacement.rect.y + leafPlacement.rect.height - command.baselineFromTop,
                );
              }
            }
          } else {
            const textLayout = paginatedPlanLayouts.get(component.id);
            if (textLayout) {
              drawPaginatedRichTextLayout(
                pages,
                textLayout,
                contentRect.x,
                DEFAULT_PAGE_GEOMETRY.page.height,
              );
            }
          }
        } else if (component.type === "reference") {
          const ref = component;
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
                image = await embed(
                  dataUrl,
                  imageDrawBoxes.get(imageFile) ?? {
                    width: A4.width,
                    height: A4.height,
                  },
                );
                embedded.set(imageFile, image);
              }

              const imageSlotInPage: Rect = slotToPageRect(
                contentRect,
                scaleRect(
                  {
                    x: slot.x,
                    y: slot.y,
                    width: slot.width,
                    height: slot.imageHeight,
                  },
                  contentScale,
                ),
              );

              page.drawRectangle({
                x: imageSlotInPage.x,
                y: imageSlotInPage.y,
                width: imageSlotInPage.width,
                height: imageSlotInPage.height,
                borderColor: FRAME_COLOR,
                borderWidth: 0.75,
              });

              const imageRect = referenceImageDrawBox(imageSlotInPage, image);
              page.drawImage(image, {
                x: imageRect.x,
                y: imageRect.y,
                width: imageRect.width,
                height: imageRect.height,
              });

            }
          }
        }
      }

      return pdf.save();
    },
  };
}
