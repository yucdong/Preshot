import {
  isPathSafeLongImageFileName,
  isSafeLongImageBaseName,
  MAX_LONG_IMAGE_BASE_NAME_CODE_POINTS,
  MAX_LONG_IMAGE_BASE_NAME_UTF16_CODE_UNITS,
  MAX_LONG_IMAGE_PARTS,
  truncateUnicodeCodePoints,
  truncateUtf16CodeUnits,
} from "../longImageSave";

const MEBIBYTE = 1_048_576;
const EDITOR_OUTER_WIDTH = 1_080;
const EDITOR_CONTENT_WIDTH = 1_008;
const ABSOLUTE_MAX_HEIGHT = 8_000;
const CANVAS_MAX_DIMENSION = 32_767;
const CANVAS_SAFETY_MAX_PIXELS = 8_000_000;
const DECODED_BYTES_PER_PIXEL = 4;
const DECODED_MEMORY_SAFETY_BYTES = 32 * MEBIBYTE;

export type LongImageFormat = "jpeg" | "png";
export type LongImagePresetId =
  | "wechat"
  | "high-quality"
  | "lossless-png";
export type LongImageWidth = 890 | 900;

export interface LongImageJpegLimits {
  readonly targetHeight: number;
  readonly targetBytes: number;
  readonly hardMaxBytes: number;
  readonly initialQuality: number;
  readonly minimumQuality: number;
  readonly maximumQuality: number;
}

export interface LongImagePngLimits {
  readonly targetHeight: number;
  readonly targetBytes: number;
  readonly hardMaxBytes: number;
}

export type LongImageEncodingLimits =
  | LongImageJpegLimits
  | LongImagePngLimits;

export interface LongImagePreset {
  readonly id: LongImagePresetId;
  readonly label: string;
  readonly default: boolean;
  readonly format: LongImageFormat;
  readonly width: LongImageWidth;
  readonly limits: LongImageEncodingLimits;
  readonly cumulativeBudget: LongImageCumulativeBudget;
}

export interface LongImageJpegPreset extends LongImagePreset {
  readonly format: "jpeg";
  readonly limits: LongImageJpegLimits;
}

export interface LongImagePngPreset extends LongImagePreset {
  readonly format: "png";
  readonly limits: LongImagePngLimits;
}

export interface LongImageCumulativeBudget {
  readonly maxParts: number;
  readonly maxTotalBytes: number;
}

export const LONG_IMAGE_SAFETY = Object.freeze({
  absoluteMaxHeight: ABSOLUTE_MAX_HEIGHT,
  canvasMaxDimension: CANVAS_MAX_DIMENSION,
  canvasSafetyMaxPixels: CANVAS_SAFETY_MAX_PIXELS,
  decodedBytesPerPixel: DECODED_BYTES_PER_PIXEL,
  decodedMemorySafetyBytes: DECODED_MEMORY_SAFETY_BYTES,
});

const wechatLimits = Object.freeze<LongImageJpegLimits>({
  targetHeight: 6_000,
  targetBytes: MEBIBYTE,
  hardMaxBytes: 2 * MEBIBYTE,
  initialQuality: 0.84,
  minimumQuality: 0.68,
  maximumQuality: 0.92,
});

const highQualityLimits = Object.freeze<LongImageJpegLimits>({
  targetHeight: 8_000,
  targetBytes: 3 * MEBIBYTE,
  hardMaxBytes: 10 * MEBIBYTE,
  initialQuality: 0.9,
  minimumQuality: 0.68,
  maximumQuality: 0.95,
});

const losslessPngLimits = Object.freeze<LongImagePngLimits>({
  targetHeight: 4_000,
  targetBytes: 8 * MEBIBYTE,
  hardMaxBytes: 10 * MEBIBYTE,
});

const wechatCumulativeBudget = Object.freeze<LongImageCumulativeBudget>({
  maxParts: 32,
  maxTotalBytes: 24 * MEBIBYTE,
});

const highQualityCumulativeBudget = Object.freeze<LongImageCumulativeBudget>({
  maxParts: 32,
  maxTotalBytes: 48 * MEBIBYTE,
});

const losslessPngCumulativeBudget = Object.freeze<LongImageCumulativeBudget>({
  maxParts: 32,
  maxTotalBytes: 64 * MEBIBYTE,
});

export const LONG_IMAGE_PRESETS = Object.freeze({
  wechat: Object.freeze({
    id: "wechat",
    label: "WeChat compatible",
    default: true,
    format: "jpeg",
    width: 900,
    limits: wechatLimits,
    cumulativeBudget: wechatCumulativeBudget,
  } satisfies LongImageJpegPreset),
  "high-quality": Object.freeze({
    id: "high-quality",
    label: "High quality",
    default: false,
    format: "jpeg",
    width: 900,
    limits: highQualityLimits,
    cumulativeBudget: highQualityCumulativeBudget,
  } satisfies LongImageJpegPreset),
  "lossless-png": Object.freeze({
    id: "lossless-png",
    label: "Lossless PNG",
    default: false,
    format: "png",
    width: 900,
    limits: losslessPngLimits,
    cumulativeBudget: losslessPngCumulativeBudget,
  } satisfies LongImagePngPreset),
}) satisfies Readonly<Record<LongImagePresetId, LongImagePreset>>;

export type LongImageErrorCode =
  | "INVALID_BLOCK_BOUNDARY"
  | "INVALID_BYTE_SIZE"
  | "INVALID_DOCUMENT_HEIGHT"
  | "INVALID_FILENAME"
  | "INVALID_FORMAT"
  | "INVALID_PART"
  | "INVALID_PRESET"
  | "INVALID_QUALITY"
  | "INVALID_TARGET_HEIGHT"
  | "INVALID_WIDTH"
  | "NO_EARLIER_BOUNDARY"
  | "PART_COUNT_EXCEEDED"
  | "SPLITTING_DISABLED"
  | "SPLITTING_REQUIRED"
  | "TOTAL_ENCODED_BYTES_EXCEEDED"
  | "UNSAFE_CANVAS";

export class LongImageContractError extends Error {
  constructor(
    readonly code: LongImageErrorCode,
    message: string,
    readonly context: Readonly<Record<string, number | string | boolean>> = {},
  ) {
    super(message);
    this.name = "LongImageContractError";
  }
}

export type LongImageWarningCode =
  | "ATOMIC_BLOCK_TILED"
  | "HARD_BYTE_LIMIT_EXCEEDED"
  | "TARGET_HEIGHT_EXCEEDED";

export interface LongImageWarning {
  readonly code: LongImageWarningCode;
  readonly message: string;
  readonly partIndex?: number;
  readonly blockId?: string;
  readonly actual?: number;
  readonly limit?: number;
}

export interface LongImageGeometry {
  readonly editorOuterWidth: 1080;
  readonly editorContentWidth: 1008;
  readonly outputWidth: LongImageWidth;
  readonly contentWidth: number;
  readonly sidePadding: number;
  readonly scale: number;
}

export interface LongImageDecodedMemoryEstimate {
  readonly width: number;
  readonly height: number;
  readonly pixelCount: number;
  readonly rgbaBytes: number;
  readonly mebibytes: number;
  readonly withinCanvasDimension: boolean;
  readonly withinCanvasArea: boolean;
  readonly withinDecodedMemory: boolean;
  readonly withinSafetyBudget: boolean;
}

export interface LongImageGroupRowBoundary {
  readonly rowIndex: number;
  readonly bottom: number;
}

export interface LongImageMeasuredBlock {
  readonly blockId: string;
  readonly blockType: string;
  readonly top: number;
  readonly bottom: number;
  readonly atomic: true;
  readonly imageGroupRows?: readonly LongImageGroupRowBoundary[];
}

export type LongImageBoundaryKind = "block" | "image-group-row";

export interface LongImageBoundary {
  readonly position: number;
  readonly kind: LongImageBoundaryKind;
  readonly blockId: string;
  readonly rowIndex?: number;
}

export type LongImagePartEndKind =
  | LongImageBoundaryKind
  | "document-end"
  | "emergency-tile";

export interface LongImagePart {
  readonly index: number;
  readonly top: number;
  readonly bottom: number;
  readonly height: number;
  readonly endKind: LongImagePartEndKind;
  readonly endBlockId?: string;
  readonly endRowIndex?: number;
}

export interface LongImagePartPlan {
  readonly parts: readonly LongImagePart[];
  readonly warnings: readonly LongImageWarning[];
}

export interface LongImageExportManifest {
  readonly version: 1;
  readonly projectTitle: string;
  readonly baseName: string;
  readonly preset: LongImagePresetId;
  readonly format: LongImageFormat;
  readonly geometry: LongImageGeometry;
  readonly limits: LongImageEncodingLimits;
  readonly cumulativeBudget: LongImageCumulativeBudget;
  readonly documentHeight: number;
  readonly allowSplit: boolean;
  readonly blocks: readonly LongImageMeasuredBlock[];
  readonly parts: readonly LongImagePart[];
  readonly fileNames: readonly string[];
  readonly warnings: readonly LongImageWarning[];
}

export interface LongImageEncodedPart {
  readonly part: LongImagePart;
  readonly fileName: string;
  readonly mime: "image/jpeg" | "image/png";
  readonly width: LongImageWidth;
  readonly height: number;
  readonly encodedBytes: number;
  readonly bytes: Readonly<Uint8Array>;
  readonly quality?: number;
}

export interface LongImageExportResult {
  readonly manifest: LongImageExportManifest;
  readonly parts: readonly LongImageEncodedPart[];
  readonly totalBytes: number;
  readonly warnings: readonly LongImageWarning[];
}

export function assertLongImageCumulativeBudget(input: {
  readonly preset: LongImagePresetId;
  readonly partCount: number;
  readonly retainedBytes: number;
  readonly nextPartBytes?: number;
}): number {
  const preset = presetFor(input.preset);
  const { maxParts, maxTotalBytes } = preset.cumulativeBudget;
  if (!Number.isInteger(input.partCount) || input.partCount <= 0) {
    invalid("INVALID_PART", "Long-image part count must be a positive integer.", {
      partCount: input.partCount,
    });
  }
  if (input.partCount > maxParts) {
    invalid(
      "PART_COUNT_EXCEEDED",
      `The ${preset.label} export would create ${input.partCount} parts, above the ${maxParts}-part safety limit. Shorten the plan, export smaller sections separately, or use PDF/DOCX.`,
      {
        preset: preset.id,
        format: preset.format,
        partCount: input.partCount,
        maxParts,
      },
    );
  }
  validateByteSize(input.retainedBytes);
  const nextPartBytes = input.nextPartBytes ?? 0;
  validateByteSize(nextPartBytes);
  const totalBytes = input.retainedBytes + nextPartBytes;
  if (!Number.isSafeInteger(totalBytes) || totalBytes > maxTotalBytes) {
    invalid(
      "TOTAL_ENCODED_BYTES_EXCEEDED",
      `The ${preset.label} export would retain more than ${maxTotalBytes / MEBIBYTE} MiB of encoded images. Shorten the plan, export smaller sections separately, choose a smaller JPEG preset, or use PDF/DOCX.`,
      {
        preset: preset.id,
        format: preset.format,
        partCount: input.partCount,
        retainedBytes: input.retainedBytes,
        nextPartBytes,
        totalBytes,
        maxTotalBytes,
      },
    );
  }
  return totalBytes;
}

const isFinitePositive = (value: number): boolean =>
  Number.isFinite(value) && value > 0;

const invalid = (
  code: LongImageErrorCode,
  message: string,
  context: Readonly<Record<string, number | string | boolean>> = {},
): never => {
  throw new LongImageContractError(code, message, context);
};

const isSupportedWidth = (value: number): value is LongImageWidth =>
  value === 890 || value === 900;

const isJpegLimits = (
  limits: LongImageEncodingLimits,
): limits is LongImageJpegLimits => "initialQuality" in limits;

export function createLongImageGeometry(width: LongImageWidth): LongImageGeometry {
  if (!isSupportedWidth(width)) {
    invalid(
      "INVALID_WIDTH",
      "Long-image width must be exactly 890px or 900px.",
      { width },
    );
  }
  const scale = width / EDITOR_OUTER_WIDTH;
  const contentWidth = EDITOR_CONTENT_WIDTH * scale;
  return Object.freeze({
    editorOuterWidth: EDITOR_OUTER_WIDTH,
    editorContentWidth: EDITOR_CONTENT_WIDTH,
    outputWidth: width,
    contentWidth,
    sidePadding: (width - contentWidth) / 2,
    scale,
  });
}

export function estimateLongImageDecodedMemory(
  width: number,
  height: number,
): LongImageDecodedMemoryEstimate {
  if (!Number.isInteger(width) || !isFinitePositive(width)) {
    invalid("INVALID_WIDTH", "Decoded image width must be a positive integer.", {
      width,
    });
  }
  if (!Number.isInteger(height) || !isFinitePositive(height)) {
    invalid(
      "INVALID_DOCUMENT_HEIGHT",
      "Decoded image height must be a positive integer.",
      { height },
    );
  }
  const pixelCount = width * height;
  const rgbaBytes = pixelCount * DECODED_BYTES_PER_PIXEL;
  const withinCanvasDimension =
    width <= CANVAS_MAX_DIMENSION && height <= ABSOLUTE_MAX_HEIGHT;
  const withinCanvasArea = pixelCount <= CANVAS_SAFETY_MAX_PIXELS;
  const withinDecodedMemory = rgbaBytes <= DECODED_MEMORY_SAFETY_BYTES;
  return Object.freeze({
    width,
    height,
    pixelCount,
    rgbaBytes,
    mebibytes: rgbaBytes / MEBIBYTE,
    withinCanvasDimension,
    withinCanvasArea,
    withinDecodedMemory,
    withinSafetyBudget:
      withinCanvasDimension && withinCanvasArea && withinDecodedMemory,
  });
}

function validateHeight(value: number, code: LongImageErrorCode): void {
  if (!Number.isInteger(value) || !isFinitePositive(value)) {
    invalid(code, "Long-image heights must be positive integers.", {
      height: value,
    });
  }
}

function validateMeasuredBlocks(
  blocks: readonly LongImageMeasuredBlock[],
  documentHeight: number,
): readonly LongImageMeasuredBlock[] {
  const seenIds = new Set<string>();
  let previousBottom = 0;
  return Object.freeze(blocks.map((block) => {
    if (
      block.blockId.trim().length === 0 ||
      seenIds.has(block.blockId) ||
      !Number.isInteger(block.top) ||
      !Number.isInteger(block.bottom) ||
      block.top < previousBottom ||
      block.top < 0 ||
      block.bottom <= block.top ||
      block.bottom > documentHeight ||
      block.atomic !== true
    ) {
      invalid(
        "INVALID_BLOCK_BOUNDARY",
        `Invalid measured boundary for block "${block.blockId}".`,
        { blockId: block.blockId, top: block.top, bottom: block.bottom },
      );
    }
    seenIds.add(block.blockId);
    previousBottom = block.bottom;

    let previousRowBottom = block.top;
    const imageGroupRows = block.imageGroupRows?.map((row, index) => {
      if (
        !Number.isInteger(row.rowIndex) ||
        row.rowIndex !== index ||
        !Number.isInteger(row.bottom) ||
        row.bottom <= previousRowBottom ||
        row.bottom > block.bottom
      ) {
        invalid(
          "INVALID_BLOCK_BOUNDARY",
          `Invalid image-group row boundary for block "${block.blockId}".`,
          {
            blockId: block.blockId,
            rowIndex: row.rowIndex,
            bottom: row.bottom,
          },
        );
      }
      previousRowBottom = row.bottom;
      return Object.freeze({ rowIndex: row.rowIndex, bottom: row.bottom });
    });
    if (
      imageGroupRows &&
      (imageGroupRows.length === 0 ||
        imageGroupRows.at(-1)?.bottom !== block.bottom)
    ) {
      invalid(
        "INVALID_BLOCK_BOUNDARY",
        `Image-group rows must end at block "${block.blockId}" bottom.`,
        { blockId: block.blockId, bottom: block.bottom },
      );
    }
    return Object.freeze({
      blockId: block.blockId,
      blockType: block.blockType,
      top: block.top,
      bottom: block.bottom,
      atomic: true as const,
      ...(imageGroupRows
        ? { imageGroupRows: Object.freeze(imageGroupRows) }
        : {}),
    });
  }));
}

function blockBoundaries(
  blocks: readonly LongImageMeasuredBlock[],
): readonly LongImageBoundary[] {
  return blocks.map((block) => Object.freeze({
    position: block.bottom,
    kind: "block" as const,
    blockId: block.blockId,
  }));
}

function containingBlock(
  blocks: readonly LongImageMeasuredBlock[],
  position: number,
): LongImageMeasuredBlock | undefined {
  return blocks.find((block) =>
    block.top <= position && block.bottom > position
  );
}

function lastBoundaryAtOrBefore(
  boundaries: readonly LongImageBoundary[],
  start: number,
  end: number,
): LongImageBoundary | undefined {
  let selected: LongImageBoundary | undefined;
  for (const boundary of boundaries) {
    if (boundary.position <= start) continue;
    if (boundary.position > end) break;
    selected = boundary;
  }
  return selected;
}

function firstBoundaryAtOrBefore(
  boundaries: readonly LongImageBoundary[],
  start: number,
  end: number,
): LongImageBoundary | undefined {
  return boundaries.find((boundary) =>
    boundary.position > start && boundary.position <= end
  );
}

function rowBoundaryAtOrBefore(
  block: LongImageMeasuredBlock,
  start: number,
  end: number,
): LongImageBoundary | undefined {
  let selected: LongImageBoundary | undefined;
  for (const row of block.imageGroupRows ?? []) {
    if (row.bottom <= start || row.bottom >= block.bottom) continue;
    if (row.bottom > end) break;
    selected = Object.freeze({
      position: row.bottom,
      kind: "image-group-row",
      blockId: block.blockId,
      rowIndex: row.rowIndex,
    });
  }
  return selected;
}

function freezeWarning(warning: LongImageWarning): LongImageWarning {
  return Object.freeze({ ...warning });
}

function createPart(
  index: number,
  top: number,
  bottom: number,
  boundary:
    | LongImageBoundary
    | { readonly kind: "document-end" | "emergency-tile"; readonly blockId?: string },
): LongImagePart {
  return Object.freeze({
    index,
    top,
    bottom,
    height: bottom - top,
    endKind: boundary.kind,
    ...("blockId" in boundary && boundary.blockId
      ? { endBlockId: boundary.blockId }
      : {}),
    ...("rowIndex" in boundary && boundary.rowIndex !== undefined
      ? { endRowIndex: boundary.rowIndex }
      : {}),
  });
}

export function planLongImageParts(input: {
  readonly documentHeight: number;
  readonly targetHeight: number;
  readonly blocks: readonly LongImageMeasuredBlock[];
  readonly allowSplit: boolean;
}): LongImagePartPlan {
  validateHeight(input.documentHeight, "INVALID_DOCUMENT_HEIGHT");
  validateHeight(input.targetHeight, "INVALID_TARGET_HEIGHT");
  if (input.targetHeight > ABSOLUTE_MAX_HEIGHT) {
    invalid(
      "INVALID_TARGET_HEIGHT",
      `Target height cannot exceed the ${ABSOLUTE_MAX_HEIGHT}px safety cap.`,
      { targetHeight: input.targetHeight },
    );
  }
  const blocks = validateMeasuredBlocks(input.blocks, input.documentHeight);

  if (!input.allowSplit) {
    const safety = estimateLongImageDecodedMemory(900, input.documentHeight);
    if (!safety.withinSafetyBudget) {
      invalid(
        "SPLITTING_REQUIRED",
        "This document exceeds safe single-image limits. Enable automatic splitting, shorten the plan, or export PDF/DOCX.",
        { documentHeight: input.documentHeight },
      );
    }
    const warning = input.documentHeight > input.targetHeight
      ? [freezeWarning({
        code: "TARGET_HEIGHT_EXCEEDED",
        message:
          "The single image exceeds the preferred height but remains within the absolute safety cap.",
        partIndex: 0,
        actual: input.documentHeight,
        limit: input.targetHeight,
      })]
      : [];
    return Object.freeze({
      parts: Object.freeze([
        createPart(0, 0, input.documentHeight, { kind: "document-end" }),
      ]),
      warnings: Object.freeze(warning),
    });
  }

  const boundaries = blockBoundaries(blocks);
  const parts: LongImagePart[] = [];
  const warnings: LongImageWarning[] = [];
  let top = 0;

  while (top < input.documentHeight) {
    const targetBottom = Math.min(
      input.documentHeight,
      top + input.targetHeight,
    );
    if (targetBottom === input.documentHeight) {
      parts.push(createPart(parts.length, top, input.documentHeight, {
        kind: "document-end",
      }));
      break;
    }

    const completeBlock = lastBoundaryAtOrBefore(boundaries, top, targetBottom);
    if (completeBlock) {
      parts.push(createPart(
        parts.length,
        top,
        completeBlock.position,
        completeBlock,
      ));
      top = completeBlock.position;
      continue;
    }

    const currentBlock = containingBlock(blocks, top);
    const emergencyBottom = Math.min(
      input.documentHeight,
      top + ABSOLUTE_MAX_HEIGHT,
    );
    const completeEmergencyBlock = firstBoundaryAtOrBefore(
      boundaries,
      top,
      emergencyBottom,
    );

    if (completeEmergencyBlock) {
      const partIndex = parts.length;
      parts.push(createPart(
        partIndex,
        top,
        completeEmergencyBlock.position,
        completeEmergencyBlock,
      ));
      warnings.push(freezeWarning({
        code: "TARGET_HEIGHT_EXCEEDED",
        message:
          `Atomic block "${completeEmergencyBlock.blockId}" exceeds the preferred part height and was kept whole.`,
        partIndex,
        blockId: completeEmergencyBlock.blockId,
        actual: completeEmergencyBlock.position - top,
        limit: input.targetHeight,
      }));
      top = completeEmergencyBlock.position;
      continue;
    }

    if (currentBlock) {
      const rowBoundary =
        rowBoundaryAtOrBefore(currentBlock, top, targetBottom) ??
          rowBoundaryAtOrBefore(currentBlock, top, emergencyBottom);
      if (rowBoundary) {
        parts.push(createPart(
          parts.length,
          top,
          rowBoundary.position,
          rowBoundary,
        ));
        top = rowBoundary.position;
        continue;
      }
    }

    const nextBottom = emergencyBottom;
    if (nextBottom <= top) {
      invalid(
        "UNSAFE_CANVAS",
        "Long-image planner could not make forward progress.",
        { top, documentHeight: input.documentHeight },
      );
    }
    const partIndex = parts.length;
    parts.push(createPart(partIndex, top, nextBottom, {
      kind: nextBottom === input.documentHeight
        ? "document-end"
        : "emergency-tile",
      blockId: currentBlock?.blockId,
    }));
    if (nextBottom < input.documentHeight) {
      warnings.push(freezeWarning({
        code: "ATOMIC_BLOCK_TILED",
        message:
          `Indivisible block "${currentBlock?.blockId ?? "unknown"}" exceeded the absolute height cap and was pixel-tiled.`,
        partIndex,
        ...(currentBlock ? { blockId: currentBlock.blockId } : {}),
        actual: currentBlock ? currentBlock.bottom - currentBlock.top : undefined,
        limit: ABSOLUTE_MAX_HEIGHT,
      }));
    }
    top = nextBottom;
  }

  return Object.freeze({
    parts: Object.freeze(parts),
    warnings: Object.freeze(warnings),
  });
}

function validateByteSize(value: number): void {
  if (!Number.isInteger(value) || value < 0 || !Number.isFinite(value)) {
    invalid(
      "INVALID_BYTE_SIZE",
      "Encoded byte size must be a non-negative integer.",
      { encodedBytes: value },
    );
  }
}

function validateJpegLimits(limits: LongImageJpegLimits): void {
  const qualities = [
    limits.minimumQuality,
    limits.initialQuality,
    limits.maximumQuality,
  ];
  if (
    qualities.some((quality) =>
      !Number.isFinite(quality) || quality <= 0 || quality > 1
    ) ||
    limits.minimumQuality > limits.initialQuality ||
    limits.initialQuality > limits.maximumQuality
  ) {
    invalid("INVALID_QUALITY", "JPEG quality limits are invalid.");
  }
  if (
    !Number.isInteger(limits.targetBytes) ||
    !Number.isInteger(limits.hardMaxBytes) ||
    limits.targetBytes <= 0 ||
    limits.hardMaxBytes < limits.targetBytes
  ) {
    invalid("INVALID_BYTE_SIZE", "JPEG byte limits are invalid.");
  }
}

export type LongImageEncodingDecision =
  | {
    readonly kind: "accepted";
    readonly encodedBytes: number;
    readonly quality?: number;
  }
  | {
    readonly kind: "resplit";
    readonly reason: "byte-target";
    readonly encodedBytes: number;
    readonly targetBytes: number;
    readonly hardMaxBytes: number;
    readonly minimumQuality?: number;
  };

const roundedQuality = (quality: number, precision: number): number =>
  Number((Math.round(quality / precision) * precision).toFixed(6));

export async function decideJpegEncoding(input: {
  readonly limits: LongImageJpegLimits;
  readonly encodeSize: (quality: number) => number | Promise<number>;
  readonly qualityPrecision?: number;
  readonly maxIterations?: number;
}): Promise<LongImageEncodingDecision> {
  validateJpegLimits(input.limits);
  const precision = input.qualityPrecision ?? 0.001;
  const maxIterations = input.maxIterations ?? 12;
  if (!isFinitePositive(precision) || precision >= 1) {
    invalid("INVALID_QUALITY", "JPEG quality precision must be between 0 and 1.");
  }
  if (!Number.isInteger(maxIterations) || maxIterations <= 0) {
    invalid("INVALID_QUALITY", "JPEG search iterations must be positive.");
  }

  const sizeAt = async (quality: number): Promise<number> => {
    const size = await input.encodeSize(quality);
    validateByteSize(size);
    return size;
  };

  const initialBytes = await sizeAt(input.limits.initialQuality);
  if (initialBytes <= input.limits.targetBytes) {
    return Object.freeze({
      kind: "accepted",
      quality: input.limits.initialQuality,
      encodedBytes: initialBytes,
    });
  }

  const minimumBytes = await sizeAt(input.limits.minimumQuality);
  if (minimumBytes > input.limits.targetBytes) {
    return Object.freeze({
      kind: "resplit",
      reason: "byte-target",
      encodedBytes: minimumBytes,
      targetBytes: input.limits.targetBytes,
      hardMaxBytes: input.limits.hardMaxBytes,
      minimumQuality: input.limits.minimumQuality,
    });
  }

  let acceptedQuality = input.limits.minimumQuality;
  let acceptedBytes = minimumBytes;
  let lower = input.limits.minimumQuality;
  let upper = input.limits.initialQuality;
  for (
    let iteration = 0;
    iteration < maxIterations && upper - lower > precision;
    iteration += 1
  ) {
    const quality = roundedQuality((lower + upper) / 2, precision);
    if (quality <= lower || quality >= upper) break;
    const encodedBytes = await sizeAt(quality);
    if (encodedBytes <= input.limits.targetBytes) {
      acceptedQuality = quality;
      acceptedBytes = encodedBytes;
      lower = quality;
    } else {
      upper = quality;
    }
  }

  return Object.freeze({
    kind: "accepted",
    quality: acceptedQuality,
    encodedBytes: acceptedBytes,
  });
}

export function decidePngEncoding(input: {
  readonly encodedBytes: number;
  readonly limits: LongImagePngLimits;
}): LongImageEncodingDecision {
  validateByteSize(input.encodedBytes);
  if (
    !Number.isInteger(input.limits.targetBytes) ||
    !Number.isInteger(input.limits.hardMaxBytes) ||
    input.limits.targetBytes <= 0 ||
    input.limits.hardMaxBytes < input.limits.targetBytes
  ) {
    invalid("INVALID_BYTE_SIZE", "PNG byte limits are invalid.");
  }
  if (input.encodedBytes <= input.limits.targetBytes) {
    return Object.freeze({
      kind: "accepted",
      encodedBytes: input.encodedBytes,
    });
  }
  return Object.freeze({
    kind: "resplit",
    reason: "byte-target",
    encodedBytes: input.encodedBytes,
    targetBytes: input.limits.targetBytes,
    hardMaxBytes: input.limits.hardMaxBytes,
  });
}

export function findEarlierLongImageBoundary(input: {
  readonly part: LongImagePart;
  readonly blocks: readonly LongImageMeasuredBlock[];
  readonly allowSplit: boolean;
}): LongImageBoundary {
  if (!input.allowSplit) {
    invalid(
      "SPLITTING_DISABLED",
      "Encoded output exceeds the single-image byte target. Enable automatic splitting, shorten the plan, or export PDF/DOCX.",
      { partIndex: input.part.index },
    );
  }
  if (
    !Number.isInteger(input.part.top) ||
    !Number.isInteger(input.part.bottom) ||
    input.part.top < 0 ||
    input.part.bottom <= input.part.top
  ) {
    invalid("INVALID_PART", "Cannot re-split an invalid long-image part.");
  }
  const documentHeight = Math.max(
    input.part.bottom,
    ...input.blocks.map((block) => block.bottom),
  );
  const blocks = validateMeasuredBlocks(input.blocks, documentHeight);
  const candidates: LongImageBoundary[] = [];
  for (const block of blocks) {
    if (block.bottom > input.part.top && block.bottom < input.part.bottom) {
      candidates.push(Object.freeze({
        position: block.bottom,
        kind: "block",
        blockId: block.blockId,
      }));
    }
    for (const row of block.imageGroupRows ?? []) {
      if (
        row.bottom > input.part.top &&
        row.bottom < input.part.bottom &&
        row.bottom < block.bottom
      ) {
        candidates.push(Object.freeze({
          position: row.bottom,
          kind: "image-group-row",
          blockId: block.blockId,
          rowIndex: row.rowIndex,
        }));
      }
    }
  }
  candidates.sort((left, right) =>
    left.position - right.position ||
    (left.kind === "block" ? -1 : 1)
  );
  const boundary = candidates.at(-1);
  if (!boundary) {
    const atomicBlock = blocks.find((block) =>
      block.top <= input.part.top && block.bottom >= input.part.bottom
    );
    let atomicKind: "block" | "image-group-row" = "block";
    let rowIndex: number | undefined;
    if (atomicBlock?.imageGroupRows) {
      let rowTop = atomicBlock.top;
      for (const row of atomicBlock.imageGroupRows) {
        if (
          rowTop === input.part.top &&
          row.bottom === input.part.bottom
        ) {
          atomicKind = "image-group-row";
          rowIndex = row.rowIndex;
          break;
        }
        rowTop = row.bottom;
      }
    }
    return invalid(
      "NO_EARLIER_BOUNDARY",
      "One complete block or image-group row still exceeds the long-image height or encoded-size limit and cannot be split safely. Shorten or divide that block or image group, export smaller sections separately, use the smaller WeChat JPEG preset or reduce image detail when applicable, or export PDF/DOCX.",
      {
        partIndex: input.part.index,
        partTop: input.part.top,
        partBottom: input.part.bottom,
        atomicKind,
        ...(atomicBlock
          ? {
            blockId: atomicBlock.blockId,
            blockType: atomicBlock.blockType,
          }
          : {}),
        ...(rowIndex === undefined ? {} : { rowIndex }),
      },
    );
  }
  return boundary;
}

export function sanitizeLongImageBaseName(value: string): string {
  if (typeof value !== "string") {
    invalid("INVALID_FILENAME", "Long-image base name must be text.");
  }
  const withoutControls = Array.from(value.normalize("NFC"), (character) =>
    /\p{Cc}/u.test(character) ? "-" : character
  ).join("");
  const sanitized = truncateUtf16CodeUnits(
    truncateUnicodeCodePoints(
      withoutControls
        .replace(/[<>:"/\\|?*]+/g, "-")
        .trim()
        .replace(/[ .]+$/g, ""),
      MAX_LONG_IMAGE_BASE_NAME_CODE_POINTS,
    ),
    MAX_LONG_IMAGE_BASE_NAME_UTF16_CODE_UNITS,
  ).replace(/[ .]+$/g, "");
  if (!sanitized || /^[. ]+$/.test(sanitized)) return "output-long";
  const safeName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i
      .test(sanitized)
    ? `${sanitized}-project`
    : sanitized;
  if (!isSafeLongImageBaseName(safeName)) {
    invalid("INVALID_FILENAME", "Long-image base name is not Windows-safe.");
  }
  return safeName;
}

export function planLongImageFileNames(input: {
  readonly baseName: string;
  readonly format: LongImageFormat;
  readonly partCount: number;
}): readonly string[] {
  if (input.format !== "jpeg" && input.format !== "png") {
    invalid(
      "INVALID_FORMAT",
      "Long-image format must be JPEG or PNG.",
      { format: String(input.format) },
    );
  }
  if (
    !Number.isInteger(input.partCount) ||
    input.partCount <= 0 ||
    input.partCount > MAX_LONG_IMAGE_PARTS
  ) {
    invalid(
      "INVALID_PART",
      "Long-image part count must be a positive integer.",
      { partCount: input.partCount },
    );
  }
  const baseName = sanitizeLongImageBaseName(input.baseName);
  const extension = input.format === "jpeg" ? "jpg" : "png";
  const digits = Math.max(2, String(input.partCount).length);
  const fileNames = input.partCount === 1
    ? [`${baseName}.${extension}`]
    : Array.from(
    { length: input.partCount },
    (_, index) =>
      `${baseName}-${String(index + 1).padStart(digits, "0")}.${extension}`,
    );
  if (!fileNames.every(isPathSafeLongImageFileName)) {
    invalid(
      "INVALID_FILENAME",
      "A generated long-image filename exceeds the Windows component limit.",
    );
  }
  return Object.freeze(fileNames);
}

function presetFor(value: LongImagePresetId): LongImagePreset {
  const preset = LONG_IMAGE_PRESETS[value];
  if (!preset) {
    invalid(
      "INVALID_PRESET",
      "Unknown long-image export preset.",
      { preset: String(value) },
    );
  }
  return preset;
}

export function buildLongImageExportManifest(input: {
  readonly projectTitle: string;
  readonly preset: LongImagePresetId;
  readonly width?: LongImageWidth;
  readonly documentHeight: number;
  readonly blocks: readonly LongImageMeasuredBlock[];
  readonly allowSplit: boolean;
}): LongImageExportManifest {
  const preset = presetFor(input.preset);
  const width = input.width ?? preset.width;
  const geometry = createLongImageGeometry(width);
  const blocks = validateMeasuredBlocks(input.blocks, input.documentHeight);
  const plan = planLongImageParts({
    documentHeight: input.documentHeight,
    targetHeight: preset.limits.targetHeight,
    blocks,
    allowSplit: input.allowSplit,
  });
  assertLongImageCumulativeBudget({
    preset: input.preset,
    partCount: plan.parts.length,
    retainedBytes: 0,
  });
  const baseName = sanitizeLongImageBaseName(input.projectTitle);
  const fileNames = planLongImageFileNames({
    baseName,
    format: preset.format,
    partCount: plan.parts.length,
  });
  return Object.freeze({
    version: 1,
    projectTitle: input.projectTitle,
    baseName,
    preset: preset.id,
    format: preset.format,
    geometry,
    limits: preset.limits,
    cumulativeBudget: preset.cumulativeBudget,
    documentHeight: input.documentHeight,
    allowSplit: input.allowSplit,
    blocks,
    parts: plan.parts,
    fileNames,
    warnings: plan.warnings,
  });
}

export function isLongImageJpegLimits(
  limits: LongImageEncodingLimits,
): limits is LongImageJpegLimits {
  return isJpegLimits(limits);
}
