import { describe, expect, it, vi } from "vitest";
import {
  buildPreshotPdfLayoutManifest,
  type PreshotPdfExportContext,
} from "../../domain/plan/blocknote/pdfExportPreflight";
import type { ProjectPlanV14 } from "../../domain/plan/canvas/blockDocument";
import { prepareDocxImageGroupAssets } from "./docxImageGroupAssets";
import { createPreshotImageGroupDocxBlockMapping } from "./imageGroupDocxMapping";

const PNG = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13,
]);

function fixture(): {
  plan: ProjectPlanV14;
  block: {
    id: string;
    type: "imageGroup";
    props: { groupId: string };
  };
} {
  const block = {
    id: "group-block",
    type: "imageGroup" as const,
    props: { groupId: "group" },
  };
  return {
    block,
    plan: {
      schemaVersion: 15,
      artifacts: [],
      title: "DOCX assets",
      document: {
        format: "preshot-blocks",
        version: 3,
        blocks: [{
          ...block,
          content: undefined,
          children: [],
        }],
      },
      imageGroups: [{
        id: "group",
        name: "References",
        description: "Repeated crop",
        type: "reference",
        x: 0,
        width: 500,
        height: 240,
        images: [
          {
            id: "first",
            file: "references/shared.webp",
            aspectRatio: 1.5,
            sourceWidth: 2_000,
            sourceHeight: 1_500,
            frameWidth: 240,
            frameHeight: 160,
            crop: { x: 0.1, y: 0.2, width: 0.6, height: 0.6 },
          },
          {
            id: "second",
            file: "references/shared.webp",
            aspectRatio: 1.5,
            sourceWidth: 2_000,
            sourceHeight: 1_500,
            frameWidth: 180,
            frameHeight: 120,
            crop: { x: 0.1, y: 0.2, width: 0.6, height: 0.6 },
          },
        ],
      }],
    },
  };
}

function context(plan: ProjectPlanV14): PreshotPdfExportContext {
  const manifest = buildPreshotPdfLayoutManifest({ plan });
  const assets = manifest.assetRequests.map((request) => ({
    assetId: request.assetId,
    cacheKey: request.cacheKey,
    source: request.source,
    crop: request.crop,
    drawBox: request.largestDrawBox,
    dpi: 144 as const,
    mime: "image/jpeg",
    bytes: Uint8Array.from([1]),
    uses: request.uses,
  }));
  return {
    ...manifest,
    schema: {},
    assets,
    assetsById: Object.fromEntries(
      assets.map((asset) => [asset.assetId, asset]),
    ),
  };
}

describe("DOCX image-group assets", () => {
  it("requests the true largest DOCX crop box and reuses its source/crop cache", async () => {
    const { plan } = fixture();
    const optimizer = vi.fn().mockResolvedValue({
      mime: "image/png",
      bytes: PNG,
      sourceWidth: 2_000,
      sourceHeight: 1_500,
    });

    const prepared = await prepareDocxImageGroupAssets(
      context(plan),
      { "references/shared.webp": "data:image/webp;base64,UklGRg==" },
      optimizer,
    );
    const request = prepared.requestsByBlockId["group-block"]!;
    const targets = request.images.map((image) => ({
      width: Math.ceil(
        image.widthPoints * request.raster.width /
          request.display.widthPoints,
      ),
      height: Math.ceil(
        image.heightPoints * request.raster.height /
          request.display.heightPoints,
      ),
    }));
    const largest = {
      width: Math.max(...targets.map((target) => target.width)),
      height: Math.max(...targets.map((target) => target.height)),
    };

    expect(optimizer).toHaveBeenCalledOnce();
    expect(optimizer).toHaveBeenCalledWith(
      expect.any(String),
      largest,
      { crop: { x: 0.1, y: 0.2, width: 0.6, height: 0.6 } },
    );
    expect(largest.width).toBeGreaterThan(
      Math.ceil(request.images[0]!.widthPoints * 2),
    );
    expect(prepared.cacheKeys).toEqual([
      expect.stringContaining(`|${largest.width}x${largest.height}`),
    ]);
    expect(request.images[0]!.asset.bytes).toBe(
      request.images[1]!.asset.bytes,
    );
  });

  it("warns from real cropped source detail below 150 PPI", async () => {
    const { plan, block } = fixture();
    const exportContext = context(plan);
    const prepared = await prepareDocxImageGroupAssets(
      exportContext,
      { "references/shared.webp": "data:image/webp;base64,UklGRg==" },
      vi.fn().mockResolvedValue({
        mime: "image/png",
        bytes: PNG,
        sourceWidth: 100,
        sourceHeight: 100,
      }),
    );
    const onWarning = vi.fn();

    await createPreshotImageGroupDocxBlockMapping(exportContext, {
      compositor: async () => PNG,
      requestsByBlockId: prepared.requestsByBlockId,
      onWarning,
    })(block);

    expect(prepared.requestsByBlockId["group-block"]!.raster.effectivePpi)
      .toBeLessThan(150);
    expect(onWarning).toHaveBeenCalledWith(expect.objectContaining({
      code: "LOW_EFFECTIVE_PPI",
      effectivePpi:
        prepared.requestsByBlockId["group-block"]!.raster.effectivePpi,
    }));
  });
});
