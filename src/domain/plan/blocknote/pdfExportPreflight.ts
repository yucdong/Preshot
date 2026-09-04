import {
  type PreshotBlock,
  type ProjectPlanV14,
  validateProjectPlanV14,
} from "../canvas/blockDocument";
import {
  DOCUMENT_IMAGE_GROUP_GAP,
  DOCUMENT_IMAGE_GROUP_INSET,
  layoutDocumentImageGroupForWidth,
} from "../canvas/documentImageGroupLayout";
import type {
  ReferenceComponent,
  ReferenceImage,
} from "../canvas/models";
import {
  PDF_VISUAL_CONTRACT,
  calculatePdfColumnWidths,
  editorLogicalUnits,
  fitKeepTogetherGroupScaleToPage,
  pdfPoints,
  type EditorLogicalUnits,
  type PdfPoints,
  type PdfScale,
} from "./pdfVisualContract";
import {
  fitPdfImageCaptionToPage,
  type PdfCaptionTextMeasurer,
} from "./pdfCaptionLayout";

const NUMBER_PRECISION = 4;
const CROP_PRECISION = 6;
const REFERENCE_SOURCE = /^references\/[^/\\]+$/i;
const NATIVE_IMAGE_SOURCE = /^media\/[^/\\]+$/i;
const PDF_PAGINATION_EPSILON = 0.01;
const PDF_EMERGENCY_ROW_SAFETY = 0.1;

export const PDF_IMAGE_GROUP_MIN_EMERGENCY_ROW_SCALE = 0.25;
export const PDF_IMAGE_GROUP_EMERGENCY_ROW_SCALE_EPSILON =
  Number.EPSILON * 8;

export function acceptsPdfImageGroupEmergencyRowScale(
  requiredScale: number,
): boolean {
  return requiredScale >=
    PDF_IMAGE_GROUP_MIN_EMERGENCY_ROW_SCALE -
      PDF_IMAGE_GROUP_EMERGENCY_ROW_SCALE_EPSILON;
}

const round = (value: number, precision = NUMBER_PRECISION): number => {
  const rounded = Number(value.toFixed(precision));
  return Object.is(rounded, -0) ? 0 : rounded;
};

const logicalUnits = (value: number): EditorLogicalUnits =>
  editorLogicalUnits(round(value));
const points = (value: number): PdfPoints => pdfPoints(round(value));
const scale = (value: number): PdfScale => value as PdfScale;

export type PreshotPdfPreflightIssueCode =
  | "CORRUPT_IMAGE_ASSET"
  | "DUPLICATE_IMAGE_GROUP"
  | "EMPTY_IMAGE_GROUP_SKIPPED"
  | "IMAGE_GROUP_ROW_SCALE_BELOW_MINIMUM"
  | "INVALID_BLOCKNOTE_SCHEMA"
  | "INVALID_DOCUMENT"
  | "INVALID_IMAGE_GROUP"
  | "INVALID_IMAGE_GROUP_MARKER"
  | "INVALID_IMAGE_METADATA"
  | "INVALID_IMAGE_SOURCE"
  | "MISSING_IMAGE_ASSET";

export interface PreshotPdfPreflightIssue {
  readonly severity: "warning" | "fatal";
  readonly code: PreshotPdfPreflightIssueCode;
  readonly message: string;
  readonly blockId?: string;
  readonly groupId?: string;
  readonly imageId?: string;
  readonly rowIndex?: number;
  readonly requiredScale?: number;
  readonly minimumScale?: number;
  readonly source?: string;
}

export class PreshotPdfPreflightError extends Error {
  constructor(readonly fatalErrors: readonly PreshotPdfPreflightIssue[]) {
    super(fatalErrors.map((issue) => issue.message).join("\n"));
    this.name = "PreshotPdfPreflightError";
  }
}

export interface PreshotPdfBlockContext {
  readonly order: number;
  readonly blockId: string;
  readonly blockType: PreshotBlock["type"];
  readonly path: readonly number[];
  readonly parentBlockId: string | null;
  readonly columnListBlockId: string | null;
  readonly columnBlockId: string | null;
  readonly logicalParentWidth: EditorLogicalUnits;
  readonly pdfParentWidth: PdfPoints;
  readonly logicalToPdfScale: PdfScale;
}

export interface PreshotPdfColumnContext {
  readonly columnListBlockId: string;
  readonly columnBlockId: string;
  readonly index: number;
  readonly weight: number;
  readonly logicalWidth: EditorLogicalUnits;
  readonly pdfWidth: PdfPoints;
  readonly logicalToPdfScale: PdfScale;
}

export interface PreshotPdfColumnListContext {
  readonly blockId: string;
  readonly logicalWidth: EditorLogicalUnits;
  readonly pdfWidth: PdfPoints;
  readonly logicalGap: EditorLogicalUnits;
  readonly pdfGap: PdfPoints;
  readonly columns: readonly PreshotPdfColumnContext[];
}

export interface PreshotPdfNormalizedCrop {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PreshotPdfDrawBox {
  readonly width: PdfPoints;
  readonly height: PdfPoints;
}

export interface PreshotPdfAssetUse {
  readonly blockId: string;
  readonly groupId?: string;
  readonly imageId?: string;
  readonly kind: "image-group" | "native-image";
  readonly drawBox: PreshotPdfDrawBox;
}

export interface PreshotPdfAssetRequest {
  readonly assetId: string;
  readonly cacheKey: string;
  readonly source: string;
  readonly crop: PreshotPdfNormalizedCrop;
  readonly largestDrawBox: PreshotPdfDrawBox;
  readonly uses: readonly PreshotPdfAssetUse[];
}

export interface PreshotPdfImageSlotContext {
  readonly imageId: string;
  readonly rowIndex: number;
  readonly source: string;
  readonly assetId: string;
  readonly crop: PreshotPdfNormalizedCrop;
  readonly logical: {
    readonly x: EditorLogicalUnits;
    readonly y: EditorLogicalUnits;
    readonly width: EditorLogicalUnits;
    readonly height: EditorLogicalUnits;
  };
  readonly pdf: {
    readonly x: PdfPoints;
    readonly y: PdfPoints;
    readonly width: PdfPoints;
    readonly height: PdfPoints;
  };
}

export interface PreshotPdfImageGroupRowContext {
  readonly index: number;
  readonly imageIds: readonly string[];
  readonly logical: {
    readonly y: EditorLogicalUnits;
    readonly height: EditorLogicalUnits;
  };
  readonly pdf: {
    readonly y: PdfPoints;
    readonly height: PdfPoints;
    readonly renderedHeight: PdfPoints;
  };
  readonly emergencyScale: PdfScale;
}

export interface PreshotPdfImageGroupFragmentContext {
  readonly index: number;
  readonly rowIndexes: readonly number[];
  readonly imageIds: readonly string[];
  readonly flowTopPadding: PdfPoints;
  readonly surfaceHeight: PdfPoints;
  readonly flowHeight: PdfPoints;
}

export interface PreshotPdfImageGroupPaginationContext {
  readonly mode: "keep-together" | "row-fragments";
  readonly usableContentHeight: PdfPoints;
  readonly startsOnFreshPage: boolean;
  readonly minimumEmergencyRowScale: number;
  readonly rows: readonly PreshotPdfImageGroupRowContext[];
  readonly fragments: readonly PreshotPdfImageGroupFragmentContext[];
}

export interface PreshotPdfImageGroupContext {
  readonly blockId: string;
  readonly groupId: string;
  readonly accessibility: {
    readonly name: string;
    readonly description: string;
  };
  readonly order: number;
  readonly empty: boolean;
  readonly render: boolean;
  readonly parent: {
    readonly columnListBlockId: string | null;
    readonly columnBlockId: string | null;
    readonly logicalWidth: EditorLogicalUnits;
    readonly pdfWidth: PdfPoints;
    readonly logicalToPdfScale: PdfScale;
  };
  readonly logical: {
    readonly x: EditorLogicalUnits;
    readonly width: EditorLogicalUnits;
    readonly displayedHeight: EditorLogicalUnits;
    readonly persistedHeight: EditorLogicalUnits;
    readonly offsetY: EditorLogicalUnits;
    readonly flowTopPadding: EditorLogicalUnits;
    readonly flowHeight: EditorLogicalUnits;
    readonly layoutScale: number;
  };
  readonly pdf: {
    readonly x: PdfPoints;
    readonly width: PdfPoints;
    readonly unscaledHeight: PdfPoints;
    readonly unscaledFlowHeight: PdfPoints;
    readonly displayedHeight: PdfPoints;
    readonly offsetY: PdfPoints;
    readonly flowTopPadding: PdfPoints;
    readonly flowHeight: PdfPoints;
    readonly horizontalFitScale: PdfScale;
    readonly inset: PdfPoints;
    readonly gap: PdfPoints;
  };
  readonly docx: {
    readonly exportOnlyGroupPhysicalScale: PdfScale;
  };
  readonly keepTogether: {
    readonly enabled: boolean;
    readonly scope: "block" | "column-row";
    readonly moveToNextPageIfNeeded: boolean;
  };
  readonly pagination: PreshotPdfImageGroupPaginationContext;
  readonly slots: readonly PreshotPdfImageSlotContext[];
}

export interface PreshotPdfNativeImageContext {
  readonly blockId: string;
  readonly source: string;
  readonly assetId: string;
  readonly logicalWidth: EditorLogicalUnits;
  readonly logicalHeight: EditorLogicalUnits;
  readonly pdfWidth: PdfPoints;
  readonly pdfHeight: PdfPoints;
  readonly blockWidth: PdfPoints;
  readonly captionWidth: PdfPoints;
  readonly captionLines: readonly string[];
  readonly captionHeight: PdfPoints;
  readonly blockSpacing: PdfPoints;
  readonly blockHeight: PdfPoints;
  readonly keepTogether: {
    readonly enabled: true;
    readonly moveToNextPageIfNeeded: true;
  };
}

export interface PreshotPdfLayoutManifest {
  readonly version: 2;
  readonly blocks: readonly PreshotPdfBlockContext[];
  readonly blocksById: Readonly<Record<string, PreshotPdfBlockContext>>;
  readonly columnLists: readonly PreshotPdfColumnListContext[];
  readonly groups: readonly PreshotPdfImageGroupContext[];
  readonly groupsByBlockId: Readonly<
    Record<string, PreshotPdfImageGroupContext>
  >;
  readonly groupsByGroupId: Readonly<
    Record<string, PreshotPdfImageGroupContext>
  >;
  readonly nativeImagesByBlockId: Readonly<
    Record<string, PreshotPdfNativeImageContext>
  >;
  readonly assetRequests: readonly PreshotPdfAssetRequest[];
  readonly page: typeof PDF_VISUAL_CONTRACT.page;
  readonly typography: typeof PDF_VISUAL_CONTRACT.typography;
  readonly spacing: typeof PDF_VISUAL_CONTRACT.spacing;
  readonly colors: typeof PDF_VISUAL_CONTRACT.colors;
  readonly borders: typeof PDF_VISUAL_CONTRACT.borders;
  readonly warnings: readonly PreshotPdfPreflightIssue[];
  readonly fatalErrors: readonly PreshotPdfPreflightIssue[];
}

export interface PreshotPdfOptimizedAsset {
  readonly assetId: string;
  readonly cacheKey: string;
  readonly source: string;
  readonly crop: PreshotPdfNormalizedCrop;
  readonly drawBox: PreshotPdfDrawBox;
  readonly dpi: 144;
  readonly mime: string;
  readonly bytes: Readonly<Uint8Array>;
  readonly uses: readonly PreshotPdfAssetUse[];
}

export interface PreshotPdfExportContext<Schema = unknown>
  extends PreshotPdfLayoutManifest {
  readonly schema: Schema;
  readonly assets: readonly PreshotPdfOptimizedAsset[];
  readonly assetsById: Readonly<Record<string, PreshotPdfOptimizedAsset>>;
}

export interface NativeImageDimensions {
  readonly width: number;
  readonly height: number;
}

interface ParentDimensions {
  logicalWidth: EditorLogicalUnits;
  pdfWidth: PdfPoints;
  logicalToPdfScale: PdfScale;
  columnListBlockId: string | null;
  columnBlockId: string | null;
}

interface MutableAssetRequest {
  source: string;
  crop: PreshotPdfNormalizedCrop;
  largestDrawBox: PreshotPdfDrawBox;
  uses: PreshotPdfAssetUse[];
}

interface MutableGroupContext extends Omit<PreshotPdfImageGroupContext, "slots"> {
  slots: Array<Omit<PreshotPdfImageSlotContext, "assetId"> & {
    assetKey: string;
  }>;
}

function freezeManifest<T>(value: T, excluded: ReadonlySet<unknown>): T {
  if (
    value === null ||
    typeof value !== "object" ||
    excluded.has(value) ||
    ArrayBuffer.isView(value) ||
    Object.isFrozen(value)
  ) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    freezeManifest(child, excluded);
  }
  return value;
}

export function freezePreshotPdfExportContext<T>(
  value: T,
  excluded: readonly unknown[] = [],
): T {
  return freezeManifest(value, new Set(excluded));
}

function cloneContractSection<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function fatal(
  code: PreshotPdfPreflightIssueCode,
  message: string,
  context: Omit<PreshotPdfPreflightIssue, "severity" | "code" | "message"> = {},
): never {
  throw new PreshotPdfPreflightError([{
    severity: "fatal",
    code,
    message,
    ...context,
  }]);
}

function buildImageGroupPagination(input: {
  blockId: string;
  groupId: string;
  displayedHeight: number;
  layoutHeight: number;
  finalScale: number;
  flowTopPadding: PdfPoints;
  pageHeight: PdfPoints;
  rows: readonly {
    index: number;
    y: number;
    height: number;
    imageIds: readonly string[];
  }[];
}): PreshotPdfImageGroupPaginationContext {
  interface MutablePaginationRow {
    index: number;
    imageIds: string[];
    logical: {
      y: EditorLogicalUnits;
      height: EditorLogicalUnits;
    };
    pdf: {
      y: PdfPoints;
      height: PdfPoints;
      renderedHeight: PdfPoints;
    };
    emergencyScale: PdfScale;
  }
  const inset = points(DOCUMENT_IMAGE_GROUP_INSET * input.finalScale);
  const gap = points(DOCUMENT_IMAGE_GROUP_GAP * input.finalScale);
  const naturalSurfaceHeight = points(
    input.displayedHeight * input.finalScale,
  );
  const naturalFlowHeight = points(
    naturalSurfaceHeight + input.flowTopPadding,
  );
  const rows: MutablePaginationRow[] = input.rows.map((row) => ({
    index: row.index,
    imageIds: [...row.imageIds],
    logical: {
      y: logicalUnits(row.y),
      height: logicalUnits(row.height),
    },
    pdf: {
      y: points(row.y * input.finalScale),
      height: points(row.height * input.finalScale),
      renderedHeight: points(row.height * input.finalScale),
    },
    emergencyScale: scale(1),
  }));
  const common = {
    usableContentHeight: input.pageHeight,
    minimumEmergencyRowScale: PDF_IMAGE_GROUP_MIN_EMERGENCY_ROW_SCALE,
    rows,
  } as const;

  if (
    naturalFlowHeight <= input.pageHeight + PDF_PAGINATION_EPSILON
  ) {
    return {
      ...common,
      mode: "keep-together",
      startsOnFreshPage: false,
      fragments: [{
        index: 0,
        rowIndexes: rows.map((row) => row.index),
        imageIds: rows.flatMap((row) => row.imageIds),
        flowTopPadding: input.flowTopPadding,
        surfaceHeight: naturalSurfaceHeight,
        flowHeight: naturalFlowHeight,
      }],
    };
  }

  for (const row of rows) {
    const rowTopPadding = row.index === 0 ? input.flowTopPadding : 0;
    const availableRowHeight =
      input.pageHeight -
      rowTopPadding -
      inset * 2 -
      PDF_EMERGENCY_ROW_SAFETY;
    if (availableRowHeight <= 0) {
      fatal(
        "INVALID_IMAGE_GROUP",
        `PDF preflight cannot paginate block "${input.blockId}", group "${input.groupId}": positive top padding leaves no usable height for row ${row.index + 1}.`,
        { blockId: input.blockId, groupId: input.groupId },
      );
    }
    if (row.pdf.height > availableRowHeight + PDF_PAGINATION_EPSILON) {
      const emergencyScale = availableRowHeight / row.pdf.height;
      if (!acceptsPdfImageGroupEmergencyRowScale(emergencyScale)) {
        fatal(
          "IMAGE_GROUP_ROW_SCALE_BELOW_MINIMUM",
          `PDF preflight cannot paginate block "${input.blockId}", group "${input.groupId}", row ${row.index + 1}: fitting the indivisible row requires scale ${round(emergencyScale, CROP_PRECISION)}, below the minimum emergency scale ${PDF_IMAGE_GROUP_MIN_EMERGENCY_ROW_SCALE}.`,
          {
            blockId: input.blockId,
            groupId: input.groupId,
            rowIndex: row.index,
            requiredScale: emergencyScale,
            minimumScale: PDF_IMAGE_GROUP_MIN_EMERGENCY_ROW_SCALE,
          },
        );
      }
      row.emergencyScale = scale(emergencyScale);
      row.pdf.renderedHeight = points(row.pdf.height * emergencyScale);
    }
  }

  interface MutableFragment {
    rowIndexes: number[];
    imageIds: string[];
    flowTopPadding: PdfPoints;
    surfaceHeight: number;
  }
  const fragments: MutableFragment[] = [];
  let current: MutableFragment | undefined;
  for (const row of rows) {
    const flowTopPadding = fragments.length === 0
      ? input.flowTopPadding
      : points(0);
    const nextSurfaceHeight = current
      ? current.surfaceHeight + gap + row.pdf.renderedHeight
      : inset * 2 + row.pdf.renderedHeight;
    const nextFlowHeight = nextSurfaceHeight + (
      current?.flowTopPadding ?? flowTopPadding
    );
    if (
      current &&
      nextFlowHeight > input.pageHeight + PDF_PAGINATION_EPSILON
    ) {
      fragments.push(current);
      current = undefined;
    }
    if (!current) {
      const fragmentTopPadding = fragments.length === 0
        ? input.flowTopPadding
        : points(0);
      current = {
        rowIndexes: [row.index],
        imageIds: [...row.imageIds],
        flowTopPadding: fragmentTopPadding,
        surfaceHeight: inset * 2 + row.pdf.renderedHeight,
      };
    } else {
      current.rowIndexes.push(row.index);
      current.imageIds.push(...row.imageIds);
      current.surfaceHeight += gap + row.pdf.renderedHeight;
    }
  }
  if (current) fragments.push(current);

  const hasEmergencyRow = rows.some((row) => row.emergencyScale < 1);
  let trailingSurfaceHeight = Math.max(
    0,
    naturalSurfaceHeight - points(input.layoutHeight * input.finalScale),
  );
  for (
    let index = fragments.length - 1;
    index >= 0 && trailingSurfaceHeight > PDF_PAGINATION_EPSILON;
    index -= 1
  ) {
    const fragment = fragments[index];
    const available =
      input.pageHeight -
      fragment.flowTopPadding -
      fragment.surfaceHeight;
    const addition = Math.min(trailingSurfaceHeight, Math.max(0, available));
    fragment.surfaceHeight += addition;
    trailingSurfaceHeight -= addition;
  }
  if (trailingSurfaceHeight > PDF_PAGINATION_EPSILON) {
    if (!hasEmergencyRow) {
      fatal(
        "INVALID_IMAGE_GROUP",
        `PDF preflight cannot paginate block "${input.blockId}", group "${input.groupId}": trailing group surface exceeds page-safe row-fragment capacity by ${round(trailingSurfaceHeight)} points.`,
        { blockId: input.blockId, groupId: input.groupId },
      );
    }
  }

  return {
    ...common,
    mode: "row-fragments",
    startsOnFreshPage: true,
    fragments: fragments.map((fragment, index) => ({
      index,
      rowIndexes: fragment.rowIndexes,
      imageIds: fragment.imageIds,
      flowTopPadding: fragment.flowTopPadding,
      surfaceHeight: points(fragment.surfaceHeight),
      flowHeight: points(
        fragment.flowTopPadding + fragment.surfaceHeight,
      ),
    })),
  };
}

export function validatePreshotPdfPlan(
  plan: ProjectPlanV14,
): ProjectPlanV14 {
  try {
    return validateProjectPlanV14(plan);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = message.includes("image group id") &&
        message.includes("unique")
      ? "DUPLICATE_IMAGE_GROUP"
      : message.includes("image group") &&
          (
            message.includes("exactly once") ||
            message.includes("references missing") ||
            message.includes("references image group")
          )
        ? "INVALID_IMAGE_GROUP_MARKER"
        : "INVALID_DOCUMENT";
    fatal(code, `PDF preflight rejected the BlockNote document: ${message}`);
  }
}

function positiveFinite(value: number, label: string, context: {
  blockId: string;
  groupId: string;
  imageId?: string;
}): number {
  if (!Number.isFinite(value) || value <= 0) {
    fatal(
      context.imageId ? "INVALID_IMAGE_METADATA" : "INVALID_IMAGE_GROUP",
      `PDF preflight rejected ${label} for block "${context.blockId}", group "${context.groupId}"${
        context.imageId ? `, image "${context.imageId}"` : ""
      }: expected a finite positive number.`,
      context,
    );
  }
  return value;
}

function finite(value: number | undefined, fallback: number, label: string, context: {
  blockId: string;
  groupId: string;
  imageId?: string;
}): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved)) {
    fatal(
      context.imageId ? "INVALID_IMAGE_METADATA" : "INVALID_IMAGE_GROUP",
      `PDF preflight rejected ${label} for block "${context.blockId}", group "${context.groupId}"${
        context.imageId ? `, image "${context.imageId}"` : ""
      }: expected a finite number.`,
      context,
    );
  }
  return resolved;
}

export function normalizePdfCrop(
  crop: ReferenceImage["crop"],
  context?: { blockId: string; groupId: string; imageId: string },
): PreshotPdfNormalizedCrop {
  const value = crop ?? { x: 0, y: 0, width: 1, height: 1 };
  if (
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.y) ||
    !Number.isFinite(value.width) ||
    !Number.isFinite(value.height) ||
    value.x < 0 ||
    value.y < 0 ||
    value.width <= 0 ||
    value.height <= 0 ||
    value.x + value.width > 1.000001 ||
    value.y + value.height > 1.000001
  ) {
    if (context) {
      fatal(
        "INVALID_IMAGE_METADATA",
        `PDF preflight rejected crop metadata for block "${context.blockId}", group "${context.groupId}", image "${context.imageId}": normalized crop bounds must stay within the source image.`,
        context,
      );
    }
    fatal(
      "INVALID_IMAGE_METADATA",
      "PDF preflight rejected invalid normalized crop metadata.",
    );
  }
  return {
    x: round(value.x, CROP_PRECISION),
    y: round(value.y, CROP_PRECISION),
    width: round(value.width, CROP_PRECISION),
    height: round(value.height, CROP_PRECISION),
  };
}

function cropKey(crop: PreshotPdfNormalizedCrop): string {
  return `${crop.x},${crop.y},${crop.width},${crop.height}`;
}

function assetKey(source: string, crop: PreshotPdfNormalizedCrop): string {
  return `${source}|${cropKey(crop)}`;
}

function largerDrawBox(
  first: PreshotPdfDrawBox,
  second: PreshotPdfDrawBox,
): PreshotPdfDrawBox {
  return {
    width: points(Math.max(first.width, second.width)),
    height: points(Math.max(first.height, second.height)),
  };
}

function weightedLogicalWidths(
  weights: readonly number[],
  containerWidth: EditorLogicalUnits,
  gap: EditorLogicalUnits,
): EditorLogicalUnits[] {
  const availableWidth = containerWidth - gap * (weights.length - 1);
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  const widths = weights.slice(0, -1).map((weight) =>
    logicalUnits(availableWidth * weight / totalWeight)
  );
  const allocated = widths.reduce<number>((total, width) => total + width, 0);
  widths.push(logicalUnits(availableWidth - allocated));
  return widths;
}

function validateGroup(
  group: ReferenceComponent,
  blockId: string,
): void {
  const groupContext = { blockId, groupId: group.id };
  if (
    typeof group.name !== "string" ||
    typeof group.description !== "string" ||
    !Array.isArray(group.images)
  ) {
    fatal(
      "INVALID_IMAGE_GROUP",
      `PDF preflight rejected block "${blockId}", group "${group.id}": image-group metadata is malformed.`,
      groupContext,
    );
  }
  finite(group.x, 0, "image-group x", groupContext);
  positiveFinite(group.width, "image-group width", groupContext);
  positiveFinite(group.height, "image-group height", groupContext);
  finite(group.frameOffsetY, 0, "image-group vertical offset", groupContext);
  const imageIds = new Set<string>();
  for (const image of group.images) {
    if (typeof image !== "object" || image === null) {
      fatal(
        "INVALID_IMAGE_METADATA",
        `PDF preflight rejected block "${blockId}", group "${group.id}": image metadata is malformed.`,
        groupContext,
      );
    }
    const context = { ...groupContext, imageId: image.id };
    if (!image.id || imageIds.has(image.id)) {
      fatal(
        "INVALID_IMAGE_METADATA",
        `PDF preflight rejected block "${blockId}", group "${group.id}": image IDs must be non-empty and unique; duplicate "${image.id}".`,
        context,
      );
    }
    imageIds.add(image.id);
    if (!REFERENCE_SOURCE.test(image.file)) {
      fatal(
        "INVALID_IMAGE_SOURCE",
        `PDF preflight rejected block "${blockId}", group "${group.id}", image "${image.id}": source must be a project-owned references/<file> path.`,
        context,
      );
    }
    positiveFinite(image.aspectRatio, "image aspect ratio", context);
    positiveFinite(image.frameWidth, "image frame width", context);
    positiveFinite(image.frameHeight, "image frame height", context);
    finite(image.frameOffsetX, 0, "image horizontal offset", context);
    finite(image.frameOffsetY, 0, "image vertical offset", context);
    if (image.sourceWidth !== undefined) {
      positiveFinite(image.sourceWidth, "source pixel width", context);
    }
    if (image.sourceHeight !== undefined) {
      positiveFinite(image.sourceHeight, "source pixel height", context);
    }
    normalizePdfCrop(image.crop, context);
  }
}

export function buildPreshotPdfLayoutManifest(
  input: {
    readonly plan: ProjectPlanV14;
    readonly nativeImageDimensions?: Readonly<
      Record<string, NativeImageDimensions>
    >;
    readonly measureCaptionText?: PdfCaptionTextMeasurer;
    readonly visualContract?: typeof PDF_VISUAL_CONTRACT;
  },
): PreshotPdfLayoutManifest {
  const plan = validatePreshotPdfPlan(input.plan);
  const visualContract = input.visualContract ?? PDF_VISUAL_CONTRACT;
  const blocks: PreshotPdfBlockContext[] = [];
  const columnLists: PreshotPdfColumnListContext[] = [];
  const groups: MutableGroupContext[] = [];
  const nativeImages: PreshotPdfNativeImageContext[] = [];
  const warnings: PreshotPdfPreflightIssue[] = [];
  const assetRequests = new Map<string, MutableAssetRequest>();
  const groupsById = new Map(
    plan.imageGroups.map((group) => [group.id, group]),
  );
  let order = 0;

  const addAssetUse = (
    source: string,
    crop: PreshotPdfNormalizedCrop,
    use: PreshotPdfAssetUse,
  ): string => {
    const key = assetKey(source, crop);
    const existing = assetRequests.get(key);
    if (existing) {
      existing.largestDrawBox = largerDrawBox(
        existing.largestDrawBox,
        use.drawBox,
      );
      existing.uses.push(use);
    } else {
      assetRequests.set(key, {
        source,
        crop,
        largestDrawBox: use.drawBox,
        uses: [use],
      });
    }
    return key;
  };

  const root: ParentDimensions = {
    logicalWidth: visualContract.editor.contentWidth,
    pdfWidth: visualContract.page.contentWidth,
    logicalToPdfScale: visualContract.editor.rootLogicalToPdfScale,
    columnListBlockId: null,
    columnBlockId: null,
  };

  const visit = (
    documentBlocks: readonly PreshotBlock[],
    parent: ParentDimensions,
    parentBlockId: string | null,
    path: readonly number[],
  ): void => {
    documentBlocks.forEach((block, index) => {
      const blockPath = [...path, index];
      const blockOrder = order;
      order += 1;
      blocks.push({
        order: blockOrder,
        blockId: block.id,
        blockType: block.type,
        path: blockPath,
        parentBlockId,
        columnListBlockId: parent.columnListBlockId,
        columnBlockId: parent.columnBlockId,
        logicalParentWidth: parent.logicalWidth,
        pdfParentWidth: parent.pdfWidth,
        logicalToPdfScale: parent.logicalToPdfScale,
      });

      if (block.type === "columnList") {
        const weights = block.children.map((column) =>
          Number(column.props.width)
        );
        const logicalGap = logicalUnits(
          visualContract.columns.gap / parent.logicalToPdfScale,
        );
        const logicalWidths = weightedLogicalWidths(
          weights,
          parent.logicalWidth,
          logicalGap,
        );
        const pdfWidths = calculatePdfColumnWidths(
          weights,
          parent.pdfWidth,
          visualContract.columns.gap,
        );
        const columns = block.children.map((column, columnIndex) => ({
          columnListBlockId: block.id,
          columnBlockId: column.id,
          index: columnIndex,
          weight: weights[columnIndex],
          logicalWidth: logicalWidths[columnIndex],
          pdfWidth: pdfWidths[columnIndex],
          logicalToPdfScale: scale(
            pdfWidths[columnIndex] / logicalWidths[columnIndex],
          ),
        }));
        columnLists.push({
          blockId: block.id,
          logicalWidth: parent.logicalWidth,
          pdfWidth: parent.pdfWidth,
          logicalGap,
          pdfGap: visualContract.columns.gap,
          columns,
        });
        block.children.forEach((column, columnIndex) => {
          const columnContext = columns[columnIndex];
          const columnOrder = order;
          order += 1;
          blocks.push({
            order: columnOrder,
            blockId: column.id,
            blockType: column.type,
            path: [...blockPath, columnIndex],
            parentBlockId: block.id,
            columnListBlockId: block.id,
            columnBlockId: column.id,
            logicalParentWidth: columnContext.logicalWidth,
            pdfParentWidth: columnContext.pdfWidth,
            logicalToPdfScale: columnContext.logicalToPdfScale,
          });
          visit(
            column.children,
            {
              logicalWidth: columnContext.logicalWidth,
              pdfWidth: columnContext.pdfWidth,
              logicalToPdfScale: columnContext.logicalToPdfScale,
              columnListBlockId: block.id,
              columnBlockId: column.id,
            },
            column.id,
            [...blockPath, columnIndex],
          );
        });
        return;
      }

      if (block.type === "column") {
        return;
      }

      if (block.type === "imageGroup") {
        const groupId = String(block.props.groupId);
        const group = groupsById.get(groupId);
        if (!group) {
          fatal(
            "INVALID_IMAGE_GROUP_MARKER",
            `PDF preflight rejected image-group block "${block.id}": group "${groupId}" is missing.`,
            { blockId: block.id, groupId },
          );
        }
        validateGroup(group, block.id);
        const empty = group.images.length === 0;
        if (empty) {
          warnings.push({
            severity: "warning",
            code: "EMPTY_IMAGE_GROUP_SKIPPED",
            message:
              `PDF preflight will skip empty image-group block "${block.id}", group "${group.id}", while preserving its document order.`,
            blockId: block.id,
            groupId: group.id,
          });
        }
        const displayedWidth = Math.max(
          1,
          Math.min(group.width, parent.logicalWidth),
        );
        const displayedX = Math.max(
          0,
          Math.min(group.x, Math.max(0, parent.logicalWidth - displayedWidth)),
        );
        const layout = empty
          ? { scale: 1, height: 0, rows: [], slots: [] }
          : layoutDocumentImageGroupForWidth(group.images, displayedWidth);
        const displayedHeight = empty
          ? group.height
          : Math.max(group.height, layout.height);
        const contentWidth = layout.slots.reduce(
          (maximum, slot) =>
            Math.max(
              maximum,
              DOCUMENT_IMAGE_GROUP_INSET * 2 + slot.x + slot.width,
            ),
          displayedWidth,
        );
        const unscaledPdfWidth = points(
          contentWidth * parent.logicalToPdfScale,
        );
        const rawUnscaledPdfHeight =
          displayedHeight * parent.logicalToPdfScale;
        const unscaledPdfHeight = points(rawUnscaledPdfHeight);
        const positiveOffset = Math.max(0, group.frameOffsetY ?? 0);
        const rawUnscaledFlowTopPadding =
          positiveOffset * parent.logicalToPdfScale;
        const rawUnscaledFlowHeight =
          rawUnscaledPdfHeight + rawUnscaledFlowTopPadding;
        const unscaledFlowHeight = points(rawUnscaledFlowHeight);
        const unscaledRightEdge = points(
          (displayedX + contentWidth) * parent.logicalToPdfScale,
        );
        const horizontalFitScale = !empty &&
            unscaledRightEdge > parent.pdfWidth
          ? scale(parent.pdfWidth / unscaledRightEdge)
          : scale(1);
        const docxExportOnlyGroupPhysicalScale = !empty &&
            (
              unscaledRightEdge > parent.pdfWidth ||
              rawUnscaledFlowHeight > visualContract.page.contentHeight
            )
          ? fitKeepTogetherGroupScaleToPage(
              {
                width: unscaledRightEdge,
                height: unscaledFlowHeight,
              },
              {
                width: parent.pdfWidth,
                height: visualContract.page.contentHeight,
              },
            )
          : scale(1);
        const finalScale =
          parent.logicalToPdfScale * horizontalFitScale;
        const displayedFlowHeight = points(
          unscaledFlowHeight * horizontalFitScale,
        );
        const flowTopPadding = points(
          rawUnscaledFlowTopPadding * horizontalFitScale,
        );
        const displayedPdfHeight = points(
          displayedFlowHeight - flowTopPadding,
        );
        const pagination = empty
          ? {
              mode: "keep-together" as const,
              usableContentHeight: visualContract.page.contentHeight,
              startsOnFreshPage: false,
              minimumEmergencyRowScale:
                PDF_IMAGE_GROUP_MIN_EMERGENCY_ROW_SCALE,
              rows: [],
              fragments: [],
            }
          : buildImageGroupPagination({
              blockId: block.id,
              groupId: group.id,
              displayedHeight,
              layoutHeight: layout.height,
              finalScale,
              flowTopPadding,
              pageHeight: visualContract.page.contentHeight,
              rows: layout.rows,
            });
        const imagesById = new Map(
          group.images.map((image) => [image.id, image]),
        );
        const mutableGroup: MutableGroupContext = {
          blockId: block.id,
          groupId: group.id,
          accessibility: {
            name: group.name,
            description: group.description,
          },
          order: blockOrder,
          empty,
          render: !empty,
          parent: {
            columnListBlockId: parent.columnListBlockId,
            columnBlockId: parent.columnBlockId,
            logicalWidth: parent.logicalWidth,
            pdfWidth: parent.pdfWidth,
            logicalToPdfScale: parent.logicalToPdfScale,
          },
          logical: {
            x: logicalUnits(displayedX),
            width: logicalUnits(displayedWidth),
            displayedHeight: logicalUnits(displayedHeight),
            persistedHeight: logicalUnits(group.height),
            offsetY: logicalUnits(group.frameOffsetY ?? 0),
            flowTopPadding: logicalUnits(positiveOffset),
            flowHeight: logicalUnits(displayedHeight + positiveOffset),
            layoutScale: layout.scale,
          },
          pdf: {
            x: points(displayedX * finalScale),
            width: points(
              unscaledPdfWidth * horizontalFitScale,
            ),
            unscaledHeight: unscaledPdfHeight,
            unscaledFlowHeight,
            displayedHeight: displayedPdfHeight,
            offsetY: points((group.frameOffsetY ?? 0) * finalScale),
            flowTopPadding,
            flowHeight: displayedFlowHeight,
            horizontalFitScale,
            inset: points(DOCUMENT_IMAGE_GROUP_INSET * finalScale),
            gap: points(DOCUMENT_IMAGE_GROUP_GAP * finalScale),
          },
          docx: {
            exportOnlyGroupPhysicalScale:
              docxExportOnlyGroupPhysicalScale,
          },
          keepTogether: {
            enabled: !empty,
            scope: parent.columnListBlockId ? "column-row" : "block",
            moveToNextPageIfNeeded: !empty,
          },
          pagination,
          slots: layout.slots.map((slot) => {
            const image = imagesById.get(slot.id);
            if (!image) {
              fatal(
                "INVALID_IMAGE_METADATA",
                `PDF preflight could not resolve layout slot "${slot.id}" for block "${block.id}", group "${group.id}".`,
                {
                  blockId: block.id,
                  groupId: group.id,
                  imageId: slot.id,
                },
              );
            }
            const crop = normalizePdfCrop(
              image.fitMode === "stretch" ? undefined : image.crop,
              {
              blockId: block.id,
              groupId: group.id,
              imageId: image.id,
              },
            );
            const emergencyScale =
              pagination.rows[slot.rowIndex]?.emergencyScale ?? 1;
            const drawBox = {
              width: points(slot.width * finalScale * emergencyScale),
              height: points(slot.height * finalScale * emergencyScale),
            };
            const key = addAssetUse(image.file, crop, {
              blockId: block.id,
              groupId: group.id,
              imageId: image.id,
              kind: "image-group",
              drawBox,
            });
            return {
              imageId: image.id,
              rowIndex: slot.rowIndex,
              source: image.file,
              assetKey: key,
              crop,
              logical: {
                x: logicalUnits(DOCUMENT_IMAGE_GROUP_INSET + slot.x),
                y: logicalUnits(DOCUMENT_IMAGE_GROUP_INSET + slot.y),
                width: logicalUnits(slot.width),
                height: logicalUnits(slot.height),
              },
              pdf: {
                x: points((DOCUMENT_IMAGE_GROUP_INSET + slot.x) * finalScale),
                y: points((DOCUMENT_IMAGE_GROUP_INSET + slot.y) * finalScale),
                width: points(slot.width * finalScale),
                height: points(slot.height * finalScale),
              },
            };
          }),
        };
        groups.push(mutableGroup);
      } else if (block.type === "image") {
        const source = String(block.props.url ?? "");
        if (NATIVE_IMAGE_SOURCE.test(source)) {
          const dimensions = input.nativeImageDimensions?.[block.id];
          if (
            !dimensions ||
            !Number.isFinite(dimensions.width) ||
            dimensions.width <= 0 ||
            !Number.isFinite(dimensions.height) ||
            dimensions.height <= 0
          ) {
            fatal(
              "CORRUPT_IMAGE_ASSET",
              `PDF preflight could not determine native image dimensions for block "${block.id}", source "${source}".`,
              { blockId: block.id, source },
            );
          }
          const previewWidth = block.props.previewWidth;
          const requestedWidth =
            typeof previewWidth === "number" &&
              Number.isFinite(previewWidth) &&
              previewWidth > 0
              ? previewWidth
              : dimensions.width;
          const unconstrainedLogicalWidth = Math.min(
            parent.logicalWidth,
            requestedWidth,
          );
          const unconstrainedLogicalHeight =
            unconstrainedLogicalWidth * dimensions.height / dimensions.width;
          const blockSpacing = visualContract.spacing.nativeImage.after;
          const unconstrainedPdfWidth =
            unconstrainedLogicalWidth * parent.logicalToPdfScale;
          const unconstrainedPdfHeight =
            unconstrainedLogicalHeight * parent.logicalToPdfScale;
          const captionFontSize =
            visualContract.typography.body.fontSize * 0.85;
          const captionLineHeight =
            visualContract.typography.body.lineHeight * 0.85;
          let fitted;
          try {
            fitted = fitPdfImageCaptionToPage({
              imageWidth: unconstrainedPdfWidth,
              imageHeight: unconstrainedPdfHeight,
              maxWidth: parent.pdfWidth,
              captionWidth: parent.pdfWidth,
              maxHeight: visualContract.page.contentHeight,
              blockSpacing,
              caption: String(block.props.caption ?? ""),
              captionFontSize,
              captionLineHeight,
              captionGap: visualContract.spacing.nativeImage.captionGap,
              measureText: input.measureCaptionText ??
                ((text, fontSize) => Array.from(text).length * fontSize),
            });
          } catch (error) {
            const reason = error instanceof Error
              ? error.message
              : String(error);
            fatal(
              "INVALID_DOCUMENT",
              `PDF preflight could not fit native image block "${block.id}", source "${source}", with its caption: ${reason}`,
              { blockId: block.id, source },
            );
          }
          const fitScale = fitted.scale;
          const captionHeight = points(fitted.caption.height);
          const logicalWidth = unconstrainedLogicalWidth * fitScale;
          const logicalHeight = unconstrainedLogicalHeight * fitScale;
          const drawBox = {
            width: points(logicalWidth * parent.logicalToPdfScale),
            height: points(logicalHeight * parent.logicalToPdfScale),
          };
          const blockHeight = points(
            drawBox.height + captionHeight + blockSpacing,
          );
          const crop = normalizePdfCrop(undefined);
          const key = addAssetUse(source, crop, {
            blockId: block.id,
            kind: "native-image",
            drawBox,
          });
          nativeImages.push({
            blockId: block.id,
            source,
            assetId: key,
            logicalWidth: logicalUnits(logicalWidth),
            logicalHeight: logicalUnits(logicalHeight),
            pdfWidth: drawBox.width,
            pdfHeight: drawBox.height,
            blockWidth: parent.pdfWidth,
            captionWidth: points(fitted.captionWidth),
            captionLines: fitted.caption.lines,
            captionHeight,
            blockSpacing,
            blockHeight,
            keepTogether: {
              enabled: true,
              moveToNextPageIfNeeded: true,
            },
          });
        }
      }

      if (block.children.length > 0) {
        visit(block.children, parent, block.id, blockPath);
      }
    });
  };

  visit(plan.document.blocks, root, null, []);

  const assetIdByKey = new Map<string, string>();
  const finalizedAssetRequests = Array.from(
    assetRequests,
    ([key, request], index): PreshotPdfAssetRequest => {
      const assetId = `asset-${index + 1}`;
      assetIdByKey.set(key, assetId);
      return {
        assetId,
        cacheKey:
          `${key}|${request.largestDrawBox.width}x${request.largestDrawBox.height}`,
        source: request.source,
        crop: request.crop,
        largestDrawBox: request.largestDrawBox,
        uses: request.uses,
      };
    },
  );
  const finalizedGroups = groups.map(
    (group): PreshotPdfImageGroupContext => ({
      ...group,
      slots: group.slots.map(({ assetKey: key, ...slot }) => ({
        ...slot,
        assetId: assetIdByKey.get(key)!,
      })),
    }),
  );
  const finalizedNativeImages = nativeImages.map((image) => ({
    ...image,
    assetId: assetIdByKey.get(image.assetId)!,
  }));
  const blocksById = Object.fromEntries(
    blocks.map((block) => [block.blockId, block]),
  );
  const groupsByBlockId = Object.fromEntries(
    finalizedGroups.map((group) => [group.blockId, group]),
  );
  const groupsByGroupId = Object.fromEntries(
    finalizedGroups.map((group) => [group.groupId, group]),
  );
  const nativeImagesByBlockId = Object.fromEntries(
    finalizedNativeImages.map((image) => [image.blockId, image]),
  );

  return freezePreshotPdfExportContext({
    version: 2,
    blocks,
    blocksById,
    columnLists,
    groups: finalizedGroups,
    groupsByBlockId,
    groupsByGroupId,
    nativeImagesByBlockId,
    assetRequests: finalizedAssetRequests,
    page: cloneContractSection(visualContract.page),
    typography: cloneContractSection(visualContract.typography),
    spacing: cloneContractSection(visualContract.spacing),
    colors: cloneContractSection(visualContract.colors),
    borders: cloneContractSection(visualContract.borders),
    warnings,
    fatalErrors: [],
  });
}
