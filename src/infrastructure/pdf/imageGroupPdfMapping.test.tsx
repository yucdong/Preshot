import { Image, View } from "@react-pdf/renderer";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  buildPreshotPdfLayoutManifest,
  type PreshotPdfExportContext,
} from "../../domain/plan/blocknote/pdfExportPreflight";
import { PDF_VISUAL_CONTRACT } from "../../domain/plan/blocknote/pdfVisualContract";
import type { ProjectPlanV14 } from "../../domain/plan/canvas/blockDocument";
import {
  buildPreshotImageGroupPdfRenderModel,
  PreshotImageGroupPdfRenderError,
} from "./imageGroupPdfRenderModel";
import {
  createPreshotImageGroupPdfBlockMapping,
  injectPreshotImageGroupPdfBlockMapping,
} from "./imageGroupPdfMapping";

function image(
  id: string,
  frameWidth: number,
  frameHeight: number,
  crop = { x: 0, y: 0, width: 1, height: 1 },
) {
  return {
    id,
    file: `references/${id}.png`,
    aspectRatio: frameWidth / frameHeight,
    sourceWidth: 1200,
    sourceHeight: 800,
    frameWidth,
    frameHeight,
    crop,
  };
}

function group(
  id: string,
  options: {
    x?: number;
    width?: number;
    height?: number;
    frameOffsetY?: number;
    images?: ReturnType<typeof image>[];
  } = {},
) {
  return {
    id,
    name: id,
    type: "reference" as const,
    x: options.x ?? 0,
    width: options.width ?? 300,
    height: options.height ?? 160,
    frameOffsetY: options.frameOffsetY,
    description: "",
    images: options.images ?? [image(`${id}-image`, 120, 120)],
  };
}

function imageGroupBlock(id: string, groupId: string) {
  return {
    id,
    type: "imageGroup" as const,
    props: { groupId },
    content: undefined,
    children: [],
  };
}

function plan(
  blocks: ProjectPlanV14["document"]["blocks"],
  imageGroups: ProjectPlanV14["imageGroups"],
): ProjectPlanV14 {
  return {
    schemaVersion: 14,
    title: "Image group PDF",
    document: { format: "preshot-blocks", version: 2, blocks },
    imageGroups,
  };
}

function exportContext(
  value: ProjectPlanV14,
): PreshotPdfExportContext {
  const manifest = buildPreshotPdfLayoutManifest({ plan: value });
  const assets = manifest.assetRequests.map((request, index) => ({
    assetId: request.assetId,
    cacheKey: request.cacheKey,
    source: request.source,
    crop: request.crop,
    drawBox: request.largestDrawBox,
    dpi: 144 as const,
    mime: "image/png",
    bytes: Uint8Array.from([index + 1, index + 2, index + 3]),
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

function childrenOf(element: ReactElement): ReactNode[] {
  const children = (element.props as { children?: ReactNode }).children;
  return Array.isArray(children) ? children : children == null ? [] : [children];
}

function styleOf(element: ReactElement): Record<string, number | string> {
  return (element.props as {
    style: Record<string, number | string>;
  }).style;
}

function elementTypes(node: ReactNode): unknown[] {
  if (!isValidElement(node)) return [];
  return [
    node.type,
    ...childrenOf(node).flatMap((child) => elementTypes(child)),
  ];
}

describe("image-group React-PDF render model", () => {
  it("preserves root group x, y, width, height, surface, and border geometry", () => {
    const source = group("group", {
      x: 36,
      width: 300,
      height: 180,
      frameOffsetY: 14,
    });
    const context = exportContext(plan(
      [imageGroupBlock("block", source.id)],
      [source],
    ));

    const model = buildPreshotImageGroupPdfRenderModel(
      imageGroupBlock("block", source.id),
      context,
    );

    expect(model.kind).toBe("content");
    if (model.kind !== "content") return;
    const scale = PDF_VISUAL_CONTRACT.editor.rootLogicalToPdfScale;
    expect(model.container).toMatchObject({
      backgroundColor: PDF_VISUAL_CONTRACT.imageGroup.surface,
      borderColor: PDF_VISUAL_CONTRACT.imageGroup.border,
      borderWidth: PDF_VISUAL_CONTRACT.imageGroup.borderWidth,
      borderRadius: PDF_VISUAL_CONTRACT.imageGroup.radius,
    });
    expect(model.container.x).toBeCloseTo(36 * scale, 4);
    expect(model.flow.topPadding).toBeCloseTo(14 * scale, 4);
    expect(model.container.y).toBe(0);
    expect(model.container.width).toBeCloseTo(300 * scale, 4);
    expect(model.container.height).toBeCloseTo(180 * scale, 4);
  });

  it("preserves crop identity, resized slots, stable gaps, and row wrapping", () => {
    const firstCrop = { x: 0.25, y: 0.1, width: 0.5, height: 0.75 };
    const source = group("wrapped", {
      width: 260,
      height: 230,
      images: [
        image("first", 170, 100, firstCrop),
        image("second", 120, 80),
        image("third", 90, 70),
      ],
    });
    const context = exportContext(plan(
      [imageGroupBlock("block", source.id)],
      [source],
    ));

    const model = buildPreshotImageGroupPdfRenderModel(
      imageGroupBlock("block", source.id),
      context,
    );

    expect(model.kind).toBe("content");
    if (model.kind !== "content") return;
    expect(model.images.map((entry) => entry.imageId)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(model.images[0].crop).toEqual(firstCrop);
    expect(model.images[1].y).toBeGreaterThan(model.images[0].y);
    expect(model.images[2].x).toBeGreaterThan(model.images[1].x);
    expect(model.images[2].x - (
      model.images[1].x + model.images[1].width
    )).toBeCloseTo(
      PDF_VISUAL_CONTRACT.imageGroup.gap,
      4,
    );
    const groupContext = context.groupsByBlockId.block;
    for (const [index, rendered] of model.images.entries()) {
      const slot = groupContext.slots[index];
      expect(rendered).toMatchObject({
        imageId: slot.imageId,
        crop: slot.crop,
      });
      expect(rendered.x).toBeCloseTo(slot.pdf.x, 4);
      expect(rendered.y).toBeCloseTo(slot.pdf.y, 4);
      expect(rendered.width).toBeCloseTo(slot.pdf.width, 4);
      expect(rendered.height).toBeCloseTo(slot.pdf.height, 4);
      expect(rendered.width / rendered.height).toBeCloseTo(
        slot.logical.width / slot.logical.height,
        5,
      );
    }
  });

  it("uniformly applies only the preflight oversized scale", () => {
    const source = group("oversized", {
      x: 30,
      width: 400,
      height: 2_000,
      frameOffsetY: 12,
      images: [image("tall", 200, 1_900)],
    });
    const context = exportContext(plan(
      [imageGroupBlock("block", source.id)],
      [source],
    ));
    const groupContext = context.groupsByBlockId.block;
    const model = buildPreshotImageGroupPdfRenderModel(
      imageGroupBlock("block", source.id),
      context,
    );

    expect(model.kind).toBe("content");
    if (model.kind !== "content") return;
    const finalScale =
      groupContext.parent.logicalToPdfScale *
      groupContext.pdf.oversizedScale;
    expect(groupContext.pdf.oversizedScale).toBeLessThan(1);
    expect(model.container.x).toBeCloseTo(source.x * finalScale, 4);
    expect(model.flow.topPadding).toBeCloseTo(
      (source.frameOffsetY ?? 0) * finalScale,
      4,
    );
    expect(model.container.y).toBe(0);
    expect(model.flow.height).toBeCloseTo(
      PDF_VISUAL_CONTRACT.page.contentHeight,
      4,
    );
    expect(model.container.height + model.flow.topPadding).toBeCloseTo(
      model.flow.height,
      3,
    );
    expect(model.images[0].x).toBeCloseTo(
      groupContext.slots[0].logical.x * finalScale,
      4,
    );
    expect(model.images[0].height).toBeCloseTo(
      groupContext.slots[0].logical.height * finalScale,
      4,
    );
  });

  it("uses the actual weighted two-thirds column conversion", () => {
    const source = group("column-group", {
      x: 18,
      width: 400,
      height: 180,
    });
    const context = exportContext(plan([{
      id: "columns",
      type: "columnList",
      props: {},
      content: undefined,
      children: [
        {
          id: "wide",
          type: "column",
          props: { width: 2 },
          content: undefined,
          children: [imageGroupBlock("block", source.id)],
        },
        {
          id: "narrow",
          type: "column",
          props: { width: 1 },
          content: undefined,
          children: [{
            id: "copy",
            type: "paragraph",
            props: {},
            content: [],
            children: [],
          }],
        },
      ],
    }], [source]));
    const groupContext = context.groupsByBlockId.block;

    const model = buildPreshotImageGroupPdfRenderModel(
      imageGroupBlock("block", source.id),
      context,
    );

    expect(model.kind).toBe("content");
    if (model.kind !== "content") return;
    expect(groupContext.parent.columnBlockId).toBe("wide");
    expect(model.container.width).toBeCloseTo(
      groupContext.logical.width *
        groupContext.parent.logicalToPdfScale,
      4,
    );
    expect(model.container.width).toBeLessThan(
      PDF_VISUAL_CONTRACT.page.contentWidth,
    );
  });

  it("turns positive root and column offsets into flow padding exactly once", () => {
    const root = group("root", { height: 180, frameOffsetY: 30 });
    const column = group("column", { height: 160, frameOffsetY: 24 });
    const context = exportContext(plan([
      imageGroupBlock("root-block", root.id),
      {
        id: "columns",
        type: "columnList",
        props: {},
        content: undefined,
        children: [
          {
            id: "left",
            type: "column",
            props: { width: 2 },
            content: undefined,
            children: [imageGroupBlock("column-block", column.id)],
          },
          {
            id: "right",
            type: "column",
            props: { width: 1 },
            content: undefined,
            children: [{
              id: "copy",
              type: "paragraph",
              props: {},
              content: [],
              children: [],
            }],
          },
        ],
      },
    ], [root, column]));

    for (const block of [
      imageGroupBlock("root-block", root.id),
      imageGroupBlock("column-block", column.id),
    ]) {
      const model = buildPreshotImageGroupPdfRenderModel(block, context);
      expect(model.kind).toBe("content");
      if (model.kind !== "content") continue;
      expect(model.flow.topPadding).toBeGreaterThan(0);
      expect(model.flow.height).toBeCloseTo(
        model.flow.topPadding + model.container.height,
        4,
      );
      expect(model.container.y).toBe(0);

      const element = createPreshotImageGroupPdfBlockMapping(context)(block);
      expect(isValidElement(element)).toBe(true);
      if (!isValidElement(element)) continue;
      expect(styleOf(element).height).toBeCloseTo(model.flow.height, 4);
      const children = childrenOf(element).filter(isValidElement);
      expect(styleOf(children[0]).height).toBeCloseTo(
        model.flow.topPadding,
        4,
      );
      expect(styleOf(children[1]).top).toBe(0);
    }
  });

  it("keeps zero unchanged and negative offsets positioned without negative flow", () => {
    const zero = group("zero", { height: 180, frameOffsetY: 0 });
    const negative = group("negative", {
      height: 180,
      frameOffsetY: -24,
    });
    const context = exportContext(plan([
      imageGroupBlock("zero-block", zero.id),
      imageGroupBlock("negative-block", negative.id),
    ], [zero, negative]));

    for (const [block, expectedTop] of [
      [imageGroupBlock("zero-block", zero.id), 0],
      [
        imageGroupBlock("negative-block", negative.id),
        -24 * PDF_VISUAL_CONTRACT.editor.rootLogicalToPdfScale,
      ],
    ] as const) {
      const model = buildPreshotImageGroupPdfRenderModel(block, context);
      expect(model.kind).toBe("content");
      if (model.kind !== "content") continue;
      expect(model.flow.topPadding).toBe(0);
      expect(model.flow.height).toBe(model.container.height);
      expect(model.container.y).toBeCloseTo(expectedTop, 4);

      const element = createPreshotImageGroupPdfBlockMapping(context)(block);
      expect(isValidElement(element)).toBe(true);
      if (!isValidElement(element)) continue;
      const children = childrenOf(element).filter(isValidElement);
      expect(children).toHaveLength(1);
      expect(styleOf(children[0]).top).toBeCloseTo(expectedTop, 4);
    }
  });

  it("returns deterministic no-content for an empty group", () => {
    const source = group("empty", { images: [] });
    const context = exportContext(plan(
      [imageGroupBlock("block", source.id)],
      [source],
    ));

    expect(buildPreshotImageGroupPdfRenderModel(
      imageGroupBlock("block", source.id),
      context,
    )).toEqual({
      kind: "empty",
      blockId: "block",
      groupId: "empty",
    });
    expect(createPreshotImageGroupPdfBlockMapping(context)(
      imageGroupBlock("block", source.id),
    )).toBeNull();
  });

  it("rejects missing block context and optimized assets actionably", () => {
    const source = group("group");
    const context = exportContext(plan(
      [imageGroupBlock("block", source.id)],
      [source],
    ));

    expect(() => buildPreshotImageGroupPdfRenderModel(
      imageGroupBlock("missing-block", source.id),
      context,
    )).toThrowError(
      /missing preflight image-group context.*missing-block.*group/i,
    );

    const missingAssetContext = {
      ...context,
      assetsById: {},
    };
    expect(() => buildPreshotImageGroupPdfRenderModel(
      imageGroupBlock("block", source.id),
      missingAssetContext,
    )).toThrowError(PreshotImageGroupPdfRenderError);
    expect(() => buildPreshotImageGroupPdfRenderModel(
      imageGroupBlock("block", source.id),
      missingAssetContext,
    )).toThrowError(/missing optimized asset.*block.*group.*group-image/i);
  });
});

describe("image-group React-PDF mapping", () => {
  it("uses one wrap-false relative container so current-page insufficiency moves the whole group", () => {
    const source = group("group", {
      images: [image("first", 120, 80), image("second", 120, 80)],
    });
    const context = exportContext(plan(
      [imageGroupBlock("block", source.id)],
      [source],
    ));

    const element = createPreshotImageGroupPdfBlockMapping(context)(
      imageGroupBlock("block", source.id),
    );

    expect(isValidElement(element)).toBe(true);
    if (!isValidElement(element)) return;
    expect(element.type).toBe(View);
    expect(element.props).toMatchObject({
      wrap: false,
      style: {
        position: "relative",
      },
    });
    const container = childrenOf(element).filter(isValidElement)[0];
    const frames = childrenOf(container).filter(isValidElement);
    expect(frames).toHaveLength(2);
    for (const frame of frames) {
      expect(frame.type).toBe(View);
      expect(frame.props).toMatchObject({
        style: { position: "absolute" },
      });
      const renderedImage = childrenOf(frame)[0];
      expect(isValidElement(renderedImage)).toBe(true);
      if (!isValidElement(renderedImage)) continue;
      expect(renderedImage.type).toBe(Image);
      expect(renderedImage.props).toMatchObject({
        src: expect.stringMatching(/^data:image\/png;base64,/),
      });
      expect(renderedImage.props).not.toHaveProperty("crop");
    }
  });

  it("gives standalone and column groups the same keep-together structure", () => {
    const root = group("root");
    const column = group("column");
    const context = exportContext(plan([
      imageGroupBlock("root-block", root.id),
      {
        id: "columns",
        type: "columnList",
        props: {},
        content: undefined,
        children: [
          {
            id: "left",
            type: "column",
            props: { width: 2 },
            content: undefined,
            children: [imageGroupBlock("column-block", column.id)],
          },
          {
            id: "right",
            type: "column",
            props: { width: 1 },
            content: undefined,
            children: [{
              id: "copy",
              type: "paragraph",
              props: {},
              content: [],
              children: [],
            }],
          },
        ],
      },
    ], [root, column]));
    const mapping = createPreshotImageGroupPdfBlockMapping(context);

    for (const block of [
      imageGroupBlock("root-block", root.id),
      imageGroupBlock("column-block", column.id),
    ]) {
      const element = mapping(block);
      expect(isValidElement(element)).toBe(true);
      if (isValidElement(element)) {
        expect(element.props).toMatchObject({
          wrap: false,
          style: { position: "relative" },
        });
      }
    }
  });

  it("renders no editor chrome and injects without replacing ordinary mappings", () => {
    const source = group("group");
    const context = exportContext(plan(
      [imageGroupBlock("block", source.id)],
      [source],
    ));
    const paragraph = vi.fn();
    const ordinary = { paragraph };
    const injected = injectPreshotImageGroupPdfBlockMapping(
      ordinary,
      context,
    );
    const element = injected.imageGroup(imageGroupBlock("block", source.id));

    expect(injected).not.toBe(ordinary);
    expect(injected.paragraph).toBe(paragraph);
    expect(elementTypes(element)).toEqual([View, View, View, Image]);
    expect(JSON.stringify(element)).not.toMatch(
      /selection|handle|guide|toolbar|label|placeholder|添加图片|图片组/i,
    );
  });
});
