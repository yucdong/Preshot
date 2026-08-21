import {
  LONG_IMAGE_PRESETS,
  LongImageContractError,
  assertLongImageCumulativeBudget,
  buildLongImageExportManifest,
  decideJpegEncoding,
  decidePngEncoding,
  estimateLongImageDecodedMemory,
  findEarlierLongImageBoundary,
  planLongImageFileNames,
  type LongImageBoundary,
  type LongImageEncodedPart,
  type LongImageExportManifest,
  type LongImageExportResult,
  type LongImageFormat,
  type LongImageMeasuredBlock,
  type LongImagePart,
  type LongImagePresetId,
  type LongImageWarning,
  type LongImageWidth,
} from "../../domain/plan/blocknote/longImageExportContract";
import {
  validateProjectPlanV14,
  type ProjectPlanV14,
} from "../../domain/plan/canvas/blockDocument";
import {
  validateLongImageExportAssets,
  type LongImageExportBlockBoundary,
  type LongImageExportMeasurements,
} from "../../features/plan/blocknote/export/longImageExportModel";
import {
  type DomCaptureAdapter,
  type DomCaptureCanvasResult,
} from "../capture/domCapture";
import { modernScreenshotCaptureAdapter } from "../capture/modernScreenshotCapture";
import {
  mountLongImageExportSurface,
  type LongImageExportSurfaceHandle,
  type MountLongImageExportSurfaceOptions,
} from "./longImageExportSurface";

export type LongImageExportPhase =
  | "prepare"
  | "assets"
  | "layout"
  | "render"
  | "encode";

export interface LongImageExportProgress {
  readonly phase: LongImageExportPhase;
  readonly partNumber?: number;
  readonly partCount?: number;
}

export interface BlockNoteLongImageExportOptions {
  readonly allowSplit?: boolean;
  readonly width?: LongImageWidth;
  readonly theme?: "light" | "dark";
  readonly timeoutMs?: number;
}

export interface BlockNoteLongImageExportRequest {
  readonly plan: ProjectPlanV14;
  readonly resolvedAssets: Readonly<Record<string, string>>;
  readonly preset: LongImagePresetId;
  readonly options?: BlockNoteLongImageExportOptions;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: LongImageExportProgress) => void;
}

export class BlockNoteLongImageExportError extends Error {
  constructor(
    readonly phase: LongImageExportPhase,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BlockNoteLongImageExportError";
  }
}

type MountSurface = (
  options: MountLongImageExportSurfaceOptions,
) => Promise<LongImageExportSurfaceHandle>;

type EncodeCanvas = (
  canvas: HTMLCanvasElement,
  format: LongImageFormat,
  quality?: number,
) => Promise<Blob>;

export interface BlockNoteLongImageExporterDependencies {
  readonly captureAdapter?: DomCaptureAdapter;
  readonly mountSurface?: MountSurface;
  readonly encodeCanvas?: EncodeCanvas;
}

interface EncodedDraft {
  readonly bytes: Uint8Array;
  readonly quality?: number;
}

const roundedPixel = (value: number): number => Math.ceil(value - 0.001);

function abortError(): DOMException {
  return new DOMException("Long-image export was cancelled.", "AbortError");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function report(
  callback: BlockNoteLongImageExportRequest["onProgress"],
  phase: LongImageExportPhase,
  partNumber?: number,
  partCount?: number,
): void {
  callback?.(Object.freeze({
    phase,
    ...(partNumber === undefined ? {} : { partNumber }),
    ...(partCount === undefined ? {} : { partCount }),
  }));
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateRect(
  boundary: LongImageExportBlockBoundary,
  documentHeight: number,
  category: string,
): void {
  if (
    !boundary.blockId ||
    !boundary.blockType ||
    !Number.isFinite(boundary.top) ||
    !Number.isFinite(boundary.bottom) ||
    boundary.top < 0 ||
    boundary.bottom <= boundary.top ||
    boundary.bottom > documentHeight + 0.01
  ) {
    throw new BlockNoteLongImageExportError(
      "layout",
      `Long-image ${category} boundary "${boundary.blockId || "unknown"}" is invalid.`,
    );
  }
}

function measuredBlocksFrom(
  measurements: LongImageExportMeasurements,
): readonly LongImageMeasuredBlock[] {
  const documentHeight = roundedPixel(measurements.height);
  if (documentHeight <= 0 || measurements.topLevelBlocks.length === 0) {
    throw new BlockNoteLongImageExportError(
      "layout",
      "Long-image export produced an empty document surface.",
    );
  }
  measurements.atomicBlocks.forEach((boundary) =>
    validateRect(boundary, measurements.height, "atomic block")
  );
  measurements.columnRows.forEach((boundary) =>
    validateRect(boundary, measurements.height, "column row")
  );
  measurements.imageGroupRows.forEach((row) => {
    if (
      !row.id ||
      !row.blockId ||
      !row.groupId ||
      !Number.isInteger(row.rowIndex) ||
      row.rowIndex < 0 ||
      row.imageIds.length === 0 ||
      !Number.isFinite(row.top) ||
      !Number.isFinite(row.bottom) ||
      row.top < 0 ||
      row.bottom <= row.top ||
      row.bottom > measurements.height + 0.01
    ) {
      throw new BlockNoteLongImageExportError(
        "layout",
        `Long-image row boundary "${row.id || "unknown"}" is invalid.`,
      );
    }
  });

  let top = 0;
  let previousMeasuredBottom = 0;
  const blocks = measurements.topLevelBlocks.map((boundary, index) => {
    validateRect(boundary, measurements.height, "top-level block");
    if (boundary.bottom <= previousMeasuredBottom) {
      throw new BlockNoteLongImageExportError(
        "layout",
        `Long-image block "${boundary.blockId}" is not in document order.`,
      );
    }
    previousMeasuredBottom = boundary.bottom;
    const isLast = index === measurements.topLevelBlocks.length - 1;
    const bottom = isLast
      ? documentHeight
      : Math.min(
        documentHeight - 1,
        Math.max(top + 1, roundedPixel(boundary.bottom)),
      );
    if (bottom <= top) {
      throw new BlockNoteLongImageExportError(
        "layout",
        `Long-image block "${boundary.blockId}" does not advance the capture boundary.`,
      );
    }

    const rows = measurements.imageGroupRows
      .filter((row) => row.blockId === boundary.blockId)
      .sort((left, right) =>
        left.rowIndex - right.rowIndex || left.bottom - right.bottom
      );
    let previousRowBottom = top;
    const imageGroupRows = rows.map((row, rowIndex) => {
      if (
        row.rowIndex !== rowIndex ||
        !row.groupId ||
        row.imageIds.length === 0
      ) {
        throw new BlockNoteLongImageExportError(
          "layout",
          `Long-image row metadata for block "${boundary.blockId}" is incomplete.`,
        );
      }
      const rowBottom = rowIndex === rows.length - 1
        ? bottom
        : Math.min(
          bottom - 1,
          Math.max(previousRowBottom + 1, roundedPixel(row.bottom)),
        );
      if (rowBottom <= previousRowBottom) {
        throw new BlockNoteLongImageExportError(
          "layout",
          `Long-image rows for block "${boundary.blockId}" overlap after pixel alignment.`,
        );
      }
      previousRowBottom = rowBottom;
      return Object.freeze({ rowIndex, bottom: rowBottom });
    });

    const measured = Object.freeze({
      blockId: boundary.blockId,
      blockType: boundary.blockType,
      top,
      bottom,
      atomic: true as const,
      ...(imageGroupRows.length > 0
        ? { imageGroupRows: Object.freeze(imageGroupRows) }
        : {}),
    });
    top = bottom;
    return measured;
  });
  return Object.freeze(blocks);
}

function freezePart(part: LongImagePart, index: number): LongImagePart {
  return Object.freeze({ ...part, index });
}

function reindexParts(parts: readonly LongImagePart[]): LongImagePart[] {
  return parts.map(freezePart);
}

function splitPartAt(
  part: LongImagePart,
  boundary: LongImageBoundary,
): readonly [LongImagePart, LongImagePart] {
  if (boundary.position <= part.top || boundary.position >= part.bottom) {
    throw new BlockNoteLongImageExportError(
      "encode",
      `Byte-driven split for part ${part.index + 1} did not make forward progress.`,
    );
  }
  return [
    Object.freeze({
      index: part.index,
      top: part.top,
      bottom: boundary.position,
      height: boundary.position - part.top,
      endKind: boundary.kind,
      endBlockId: boundary.blockId,
      ...(boundary.rowIndex === undefined
        ? {}
        : { endRowIndex: boundary.rowIndex }),
    }),
    Object.freeze({
      ...part,
      index: part.index + 1,
      top: boundary.position,
      height: part.bottom - boundary.position,
    }),
  ];
}

function assertSafePart(part: LongImagePart, width: LongImageWidth): void {
  const estimate = estimateLongImageDecodedMemory(width, part.height);
  if (!estimate.withinSafetyBudget) {
    throw new LongImageContractError(
      "UNSAFE_CANVAS",
      `Part ${part.index + 1} exceeds safe canvas or decoded-memory limits.`,
      {
        partIndex: part.index,
        width,
        height: part.height,
        rgbaBytes: estimate.rgbaBytes,
      },
    );
  }
}

function requireCanvas(
  value: Awaited<ReturnType<DomCaptureAdapter["capture"]>>,
  part: LongImagePart,
  width: LongImageWidth,
): DomCaptureCanvasResult {
  if (
    value.output !== "canvas" ||
    value.width !== width ||
    value.height !== part.height ||
    value.canvas.width !== width ||
    value.canvas.height !== part.height
  ) {
    if (value.output === "canvas") {
      releaseCanvas(value.canvas);
    }
    throw new BlockNoteLongImageExportError(
      "render",
      `Captured part ${part.index + 1} did not match ${width}x${part.height}px.`,
    );
  }
  return value;
}

function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
  canvas.remove();
}

async function defaultEncodeCanvas(
  canvas: HTMLCanvasElement,
  format: LongImageFormat,
  quality?: number,
): Promise<Blob> {
  const mime = format === "jpeg" ? "image/jpeg" : "image/png";
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error(`Canvas returned no ${mime} Blob.`));
      },
      mime,
      quality,
    );
  });
}

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

function matchingJpegBlob(
  candidate: { readonly quality: number; readonly blob: Blob } | undefined,
  quality: number | undefined,
): Blob | undefined {
  if (!candidate || candidate.quality !== quality) return undefined;
  return candidate.blob;
}

function finalWarnings(
  warnings: readonly LongImageWarning[],
  partCount: number,
): readonly LongImageWarning[] {
  return Object.freeze(warnings.map((warning) =>
    Object.freeze({
      ...warning,
      ...(warning.partIndex === undefined
        ? {}
        : { partIndex: Math.min(warning.partIndex, partCount - 1) }),
    })
  ));
}

function finalManifest(
  initial: LongImageExportManifest,
  parts: readonly LongImagePart[],
  warnings: readonly LongImageWarning[],
): LongImageExportManifest {
  const fileNames = planLongImageFileNames({
    baseName: initial.baseName,
    format: initial.format,
    partCount: parts.length,
  });
  return Object.freeze({
    ...initial,
    parts: Object.freeze([...parts]),
    fileNames,
    warnings,
  });
}

export class BlockNoteLongImageExporter {
  private readonly captureAdapter: DomCaptureAdapter;
  private readonly mountSurface: MountSurface;
  private readonly encodeCanvas: EncodeCanvas;

  constructor(dependencies: BlockNoteLongImageExporterDependencies = {}) {
    this.captureAdapter =
      dependencies.captureAdapter ?? modernScreenshotCaptureAdapter;
    this.mountSurface = dependencies.mountSurface ?? mountLongImageExportSurface;
    this.encodeCanvas = dependencies.encodeCanvas ?? defaultEncodeCanvas;
  }

  async export(
    request: BlockNoteLongImageExportRequest,
  ): Promise<LongImageExportResult> {
    let surface: LongImageExportSurfaceHandle | undefined;
    let captureSession:
      Awaited<ReturnType<DomCaptureAdapter["createSession"]>> | undefined;
    report(request.onProgress, "prepare");
    throwIfAborted(request.signal);

    let plan: ProjectPlanV14;
    try {
      plan = validateProjectPlanV14(structuredClone(request.plan));
    } catch (error) {
      throw new BlockNoteLongImageExportError(
        "prepare",
        `Long-image export requires a valid schema-14 plan: ${detail(error)}`,
        { cause: error },
      );
    }
    const preset = LONG_IMAGE_PRESETS[request.preset];
    if (!preset) {
      throw new BlockNoteLongImageExportError(
        "prepare",
        `Unknown long-image preset "${String(request.preset)}".`,
      );
    }
    const width = request.options?.width ?? preset.width;
    const allowSplit = request.options?.allowSplit ?? false;
    const assets = Object.freeze({ ...request.resolvedAssets });

    try {
      report(request.onProgress, "assets");
      throwIfAborted(request.signal);
      try {
        validateLongImageExportAssets(plan, assets);
      } catch (error) {
        throw new BlockNoteLongImageExportError(
          "assets",
          `Long-image export asset validation failed: ${detail(error)}`,
          { cause: error },
        );
      }
      surface = await this.mountSurface({
        plan,
        resolvedAssets: assets,
        outerWidth: width,
        theme: request.options?.theme,
        timeoutMs: request.options?.timeoutMs,
        signal: request.signal,
      });
      throwIfAborted(request.signal);

      report(request.onProgress, "layout");
      if (surface.measurements.outerWidth !== width) {
        throw new BlockNoteLongImageExportError(
          "layout",
          `Long-image surface measured ${surface.measurements.outerWidth}px instead of the requested ${width}px.`,
        );
      }
      const blocks = measuredBlocksFrom(surface.measurements);
      const documentHeight = roundedPixel(surface.measurements.height);
      const initialManifest = buildLongImageExportManifest({
        projectTitle: plan.title,
        preset: request.preset,
        width,
        documentHeight,
        blocks,
        allowSplit,
      });
      let parts = reindexParts(initialManifest.parts);
      parts.forEach((part) => assertSafePart(part, width));
      assertLongImageCumulativeBudget({
        preset: request.preset,
        partCount: parts.length,
        retainedBytes: 0,
      });
      const drafts: EncodedDraft[] = [];
      let retainedBytes = 0;
      const maximumResplits = blocks.reduce(
        (total, block) => total + 1 + (block.imageGroupRows?.length ?? 0),
        0,
      );
      let resplitCount = 0;
      let partIndex = 0;

      captureSession = await this.captureAdapter.createSession(surface.element);
      while (partIndex < parts.length) {
        throwIfAborted(request.signal);
        const part = parts[partIndex]!;
        assertSafePart(part, width);
        report(
          request.onProgress,
          "render",
          partIndex + 1,
          parts.length,
        );
        throwIfAborted(request.signal);
        let canvas: HTMLCanvasElement | undefined;
        try {
          const captured = requireCanvas(
            await captureSession.capture({
              output: "canvas",
              format: preset.format === "jpeg"
                ? "image/jpeg"
                : "image/png",
              viewport: {
                x: 0,
                y: part.top,
                width,
                height: part.height,
                sourceWidth: width,
                sourceHeight: documentHeight,
              },
            }),
            part,
            width,
          );
          canvas = captured.canvas;
          throwIfAborted(request.signal);
          report(
            request.onProgress,
            "encode",
            partIndex + 1,
            parts.length,
          );
          throwIfAborted(request.signal);

          let decision:
            Awaited<ReturnType<typeof decideJpegEncoding>> |
            ReturnType<typeof decidePngEncoding>;
          let acceptedBlob: Blob | undefined;
          if (preset.format === "jpeg") {
            let acceptedCandidate:
              { readonly quality: number; readonly blob: Blob } | undefined;
            decision = await decideJpegEncoding({
              limits: preset.limits,
              maxIterations: 12,
              encodeSize: async (quality) => {
                throwIfAborted(request.signal);
                const blob = await this.encodeCanvas!(
                  canvas!,
                  "jpeg",
                  quality,
                );
                throwIfAborted(request.signal);
                if (
                  blob.size <= preset.limits.targetBytes &&
                  (
                    acceptedCandidate === undefined ||
                    quality > acceptedCandidate.quality
                  )
                ) {
                  acceptedCandidate = { quality, blob };
                }
                return blob.size;
              },
            });
            if (decision.kind === "accepted") {
              acceptedBlob = matchingJpegBlob(
                acceptedCandidate,
                decision.quality,
              );
            }
          } else {
            acceptedBlob = await this.encodeCanvas(canvas, "png");
            throwIfAborted(request.signal);
            decision = decidePngEncoding({
              encodedBytes: acceptedBlob.size,
              limits: preset.limits,
            });
          }

          if (decision.kind === "resplit") {
            if (resplitCount >= maximumResplits) {
              throw new BlockNoteLongImageExportError(
                "encode",
                "Long-image byte-limit splitting exhausted all bounded retries.",
              );
            }
            const boundary = findEarlierLongImageBoundary({
              part,
              blocks,
              allowSplit,
            });
            const replacement = splitPartAt(part, boundary);
            parts = reindexParts([
              ...parts.slice(0, partIndex),
              ...replacement,
              ...parts.slice(partIndex + 1),
            ]);
            assertLongImageCumulativeBudget({
              preset: request.preset,
              partCount: parts.length,
              retainedBytes,
            });
            resplitCount += 1;
            continue;
          }

          if (!acceptedBlob) {
            throw new BlockNoteLongImageExportError(
              "encode",
              `JPEG encoding did not retain the accepted Blob for part ${partIndex + 1}.`,
            );
          }
          const nextRetainedBytes = assertLongImageCumulativeBudget({
            preset: request.preset,
            partCount: parts.length,
            retainedBytes,
            nextPartBytes: acceptedBlob.size,
          });
          const bytes = await blobBytes(acceptedBlob);
          throwIfAborted(request.signal);
          assertLongImageCumulativeBudget({
            preset: request.preset,
            partCount: parts.length,
            retainedBytes,
            nextPartBytes: bytes.byteLength,
          });
          retainedBytes = nextRetainedBytes;
          drafts.push(Object.freeze({
            bytes,
            ...(decision.quality === undefined
              ? {}
              : { quality: decision.quality }),
          }));
          partIndex += 1;
        } catch (error) {
          if (
            error instanceof LongImageContractError ||
            error instanceof BlockNoteLongImageExportError ||
            (error instanceof DOMException && error.name === "AbortError")
          ) {
            throw error;
          }
          throw new BlockNoteLongImageExportError(
            canvas ? "encode" : "render",
            `${canvas ? "Encoding" : "Capturing"} long-image part ${partIndex + 1} failed: ${detail(error)}`,
            { cause: error },
          );
        } finally {
          if (canvas) releaseCanvas(canvas);
        }
      }

      const warnings = finalWarnings(initialManifest.warnings, parts.length);
      const manifest = finalManifest(initialManifest, parts, warnings);
      const encodedParts: readonly LongImageEncodedPart[] = Object.freeze(
        drafts.map((draft, index) => Object.freeze({
          part: parts[index]!,
          fileName: manifest.fileNames[index]!,
          mime: manifest.format === "jpeg" ? "image/jpeg" : "image/png",
          width,
          height: parts[index]!.height,
          encodedBytes: draft.bytes.byteLength,
          bytes: draft.bytes,
          ...(draft.quality === undefined ? {} : { quality: draft.quality }),
        })),
      );
      return Object.freeze({
        manifest,
        parts: encodedParts,
        totalBytes: encodedParts.reduce(
          (total, part) => total + part.encodedBytes,
          0,
        ),
        warnings,
      });
    } finally {
      captureSession?.close();
      surface?.destroy();
    }
  }
}

export const blockNoteLongImageExporter = new BlockNoteLongImageExporter();
