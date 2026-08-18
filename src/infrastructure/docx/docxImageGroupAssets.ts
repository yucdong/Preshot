import type { PreshotPdfExportContext } from "../../domain/plan/blocknote/pdfExportPreflight";
import {
  optimizeRasterImage,
  type RasterImageOptimizer,
} from "../pdf/pdfImageOptimizer";
import {
  buildPreshotDocxImageGroupCompositeRequest,
  type PreshotDocxImageGroupCompositeRequest,
} from "./imageGroupDocxMapping";

const POINTS_PER_INCH = 72;

interface AssetPlan {
  readonly source: string;
  readonly crop: PreshotDocxImageGroupCompositeRequest["images"][number]["crop"];
  width: number;
  height: number;
}

export interface PreparedDocxImageGroups {
  readonly requestsByBlockId: Readonly<
    Record<string, PreshotDocxImageGroupCompositeRequest>
  >;
  readonly cacheKeys: readonly string[];
}

function cropKey(
  crop: PreshotDocxImageGroupCompositeRequest["images"][number]["crop"],
): string {
  return `${crop.x},${crop.y},${crop.width},${crop.height}`;
}

function baseKey(source: string, crop: AssetPlan["crop"]): string {
  return `${source}|${cropKey(crop)}`;
}

function targetPixels(
  request: PreshotDocxImageGroupCompositeRequest,
  image: PreshotDocxImageGroupCompositeRequest["images"][number],
): { width: number; height: number } {
  return {
    width: Math.max(
      1,
      Math.ceil(
        image.widthPoints * request.raster.width /
          request.display.widthPoints,
      ),
    ),
    height: Math.max(
      1,
      Math.ceil(
        image.heightPoints * request.raster.height /
          request.display.heightPoints,
      ),
    ),
  };
}

function effectivePpi(
  request: PreshotDocxImageGroupCompositeRequest,
  image: PreshotDocxImageGroupCompositeRequest["images"][number],
  target: { width: number; height: number },
  sourceWidth: number,
  sourceHeight: number,
): number {
  const widthInches = image.widthPoints / POINTS_PER_INCH;
  const heightInches = image.heightPoints / POINTS_PER_INCH;
  return Number(Math.min(
    request.raster.effectivePpi,
    target.width / widthInches,
    target.height / heightInches,
    sourceWidth * image.crop.width / widthInches,
    sourceHeight * image.crop.height / heightInches,
  ).toFixed(2));
}

export async function prepareDocxImageGroupAssets(
  exportContext: PreshotPdfExportContext,
  resolvedAssets: Readonly<Record<string, string>>,
  optimizer: RasterImageOptimizer = optimizeRasterImage,
): Promise<PreparedDocxImageGroups> {
  const requests = exportContext.groups.flatMap((group) => {
    const request = buildPreshotDocxImageGroupCompositeRequest({
      id: group.blockId,
      type: "imageGroup",
      props: { groupId: group.groupId },
    }, exportContext);
    return request ? [request] : [];
  });
  const plans = new Map<string, AssetPlan>();

  for (const request of requests) {
    for (const image of request.images) {
      const source = exportContext.assetsById[image.assetId]?.source;
      if (!source) {
        throw new Error(
          `DOCX image-group preparation cannot resolve asset "${image.assetId}".`,
        );
      }
      const target = targetPixels(request, image);
      const key = baseKey(source, image.crop);
      const existing = plans.get(key);
      if (existing) {
        existing.width = Math.max(existing.width, target.width);
        existing.height = Math.max(existing.height, target.height);
      } else {
        plans.set(key, {
          source,
          crop: image.crop,
          ...target,
        });
      }
    }
  }

  const optimizedByKey = new Map<string, Awaited<ReturnType<RasterImageOptimizer>>>();
  const cacheKeys: string[] = [];
  for (const [key, plan] of plans) {
    const dataUrl = resolvedAssets[plan.source];
    if (!dataUrl) {
      throw new Error(
        `DOCX image-group preparation is missing local image data for "${plan.source}".`,
      );
    }
    const cacheKey = `${key}|${plan.width}x${plan.height}`;
    const optimized = await optimizer(
      dataUrl,
      { width: plan.width, height: plan.height },
      { crop: plan.crop },
    );
    if (
      !/^image\/(?:jpeg|png)$/i.test(optimized.mime) ||
      optimized.bytes.length === 0 ||
      optimized.sourceWidth <= 0 ||
      optimized.sourceHeight <= 0
    ) {
      throw new Error(
        `DOCX image-group optimizer returned invalid output for "${plan.source}".`,
      );
    }
    optimizedByKey.set(key, optimized);
    cacheKeys.push(cacheKey);
  }

  const requestsByBlockId = Object.fromEntries(requests.map((request) => {
    const images = request.images.map((image) => {
      const source = exportContext.assetsById[image.assetId]?.source;
      if (!source) {
        throw new Error(
          `DOCX image-group preparation cannot resolve asset "${image.assetId}".`,
        );
      }
      const key = baseKey(source, image.crop);
      const optimized = optimizedByKey.get(key);
      if (!optimized) {
        throw new Error(
          `DOCX image-group preparation lost cached output for "${source}".`,
        );
      }
      const target = targetPixels(request, image);
      return {
        ...image,
        effectivePpi: effectivePpi(
          request,
          image,
          target,
          optimized.sourceWidth,
          optimized.sourceHeight,
        ),
        asset: {
          mime: optimized.mime,
          bytes: optimized.bytes,
        },
      };
    });
    const effective = Math.min(
      request.raster.effectivePpi,
      ...images.map((image) => image.effectivePpi),
    );
    return [request.blockId, {
      ...request,
      raster: {
        ...request.raster,
        effectivePpi: Number(effective.toFixed(2)),
      },
      images,
    }];
  }));

  return { requestsByBlockId, cacheKeys };
}
