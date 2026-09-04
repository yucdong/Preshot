// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { ProjectPlanV14 } from "../../domain/plan/canvas/blockDocument";
import { PreshotPdfPreflightError } from "../../domain/plan/blocknote/pdfExportPreflight";
import { PDF_VISUAL_CONTRACT } from "../../domain/plan/blocknote/pdfVisualContract";
import { preshotBlockNoteSchema } from "../../features/plan/blocknote/preshotBlockNoteSchema";
import { createPreshotPdfExportContext } from "./blockNotePdfPreflight";
import {
  imageDataFromDataUrl,
  type PdfImageDrawBox,
  type PdfImageView,
} from "./pdfImageOptimizer";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function imageGroup(
  id: string,
  source: string,
  frameWidth: number,
  crop?: { x: number; y: number; width: number; height: number },
) {
  return {
    id,
    name: id,
    type: "reference" as const,
    x: 0,
    width: 500,
    height: 200,
    description: "",
    images: [{
      id: `${id}-image`,
      file: source,
      aspectRatio: 1,
      sourceWidth: 600,
      sourceHeight: 600,
      frameWidth,
      frameHeight: frameWidth,
      ...(crop ? { crop } : {}),
    }],
  };
}

function plan(
  blocks: ProjectPlanV14["document"]["blocks"],
  imageGroups: ProjectPlanV14["imageGroups"],
): ProjectPlanV14 {
  return {
    schemaVersion: 15,
    artifacts: [],
    title: "Preflight",
    document: { format: "preshot-blocks", version: 3, blocks },
    imageGroups,
  };
}

describe("createPreshotPdfExportContext", () => {
  it("normalizes full crops and optimizes repeated sources once at the largest draw box", async () => {
    const optimizeImage = vi.fn(async (
      dataUrl: string,
      _drawBox: PdfImageDrawBox,
      _view?: PdfImageView,
    ) => imageDataFromDataUrl(dataUrl));
    const source = "references/repeated.png";
    const context = await createPreshotPdfExportContext({
      schema: preshotBlockNoteSchema,
      plan: plan([
        {
          id: "first-block",
          type: "imageGroup",
          props: { groupId: "first" },
          content: undefined,
          children: [],
        },
        {
          id: "second-block",
          type: "imageGroup",
          props: { groupId: "second" },
          content: undefined,
          children: [],
        },
      ], [
        imageGroup("first", source, 80),
        imageGroup(
          "second",
          source,
          180,
          { x: 0, y: 0, width: 1, height: 1 },
        ),
      ]),
      resolvedAssets: { [source]: TINY_PNG },
      visualContract: PDF_VISUAL_CONTRACT,
    }, { optimizeImage });

    expect(optimizeImage).toHaveBeenCalledTimes(1);
    expect(context.assets).toHaveLength(1);
    expect(context.assets[0].uses).toHaveLength(2);
    expect(context.assets[0].dpi).toBe(144);
    expect(context.assets[0].drawBox).toEqual({
      width: context.groupsByGroupId.second.slots[0].pdf.width,
      height: context.groupsByGroupId.second.slots[0].pdf.height,
    });
    expect(context.groupsByGroupId.first.slots[0].assetId).toBe(
      context.groupsByGroupId.second.slots[0].assetId,
    );
    expect(optimizeImage.mock.calls[0]?.[2]).toEqual({
      crop: { x: 0, y: 0, width: 1, height: 1 },
    });
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.groups)).toBe(true);
    expect(Object.isFrozen(preshotBlockNoteSchema)).toBe(false);
  });

  it("keeps distinct normalized crops in distinct cache entries", async () => {
    const optimizeImage = vi.fn(async (dataUrl: string) =>
      imageDataFromDataUrl(dataUrl)
    );
    const source = "references/crops.png";
    const context = await createPreshotPdfExportContext({
      schema: preshotBlockNoteSchema,
      plan: plan([
        {
          id: "first-block",
          type: "imageGroup",
          props: { groupId: "first" },
          content: undefined,
          children: [],
        },
        {
          id: "second-block",
          type: "imageGroup",
          props: { groupId: "second" },
          content: undefined,
          children: [],
        },
      ], [
        imageGroup("first", source, 100),
        imageGroup(
          "second",
          source,
          100,
          { x: 0.25, y: 0, width: 0.5, height: 1 },
        ),
      ]),
      resolvedAssets: { [source]: TINY_PNG },
      visualContract: PDF_VISUAL_CONTRACT,
    }, { optimizeImage });

    expect(optimizeImage).toHaveBeenCalledTimes(2);
    expect(context.assets.map((asset) => asset.crop)).toEqual([
      { x: 0, y: 0, width: 1, height: 1 },
      { x: 0.25, y: 0, width: 0.5, height: 1 },
    ]);
  });

  it("reports a missing asset with block/group/image context", async () => {
    const source = "references/missing.png";
    await expect(createPreshotPdfExportContext({
      schema: preshotBlockNoteSchema,
      plan: plan([{
        id: "group-block",
        type: "imageGroup",
        props: { groupId: "group" },
        content: undefined,
        children: [],
      }], [imageGroup("group", source, 100)]),
      resolvedAssets: {},
      visualContract: PDF_VISUAL_CONTRACT,
    })).rejects.toMatchObject({
      fatalErrors: [{
        code: "MISSING_IMAGE_ASSET",
        blockId: "group-block",
        groupId: "group",
        imageId: "group-image",
        source,
      }],
    });
  });

  it("wraps corrupt optimizer failures with actionable context", async () => {
    const source = "references/corrupt.png";
    const optimizeImage = vi.fn().mockRejectedValue(
      new Error("Unable to decode bitmap"),
    );

    await expect(createPreshotPdfExportContext({
      schema: preshotBlockNoteSchema,
      plan: plan([{
        id: "group-block",
        type: "imageGroup",
        props: { groupId: "group" },
        content: undefined,
        children: [],
      }], [imageGroup("group", source, 100)]),
      resolvedAssets: { [source]: TINY_PNG },
      visualContract: PDF_VISUAL_CONTRACT,
    }, { optimizeImage })).rejects.toSatisfy((error) => {
      expect(error).toBeInstanceOf(PreshotPdfPreflightError);
      expect(error.message).toContain("group-block");
      expect(error.message).toContain("group-image");
      expect(error.message).toContain("Unable to decode bitmap");
      return true;
    });
  });

  it("prepares native images locally and never resolves an external hosted proxy", async () => {
    const optimizeImage = vi.fn(async (dataUrl: string) =>
      imageDataFromDataUrl(dataUrl)
    );
    const measureImage = vi.fn().mockResolvedValue({
      width: 800,
      height: 400,
    });
    const localSource = "media/native.png";
    const hostedProxy = "https://proxy.blocknote.example/private.png";
    const resolvedAssets = new Proxy(
      { [localSource]: TINY_PNG },
      {
        get(target, property, receiver) {
          if (property === hostedProxy) {
            throw new Error("Hosted proxy must not be used");
          }
          return Reflect.get(target, property, receiver);
        },
      },
    );
    const context = await createPreshotPdfExportContext({
      schema: preshotBlockNoteSchema,
      plan: plan([
        {
          id: "local",
          type: "image",
          props: {
            name: "native.png",
            url: localSource,
            caption: "",
            showPreview: true,
            previewWidth: 200,
          },
          content: undefined,
          children: [],
        },
        {
          id: "external",
          type: "image",
          props: {
            name: "private.png",
            url: hostedProxy,
            caption: "",
            showPreview: true,
          },
          content: undefined,
          children: [],
        },
      ], []),
      resolvedAssets,
      visualContract: PDF_VISUAL_CONTRACT,
    }, { optimizeImage, measureImage });

    expect(measureImage).toHaveBeenCalledTimes(1);
    expect(optimizeImage).toHaveBeenCalledTimes(1);
    expect(context.nativeImagesByBlockId.local).toMatchObject({
      source: localSource,
      logicalWidth: 200,
      logicalHeight: 100,
    });
    expect(context.nativeImagesByBlockId.external).toBeUndefined();
  });

  it("uses measured caption wrapping before optimizing a tall native image", async () => {
    const source = "media/captioned.png";
    const measureCaptionText = vi.fn(
      (value: string, fontSize: number) =>
        Array.from(value).length * fontSize * 0.5,
    );
    const context = await createPreshotPdfExportContext({
      schema: preshotBlockNoteSchema,
      plan: plan([{
        id: "captioned",
        type: "image",
        props: {
          name: "captioned.png",
          url: source,
          caption: "caption ".repeat(80).trim(),
          showPreview: true,
          previewWidth: 400,
        },
        content: undefined,
        children: [],
      }], []),
      resolvedAssets: { [source]: TINY_PNG },
      visualContract: PDF_VISUAL_CONTRACT,
    }, {
      measureImage: async () => ({ width: 100, height: 1_000 }),
      measureCaptionText,
      optimizeImage: async (dataUrl) => imageDataFromDataUrl(dataUrl),
    });
    const image = context.nativeImagesByBlockId.captioned;

    expect(measureCaptionText).toHaveBeenCalled();
    expect(image.captionLines.length).toBeGreaterThan(1);
    expect(image.captionWidth).toBeGreaterThan(image.pdfWidth);
    expect(image.blockHeight).toBeLessThanOrEqual(
      PDF_VISUAL_CONTRACT.page.contentHeight,
    );
    expect(context.assets[0].drawBox).toEqual({
      width: image.pdfWidth,
      height: image.pdfHeight,
    });
  });
});
