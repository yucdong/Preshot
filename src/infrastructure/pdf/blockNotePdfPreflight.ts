import type {
  BlockSchema,
  CustomBlockNoteSchema,
  InlineContentSchema,
  StyleSchema,
} from "@blocknote/core";
import type {
  PreshotBlock,
  ProjectPlanV14,
} from "../../domain/plan/canvas/blockDocument";
import {
  PDF_VISUAL_CONTRACT,
} from "../../domain/plan/blocknote/pdfVisualContract";
import {
  PreshotPdfPreflightError,
  buildPreshotPdfLayoutManifest,
  freezePreshotPdfExportContext,
  validatePreshotPdfPlan,
  type NativeImageDimensions,
  type PreshotPdfExportContext,
  type PreshotPdfOptimizedAsset,
  type PreshotPdfPreflightIssue,
} from "../../domain/plan/blocknote/pdfExportPreflight";
import type { PdfCaptionTextMeasurer } from "../../domain/plan/blocknote/pdfCaptionLayout";
import {
  PDF_IMAGE_DPI,
  imageDataFromDataUrl,
  optimizePdfImage,
  type PdfImageOptimizer,
} from "./pdfImageOptimizer";
import { createReactPdfCaptionTextMeasurer } from "./reactPdfCaptionMetrics";

export type PdfImageMeasurer = (
  dataUrl: string,
) => Promise<NativeImageDimensions>;

const LOCAL_NATIVE_IMAGE_SOURCE = /^media\/[^/\\]+$/i;
const REQUIRED_BLOCK_SPECS = [
  "column",
  "columnList",
  "image",
  "imageGroup",
] as const;

function issue(
  code: PreshotPdfPreflightIssue["code"],
  message: string,
  context: Omit<PreshotPdfPreflightIssue, "severity" | "code" | "message"> = {},
): PreshotPdfPreflightIssue {
  return {
    severity: "fatal",
    code,
    message,
    ...context,
  };
}

function reject(issueValue: PreshotPdfPreflightIssue): never {
  throw new PreshotPdfPreflightError([issueValue]);
}

function validateSchema(schema: {
  readonly blockSpecs?: Readonly<Record<string, unknown>>;
}): void {
  const missing = REQUIRED_BLOCK_SPECS.filter(
    (name) => !schema.blockSpecs?.[name],
  );
  if (missing.length > 0) {
    reject(issue(
      "INVALID_BLOCKNOTE_SCHEMA",
      `PDF preflight requires the shared BlockNote schema; missing block specs: ${missing.join(", ")}.`,
    ));
  }
}

function assertImageData(
  dataUrl: string,
  context: {
    blockId: string;
    groupId?: string;
    imageId?: string;
    source: string;
  },
): void {
  try {
    const parsed = imageDataFromDataUrl(dataUrl);
    if (!/^image\/(?:jpeg|png|gif|webp)$/i.test(parsed.mime)) {
      throw new Error(`unsupported MIME type "${parsed.mime}"`);
    }
    if (parsed.bytes.length === 0) {
      throw new Error("empty image payload");
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    reject(issue(
      "CORRUPT_IMAGE_ASSET",
      `PDF preflight rejected image data for block "${context.blockId}"${
        context.groupId ? `, group "${context.groupId}"` : ""
      }${context.imageId ? `, image "${context.imageId}"` : ""}, source "${context.source}": ${reason}.`,
      context,
    ));
  }
}

export const measureBrowserPdfImage: PdfImageMeasurer = async (dataUrl) => {
  const image = new Image();
  image.decoding = "async";
  const loaded = new Promise<void>((resolve, rejectLoad) => {
    image.onload = () => resolve();
    image.onerror = () =>
      rejectLoad(new Error("Unable to decode image dimensions"));
  });
  image.src = dataUrl;
  try {
    await image.decode();
  } catch {
    await loaded;
  }
  if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    throw new Error("Decoded image dimensions are invalid");
  }
  return {
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
};

function localNativeImageBlocks(
  blocks: readonly PreshotBlock[],
): PreshotBlock[] {
  const result: PreshotBlock[] = [];
  const visit = (entries: readonly PreshotBlock[]) => {
    for (const block of entries) {
      if (
        block.type === "image" &&
        LOCAL_NATIVE_IMAGE_SOURCE.test(String(block.props.url ?? ""))
      ) {
        result.push(block);
      }
      visit(block.children);
    }
  };
  visit(blocks);
  return result;
}

export async function createPreshotPdfExportContext<
  B extends BlockSchema,
  I extends InlineContentSchema,
  S extends StyleSchema,
>(
  input: {
    readonly plan: ProjectPlanV14;
    readonly schema: CustomBlockNoteSchema<B, I, S>;
    readonly resolvedAssets: Readonly<Record<string, string>>;
    readonly visualContract: typeof PDF_VISUAL_CONTRACT;
  },
  options: {
    readonly optimizeImage?: PdfImageOptimizer;
    readonly measureImage?: PdfImageMeasurer;
    readonly measureCaptionText?: PdfCaptionTextMeasurer;
    readonly captionFontSource?: string;
  } = {},
): Promise<PreshotPdfExportContext<CustomBlockNoteSchema<B, I, S>>> {
  validateSchema(input.schema);
  const plan = validatePreshotPdfPlan(input.plan);
  const optimizeImage = options.optimizeImage ?? optimizePdfImage;
  const measureImage = options.measureImage ?? measureBrowserPdfImage;
  const nativeDimensions: Record<string, NativeImageDimensions> = {};
  const measuredBySource = new Map<string, NativeImageDimensions>();
  const nativeBlocks = localNativeImageBlocks(plan.document.blocks);

  for (const block of nativeBlocks) {
    const source = String(block.props.url);
    const dataUrl = input.resolvedAssets[source];
    if (!dataUrl) {
      reject(issue(
        "MISSING_IMAGE_ASSET",
        `PDF preflight is missing native image data for block "${block.id}", source "${source}".`,
        { blockId: block.id, source },
      ));
    }
    assertImageData(dataUrl, { blockId: block.id, source });
    let dimensions = measuredBySource.get(source);
    if (!dimensions) {
      try {
        dimensions = await measureImage(dataUrl);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        reject(issue(
          "CORRUPT_IMAGE_ASSET",
          `PDF preflight could not decode native image dimensions for block "${block.id}", source "${source}": ${reason}.`,
          { blockId: block.id, source },
        ));
      }
      measuredBySource.set(source, dimensions);
    }
    nativeDimensions[block.id] = dimensions;
  }

  const hasNativeCaption = nativeBlocks.some(
    (block) => Boolean(block.props.caption),
  );
  const measureCaptionText = options.measureCaptionText ??
    (hasNativeCaption
      ? await createReactPdfCaptionTextMeasurer(options.captionFontSource)
      : undefined);
  const layout = buildPreshotPdfLayoutManifest({
    plan,
    nativeImageDimensions: nativeDimensions,
    measureCaptionText,
    visualContract: input.visualContract,
  });
  const assets: PreshotPdfOptimizedAsset[] = [];

  for (const request of layout.assetRequests) {
    const firstUse = request.uses[0];
    const context = {
      blockId: firstUse.blockId,
      ...(firstUse.groupId ? { groupId: firstUse.groupId } : {}),
      ...(firstUse.imageId ? { imageId: firstUse.imageId } : {}),
      source: request.source,
    };
    const dataUrl = input.resolvedAssets[request.source];
    if (!dataUrl) {
      reject(issue(
        "MISSING_IMAGE_ASSET",
        `PDF preflight is missing image data for block "${firstUse.blockId}"${
          firstUse.groupId ? `, group "${firstUse.groupId}"` : ""
        }${firstUse.imageId ? `, image "${firstUse.imageId}"` : ""}, source "${request.source}".`,
        context,
      ));
    }
    assertImageData(dataUrl, context);
    try {
      const optimized = await optimizeImage(
        dataUrl,
        request.largestDrawBox,
        { crop: request.crop },
      );
      if (
        !/^image\/(?:jpeg|png)$/i.test(optimized.mime) ||
        optimized.bytes.length === 0
      ) {
        throw new Error("optimizer returned an empty or unsupported image");
      }
      assets.push({
        assetId: request.assetId,
        cacheKey: request.cacheKey,
        source: request.source,
        crop: request.crop,
        drawBox: request.largestDrawBox,
        dpi: PDF_IMAGE_DPI,
        mime: optimized.mime,
        bytes: new Uint8Array(optimized.bytes),
        uses: request.uses,
      });
    } catch (error) {
      if (error instanceof PreshotPdfPreflightError) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      reject(issue(
        "CORRUPT_IMAGE_ASSET",
        `PDF preflight could not optimize image data for block "${firstUse.blockId}"${
          firstUse.groupId ? `, group "${firstUse.groupId}"` : ""
        }${firstUse.imageId ? `, image "${firstUse.imageId}"` : ""}, source "${request.source}": ${reason}.`,
        context,
      ));
    }
  }

  const assetsById = Object.fromEntries(
    assets.map((asset) => [asset.assetId, asset]),
  );
  return freezePreshotPdfExportContext({
    ...layout,
    schema: input.schema,
    assets,
    assetsById,
  }, [input.schema]);
}
