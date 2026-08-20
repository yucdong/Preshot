import { ImageRun, Paragraph, type IImageOptions } from "docx";
import type {
  PreshotPdfExportContext,
  PreshotPdfNormalizedCrop,
} from "../../domain/plan/blocknote/pdfExportPreflight";

export const DOCX_IMAGE_GROUP_TARGET_PPI = 300;
export const DOCX_IMAGE_GROUP_MINIMUM_PPI = 150;
export const DOCX_IMAGE_GROUP_MAX_AXIS_PIXELS = 8_192;
export const DOCX_IMAGE_GROUP_MAX_PIXELS = 40_000_000;
export const DOCX_IMAGE_GROUP_PAGE_SAFETY_POINTS = 6;
export const DOCX_IMAGE_GROUP_PAGE_EPSILON_POINTS = 0.01;

const POINTS_PER_INCH = 72;
const DOCX_LAYOUT_PIXELS_PER_INCH = 96;
const TWIPS_PER_POINT = 20;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

export type PreshotImageGroupDocxRenderErrorCode =
  | "INVALID_BLOCK"
  | "MISSING_GROUP_CONTEXT"
  | "GROUP_CONTEXT_MISMATCH"
  | "INVALID_GROUP_CONTEXT"
  | "MISSING_OPTIMIZED_ASSET"
  | "INVALID_OPTIMIZED_ASSET"
  | "COMPOSITOR_FAILED"
  | "INVALID_COMPOSITE_PNG";

export class PreshotImageGroupDocxRenderError extends Error {
  constructor(
    readonly code: PreshotImageGroupDocxRenderErrorCode,
    message: string,
    readonly context: {
      blockId: string;
      groupId: string;
      imageId?: string;
      assetId?: string;
    },
  ) {
    super(message);
    this.name = "PreshotImageGroupDocxRenderError";
  }
}

export interface PreshotImageGroupDocxBlock {
  readonly id: string;
  readonly type: "imageGroup";
  readonly props: {
    readonly groupId: string;
  };
}

export interface PreshotDocxRasterPlan {
  readonly width: number;
  readonly height: number;
  readonly targetPpi: number;
  readonly effectivePpi: number;
  readonly capped: boolean;
}

export interface PreshotDocxImageGroupCompositeImage {
  readonly imageId: string;
  readonly assetId: string;
  readonly crop: PreshotPdfNormalizedCrop;
  readonly xPoints: number;
  readonly yPoints: number;
  readonly widthPoints: number;
  readonly heightPoints: number;
  readonly backgroundColor: string;
  readonly borderColor: string;
  readonly borderWidthPoints: number;
  readonly borderRadiusPoints: number;
  readonly effectivePpi?: number;
  readonly asset: {
    readonly mime: string;
    readonly bytes: Readonly<Uint8Array>;
  };
}

export interface PreshotDocxImageGroupCompositeRequest {
  readonly blockId: string;
  readonly groupId: string;
  readonly display: {
    readonly widthPoints: number;
    readonly heightPoints: number;
    readonly indentPoints: number;
  };
  readonly raster: PreshotDocxRasterPlan;
  readonly backgroundColor: string;
  readonly surface: {
    readonly xPoints: 0;
    readonly yPoints: number;
    readonly widthPoints: number;
    readonly heightPoints: number;
    readonly backgroundColor: string;
    readonly borderColor: string;
    readonly borderWidthPoints: number;
    readonly borderRadiusPoints: number;
  };
  readonly images: readonly PreshotDocxImageGroupCompositeImage[];
}

export type PreshotDocxImageGroupCompositor = (
  request: PreshotDocxImageGroupCompositeRequest,
) => Promise<Readonly<Uint8Array>>;

export interface PreshotDocxImageGroupWarning {
  readonly severity: "warning";
  readonly code: "LOW_EFFECTIVE_PPI";
  readonly message: string;
  readonly blockId: string;
  readonly groupId: string;
  readonly effectivePpi: number;
}

export interface PreshotImageGroupDocxMappingOptions {
  readonly compositor: PreshotDocxImageGroupCompositor;
  readonly requestsByBlockId?: Readonly<
    Record<string, PreshotDocxImageGroupCompositeRequest>
  >;
  readonly onWarning?: (
    warning: PreshotDocxImageGroupWarning,
  ) => void | Promise<void>;
}

export type PreshotImageGroupDocxBlockMapping = (
  block: PreshotImageGroupDocxBlock,
) => Promise<Paragraph | Paragraph[]>;

interface MutableDocxXmlNode {
  readonly rootKey?: string;
  readonly root?: unknown[];
}

function removeSourceRectangles(nodes: unknown[]): void {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index] as MutableDocxXmlNode;
    if (node?.rootKey === "a:srcRect") {
      nodes.splice(index, 1);
    } else if (Array.isArray(node?.root)) {
      removeSourceRectangles(node.root);
    }
  }
}

class PreshotCompositeImageRun extends ImageRun {
  constructor(options: IImageOptions) {
    super(options);
    removeSourceRectangles(this.root);
  }
}

function renderError(
  code: PreshotImageGroupDocxRenderErrorCode,
  message: string,
  context: {
    blockId: string;
    groupId: string;
    imageId?: string;
    assetId?: string;
  },
): never {
  throw new PreshotImageGroupDocxRenderError(code, message, context);
}

function rounded(value: number, precision = 4): number {
  const result = Number(value.toFixed(precision));
  return Object.is(result, -0) ? 0 : result;
}

export function pointsToDocxLayoutPixels(points: number): number {
  return rounded(points * DOCX_LAYOUT_PIXELS_PER_INCH / POINTS_PER_INCH);
}

export function pointsToTwips(points: number): number {
  return Math.round(points * TWIPS_PER_POINT);
}

export function calculateDocxImageGroupRasterPlan(
  widthPoints: number,
  heightPoints: number,
): PreshotDocxRasterPlan {
  if (
    !Number.isFinite(widthPoints) ||
    widthPoints <= 0 ||
    !Number.isFinite(heightPoints) ||
    heightPoints <= 0
  ) {
    throw new Error("DOCX image-group display dimensions must be positive.");
  }

  const rawWidth =
    widthPoints / POINTS_PER_INCH * DOCX_IMAGE_GROUP_TARGET_PPI;
  const rawHeight =
    heightPoints / POINTS_PER_INCH * DOCX_IMAGE_GROUP_TARGET_PPI;
  const limit = Math.min(
    1,
    DOCX_IMAGE_GROUP_MAX_AXIS_PIXELS / rawWidth,
    DOCX_IMAGE_GROUP_MAX_AXIS_PIXELS / rawHeight,
    Math.sqrt(DOCX_IMAGE_GROUP_MAX_PIXELS / (rawWidth * rawHeight)),
  );
  const capped = limit < 1;
  const dimension = (value: number) =>
    Math.max(1, capped ? Math.floor(value * limit) : Math.round(value));
  let width = dimension(rawWidth);
  let height = dimension(rawHeight);

  while (
    width > DOCX_IMAGE_GROUP_MAX_AXIS_PIXELS ||
    height > DOCX_IMAGE_GROUP_MAX_AXIS_PIXELS ||
    width * height > DOCX_IMAGE_GROUP_MAX_PIXELS
  ) {
    if (width / rawWidth >= height / rawHeight) width -= 1;
    else height -= 1;
  }

  const effectivePpi = rounded(Math.min(
    width / (widthPoints / POINTS_PER_INCH),
    height / (heightPoints / POINTS_PER_INCH),
  ), 2);
  return {
    width,
    height,
    targetPpi: DOCX_IMAGE_GROUP_TARGET_PPI,
    effectivePpi,
    capped,
  };
}

function isPng(bytes: Readonly<Uint8Array>): boolean {
  return bytes.length > PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

export function buildPreshotDocxImageGroupCompositeRequest(
  block: PreshotImageGroupDocxBlock,
  exportContext: PreshotPdfExportContext,
): PreshotDocxImageGroupCompositeRequest | null {
  const blockId = block?.id;
  const groupId = block?.props?.groupId;
  if (
    !blockId ||
    block.type !== "imageGroup" ||
    typeof groupId !== "string" ||
    groupId.length === 0
  ) {
    renderError(
      "INVALID_BLOCK",
      `Cannot render DOCX image group: block "${blockId || "<missing>"}" must contain a non-empty groupId.`,
      { blockId: blockId || "<missing>", groupId: groupId || "<missing>" },
    );
  }

  const group = exportContext.groupsByBlockId[blockId];
  if (!group) {
    renderError(
      "MISSING_GROUP_CONTEXT",
      `Cannot render DOCX image group: missing export context for block "${blockId}", group "${groupId}".`,
      { blockId, groupId },
    );
  }
  if (group.groupId !== groupId) {
    renderError(
      "GROUP_CONTEXT_MISMATCH",
      `Cannot render DOCX image group: export context for block "${blockId}" resolves group "${group.groupId}", not "${groupId}".`,
      { blockId, groupId },
    );
  }
  if (group.empty) return null;
  if (
    !group.render ||
    group.slots.length === 0 ||
    typeof group.accessibility?.name !== "string" ||
    typeof group.accessibility?.description !== "string"
  ) {
    renderError(
      "INVALID_GROUP_CONTEXT",
      `Cannot render DOCX image group: non-empty block "${blockId}", group "${groupId}" has no renderable slots.`,
      { blockId, groupId },
    );
  }

  const usableHeightWithSafety = Math.max(
    1,
    exportContext.page.contentHeight -
      DOCX_IMAGE_GROUP_PAGE_SAFETY_POINTS,
  );
  const fittedHeight = Math.max(
    1,
    usableHeightWithSafety -
      DOCX_IMAGE_GROUP_PAGE_EPSILON_POINTS,
  );
  const docxPageHeightScale =
    group.pdf.unscaledFlowHeight > usableHeightWithSafety
      ? fittedHeight / group.pdf.unscaledFlowHeight
      : 1;
  const docxExportOnlyGroupPhysicalScale = Math.min(
    group.pdf.exportOnlyGroupPhysicalScale,
    docxPageHeightScale,
  );
  const geometryScale =
    docxExportOnlyGroupPhysicalScale /
    group.pdf.exportOnlyGroupPhysicalScale;
  const displayWidth = rounded(group.pdf.width * geometryScale);
  const displayHeight = rounded(group.pdf.flowHeight * geometryScale);
  const indent = rounded(group.pdf.x * geometryScale);
  const surfaceY = rounded(
    (
      group.pdf.flowTopPadding +
      Math.min(0, group.pdf.offsetY)
    ) * geometryScale,
  );

  const images = group.slots.map(
    (slot): PreshotDocxImageGroupCompositeImage => {
      const asset = exportContext.assetsById[slot.assetId];
      if (!asset) {
        renderError(
          "MISSING_OPTIMIZED_ASSET",
          `Cannot render DOCX image group: missing optimized asset "${slot.assetId}" for block "${blockId}", group "${groupId}", image "${slot.imageId}".`,
          {
            blockId,
            groupId,
            imageId: slot.imageId,
            assetId: slot.assetId,
          },
        );
      }
      if (
        !asset.mime.startsWith("image/") ||
        asset.bytes.length === 0
      ) {
        renderError(
          "INVALID_OPTIMIZED_ASSET",
          `Cannot render DOCX image group: optimized asset "${slot.assetId}" is invalid for block "${blockId}", group "${groupId}", image "${slot.imageId}".`,
          {
            blockId,
            groupId,
            imageId: slot.imageId,
            assetId: slot.assetId,
          },
        );
      }
      return {
        imageId: slot.imageId,
        assetId: slot.assetId,
        crop: slot.crop,
        xPoints: rounded(slot.pdf.x * geometryScale),
        yPoints: rounded(surfaceY + slot.pdf.y * geometryScale),
        widthPoints: rounded(slot.pdf.width * geometryScale),
        heightPoints: rounded(slot.pdf.height * geometryScale),
        backgroundColor: exportContext.colors.imageFrame,
        borderColor: exportContext.colors.border,
        borderWidthPoints: rounded(
          exportContext.borders.hairline * geometryScale,
        ),
        borderRadiusPoints: rounded(
          exportContext.borders.radius * geometryScale,
        ),
        asset: {
          mime: asset.mime,
          bytes: asset.bytes,
        },
      };
    },
  );

  return {
    blockId,
    groupId,
    display: {
      widthPoints: displayWidth,
      heightPoints: displayHeight,
      indentPoints: indent,
    },
    raster: calculateDocxImageGroupRasterPlan(
      displayWidth,
      displayHeight,
    ),
    backgroundColor: exportContext.colors.paper,
    surface: {
      xPoints: 0,
      yPoints: surfaceY,
      widthPoints: displayWidth,
      heightPoints: rounded(group.pdf.displayedHeight * geometryScale),
      backgroundColor: exportContext.colors.softSurface,
      borderColor: exportContext.colors.border,
      borderWidthPoints: rounded(
        exportContext.borders.hairline * geometryScale,
      ),
      borderRadiusPoints: rounded(
        exportContext.borders.radius * geometryScale,
      ),
    },
    images,
  };
}

function accessibleText(value: string, fallback: string): string {
  const trimmed = value.trim();
  return trimmed || fallback;
}

export function createPreshotImageGroupDocxBlockMapping(
  exportContext: PreshotPdfExportContext,
  options: PreshotImageGroupDocxMappingOptions,
): PreshotImageGroupDocxBlockMapping {
  return async (block) => {
    const request = options.requestsByBlockId?.[block.id] ??
      buildPreshotDocxImageGroupCompositeRequest(block, exportContext);
    if (!request) return [];

    if (
      request.raster.effectivePpi <
      DOCX_IMAGE_GROUP_MINIMUM_PPI
    ) {
      await options.onWarning?.({
        severity: "warning",
        code: "LOW_EFFECTIVE_PPI",
        message:
          `DOCX image group "${request.groupId}" was rasterized at ${request.raster.effectivePpi} PPI after safety caps.`,
        blockId: request.blockId,
        groupId: request.groupId,
        effectivePpi: request.raster.effectivePpi,
      });
    }

    let png: Readonly<Uint8Array>;
    try {
      png = await options.compositor(request);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      renderError(
        "COMPOSITOR_FAILED",
        `Cannot render DOCX image group: compositor failed for block "${request.blockId}", group "${request.groupId}": ${reason}`,
        {
          blockId: request.blockId,
          groupId: request.groupId,
        },
      );
    }
    if (!isPng(png)) {
      renderError(
        "INVALID_COMPOSITE_PNG",
        `Cannot render DOCX image group: compositor returned invalid PNG bytes for block "${request.blockId}", group "${request.groupId}".`,
        {
          blockId: request.blockId,
          groupId: request.groupId,
        },
      );
    }

    const group = exportContext.groupsByBlockId[request.blockId];
    const name = accessibleText(
      group.accessibility.name,
      "Image group",
    );
    const description = accessibleText(
      group.accessibility.description,
      name,
    );
    return new Paragraph({
      children: [
        new PreshotCompositeImageRun({
          data: Uint8Array.from(png),
          type: "png",
          altText: {
            name,
            title: name,
            description,
          },
          transformation: {
            width: pointsToDocxLayoutPixels(
              request.display.widthPoints,
            ),
            height: pointsToDocxLayoutPixels(
              request.display.heightPoints,
            ),
          },
        }),
      ],
      keepLines: true,
      keepNext: false,
      pageBreakBefore: false,
      spacing: {
        before: 0,
        after: 0,
      },
      indent: request.display.indentPoints > 0
        ? { left: pointsToTwips(request.display.indentPoints) }
        : undefined,
    });
  };
}

export function injectPreshotImageGroupDocxBlockMapping<
  OrdinaryMappings extends Readonly<Record<string, unknown>>,
>(
  ordinaryMappings: OrdinaryMappings,
  exportContext: PreshotPdfExportContext,
  options: PreshotImageGroupDocxMappingOptions,
): OrdinaryMappings & {
  readonly imageGroup: PreshotImageGroupDocxBlockMapping;
} {
  return {
    ...ordinaryMappings,
    imageGroup: createPreshotImageGroupDocxBlockMapping(
      exportContext,
      options,
    ),
  };
}
