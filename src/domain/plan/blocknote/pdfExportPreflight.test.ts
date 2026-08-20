import { describe, expect, it } from "vitest";
import type { ProjectPlanV14 } from "../canvas/blockDocument";
import { PDF_VISUAL_CONTRACT } from "./pdfVisualContract";
import {
  PreshotPdfPreflightError,
  buildPreshotPdfLayoutManifest,
} from "./pdfExportPreflight";

function group(
  id: string,
  width = 300,
  height = 160,
  frameOffsetY?: number,
) {
  return {
    id,
    name: id,
    type: "reference" as const,
    x: 0,
    width,
    height,
    frameOffsetY,
    description: "",
    images: [{
      id: `${id}-image`,
      file: `references/${id}.png`,
      aspectRatio: 1,
      sourceWidth: 600,
      sourceHeight: 600,
      frameWidth: 120,
      frameHeight: 120,
      crop: { x: 0, y: 0, width: 1, height: 1 },
    }],
  };
}

function plan(
  blocks: ProjectPlanV14["document"]["blocks"],
  imageGroups: ProjectPlanV14["imageGroups"],
): ProjectPlanV14 {
  return {
    schemaVersion: 14,
    title: "Preflight",
    document: { format: "preshot-blocks", version: 2, blocks },
    imageGroups,
  };
}

describe("buildPreshotPdfLayoutManifest", () => {
  const nativeImage = (
    previewWidth: number | undefined,
    caption = "",
    id = "native-image",
  ) => ({
    id,
    type: "image" as const,
    props: {
      name: "native.png",
      url: "media/native.png",
      caption,
      showPreview: true,
      ...(previewWidth === undefined ? {} : { previewWidth }),
    },
    content: undefined,
    children: [],
  });

  it("lays out a root image group at the root logical and PDF widths", () => {
    const manifest = buildPreshotPdfLayoutManifest({
      plan: plan([{
        id: "group-block",
        type: "imageGroup",
        props: { groupId: "group-1" },
        content: undefined,
        children: [],
      }], [group("group-1")]),
    });

    const context = manifest.groupsByBlockId["group-block"];
    expect(context.parent.logicalWidth).toBe(
      PDF_VISUAL_CONTRACT.editor.contentWidth,
    );
    expect(context.parent.pdfWidth).toBe(
      PDF_VISUAL_CONTRACT.page.contentWidth,
    );
    expect(context.slots).toHaveLength(1);
    expect(context.slots[0].pdf.width).toBeCloseTo(
      context.slots[0].logical.width *
        PDF_VISUAL_CONTRACT.editor.rootLogicalToPdfScale,
      4,
    );
  });

  it("preserves order and computes weighted two-thirds column widths", () => {
    const manifest = buildPreshotPdfLayoutManifest({
      plan: plan([{
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
            children: [{
              id: "copy",
              type: "paragraph",
              props: {},
              content: [],
              children: [],
            }],
          },
          {
            id: "narrow",
            type: "column",
            props: { width: 1 },
            content: undefined,
            children: [{
              id: "group-block",
              type: "imageGroup",
              props: { groupId: "group-1" },
              content: undefined,
              children: [],
            }],
          },
        ],
      }], [group("group-1", 500)]),
    });

    expect(manifest.blocks.map((block) => block.blockId)).toEqual([
      "columns",
      "wide",
      "copy",
      "narrow",
      "group-block",
    ]);
    const columns = manifest.columnLists[0];
    const usableLogical = columns.logicalWidth - columns.logicalGap;
    expect(columns.columns[0].logicalWidth).toBeCloseTo(
      usableLogical * 2 / 3,
      4,
    );
    expect(columns.columns[1].logicalWidth).toBeCloseTo(
      usableLogical / 3,
      4,
    );
    expect(manifest.groupsByGroupId["group-1"].parent.columnBlockId).toBe(
      "narrow",
    );
    expect(manifest.groupsByGroupId["group-1"].logical.width).toBe(
      columns.columns[1].logicalWidth,
    );
  });

  it("does not scale a group at the usable-page limit", () => {
    const frameHeight =
      PDF_VISUAL_CONTRACT.page.contentHeight /
        PDF_VISUAL_CONTRACT.editor.rootLogicalToPdfScale -
      18;
    const nearLimit = group("group-1", 300, frameHeight + 18);
    nearLimit.images[0].frameHeight = frameHeight;
    nearLimit.images[0].frameWidth = 100;

    const manifest = buildPreshotPdfLayoutManifest({
      plan: plan([{
        id: "group-block",
        type: "imageGroup",
        props: { groupId: "group-1" },
        content: undefined,
        children: [],
      }], [nearLimit]),
    });

    expect(
      manifest.groups[0].keepTogether.oversizedPageScale,
    ).toBe(1);
    expect(manifest.groups[0].pdf.unscaledHeight).toBeLessThanOrEqual(
      PDF_VISUAL_CONTRACT.page.contentHeight,
    );
  });

  it("uniformly scales only a group taller than the usable page", () => {
    const oversized = group("group-1", 300, 2_000);
    oversized.images[0].frameHeight = 2_000;
    oversized.images[0].frameWidth = 100;

    const manifest = buildPreshotPdfLayoutManifest({
      plan: plan([{
        id: "group-block",
        type: "imageGroup",
        props: { groupId: "group-1" },
        content: undefined,
        children: [],
      }], [oversized]),
    });
    const context = manifest.groups[0];

    expect(context.keepTogether.oversizedPageScale).toBeLessThan(1);
    expect(context.pdf.exportOnlyGroupPhysicalScale).toBe(
      context.keepTogether.oversizedPageScale,
    );
    expect(context.logical.layoutScale).toBe(1);
    expect(context.slots[0].logical).toMatchObject({
      width: 100,
      height: 2_000,
    });
    expect(context.pdf.displayedHeight).toBeCloseTo(
      PDF_VISUAL_CONTRACT.page.contentHeight,
      4,
    );
    expect(context.slots[0].pdf.width / context.slots[0].pdf.height).toBeCloseTo(
      context.slots[0].logical.width / context.slots[0].logical.height,
      5,
    );
  });

  it("keeps a narrow-column image authoritative and scales only the whole export group", () => {
    const source = group("group-1", 1_000, 240);
    source.images[0].frameWidth = 480;
    source.images[0].frameHeight = 240;
    const manifest = buildPreshotPdfLayoutManifest({
      plan: plan([{
        id: "columns",
        type: "columnList",
        props: {},
        content: undefined,
        children: [
          {
            id: "narrow",
            type: "column",
            props: { width: 1 },
            content: undefined,
            children: [{
              id: "group-block",
              type: "imageGroup",
              props: { groupId: "group-1" },
              content: undefined,
              children: [],
            }],
          },
          {
            id: "wide",
            type: "column",
            props: { width: 2 },
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
      }], [source]),
    });
    const context = manifest.groupsByBlockId["group-block"];

    expect(context.logical.layoutScale).toBe(1);
    expect(context.slots[0].logical.width).toBe(480);
    expect(context.slots[0].logical.height).toBe(240);
    expect(context.pdf.exportOnlyGroupPhysicalScale).toBeLessThan(1);
    expect(context.slots[0].pdf.width / context.slots[0].pdf.height)
      .toBeCloseTo(2, 5);
    expect(context.pdf.x + context.pdf.width).toBeLessThanOrEqual(
      context.parent.pdfWidth,
    );
  });

  it("includes positive root offsets in flow height and oversized scaling", () => {
    const offset = 120;
    const oversized = group("group-1", 300, 1_400, offset);
    oversized.images[0].frameHeight = 1_300;
    oversized.images[0].frameWidth = 100;

    const manifest = buildPreshotPdfLayoutManifest({
      plan: plan([{
        id: "group-block",
        type: "imageGroup",
        props: { groupId: "group-1" },
        content: undefined,
        children: [],
      }], [oversized]),
    });
    const context = manifest.groups[0];

    expect(context.logical.flowTopPadding).toBe(offset);
    expect(context.logical.flowHeight).toBe(oversized.height + offset);
    expect(context.keepTogether.oversizedPageScale).toBeLessThan(1);
    expect(context.pdf.flowHeight).toBeCloseTo(
      PDF_VISUAL_CONTRACT.page.contentHeight,
      4,
    );
    expect(context.pdf.displayedHeight / context.pdf.unscaledHeight).toBeCloseTo(
      context.pdf.flowTopPadding /
        (offset * context.parent.logicalToPdfScale),
      5,
    );
  });

  it("uses the column conversion for positive flow padding", () => {
    const source = group("group-1", 400, 180, 36);
    const manifest = buildPreshotPdfLayoutManifest({
      plan: plan([{
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
            children: [{
              id: "group-block",
              type: "imageGroup",
              props: { groupId: "group-1" },
              content: undefined,
              children: [],
            }],
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
      }], [source]),
    });
    const context = manifest.groupsByBlockId["group-block"];

    expect(context.parent.columnBlockId).toBe("wide");
    expect(context.pdf.flowTopPadding).toBeCloseTo(
      36 * context.parent.logicalToPdfScale,
      4,
    );
    expect(context.pdf.flowHeight).toBeCloseTo(
      (source.height + 36) * context.parent.logicalToPdfScale,
      4,
    );
  });

  it("keeps zero and negative offsets from adding flow height", () => {
    const zero = group("zero", 300, 180, 0);
    const negative = group("negative", 300, 180, -24);
    const manifest = buildPreshotPdfLayoutManifest({
      plan: plan([
        {
          id: "zero-block",
          type: "imageGroup",
          props: { groupId: "zero" },
          content: undefined,
          children: [],
        },
        {
          id: "negative-block",
          type: "imageGroup",
          props: { groupId: "negative" },
          content: undefined,
          children: [],
        },
      ], [zero, negative]),
    });
    const zeroContext = manifest.groupsByBlockId["zero-block"];
    const negativeContext = manifest.groupsByBlockId["negative-block"];

    expect(zeroContext.logical.flowTopPadding).toBe(0);
    expect(zeroContext.logical.flowHeight).toBe(zero.height);
    expect(zeroContext.pdf.flowHeight).toBe(zeroContext.pdf.displayedHeight);
    expect(negativeContext.logical.flowTopPadding).toBe(0);
    expect(negativeContext.logical.flowHeight).toBe(negative.height);
    expect(negativeContext.pdf.flowHeight).toBe(
      negativeContext.pdf.displayedHeight,
    );
    expect(negativeContext.pdf.offsetY).toBeLessThan(0);
  });

  it("preserves empty-group flow without creating assets", () => {
    const empty = { ...group("group-1"), images: [] };
    const manifest = buildPreshotPdfLayoutManifest({
      plan: plan([{
        id: "group-block",
        type: "imageGroup",
        props: { groupId: "group-1" },
        content: undefined,
        children: [],
      }], [empty]),
    });

    expect(manifest.groups[0]).toMatchObject({
      blockId: "group-block",
      empty: true,
      render: false,
      slots: [],
    });
    expect(manifest.assetRequests).toEqual([]);
    expect(manifest.warnings[0].code).toBe("EMPTY_IMAGE_GROUP_SKIPPED");
  });

  it("rejects an invalid marker with block/group context", () => {
    expect(() => buildPreshotPdfLayoutManifest({
      plan: plan([{
        id: "group-block",
        type: "imageGroup",
        props: { groupId: "missing" },
        content: undefined,
        children: [],
      }], []),
    })).toThrowError(PreshotPdfPreflightError);

    try {
      buildPreshotPdfLayoutManifest({
        plan: plan([{
          id: "group-block",
          type: "imageGroup",
          props: { groupId: "missing" },
          content: undefined,
          children: [],
        }], []),
      });
    } catch (error) {
      const preflight = error as PreshotPdfPreflightError;
      expect(preflight.fatalErrors[0].code).toBe(
        "INVALID_IMAGE_GROUP_MARKER",
      );
      expect(preflight.message).toContain("missing");
    }
  });

  it("rejects duplicate image-group markers deterministically", () => {
    const marker = (id: string) => ({
      id,
      type: "imageGroup" as const,
      props: { groupId: "group-1" },
      content: undefined,
      children: [],
    });

    expect(() => buildPreshotPdfLayoutManifest({
      plan: plan(
        [marker("first"), marker("second")],
        [group("group-1")],
      ),
    })).toThrowError(/references image group "group-1" 2 times/);
  });

  it("rejects invalid non-empty image metadata with full context", () => {
    expect.assertions(2);
    const invalid = group("group-1");
    invalid.images[0].frameWidth = 0;

    try {
      buildPreshotPdfLayoutManifest({
        plan: plan([{
          id: "group-block",
          type: "imageGroup",
          props: { groupId: "group-1" },
          content: undefined,
          children: [],
        }], [invalid]),
      });
    } catch (error) {
      const preflight = error as PreshotPdfPreflightError;
      expect(preflight.fatalErrors[0]).toMatchObject({
        code: "INVALID_IMAGE_METADATA",
        blockId: "group-block",
        groupId: "group-1",
        imageId: "group-1-image",
      });
      expect(preflight.message).toContain("image frame width");
    }
  });

  it("uniformly fits a 100x1000 native image within the usable page", () => {
    const manifest = buildPreshotPdfLayoutManifest({
      plan: plan([nativeImage(200)], []),
      nativeImageDimensions: {
        "native-image": { width: 100, height: 1_000 },
      },
    });
    const image = manifest.nativeImagesByBlockId["native-image"];

    expect(image.pdfHeight).toBeCloseTo(
      PDF_VISUAL_CONTRACT.page.contentHeight -
        PDF_VISUAL_CONTRACT.spacing.nativeImage.after,
      4,
    );
    expect(image.pdfWidth / image.pdfHeight).toBeCloseTo(0.1, 5);
    expect(image.blockHeight).toBeLessThanOrEqual(
      PDF_VISUAL_CONTRACT.page.contentHeight,
    );
  });

  it("reserves caption and block spacing when fitting a tall native image", () => {
    const manifest = buildPreshotPdfLayoutManifest({
      plan: plan([nativeImage(200, "竖幅参考")], []),
      nativeImageDimensions: {
        "native-image": { width: 100, height: 1_000 },
      },
    });
    const image = manifest.nativeImagesByBlockId["native-image"];
    const expectedCaptionHeight =
      PDF_VISUAL_CONTRACT.spacing.nativeImage.captionGap +
      PDF_VISUAL_CONTRACT.typography.body.lineHeight * 0.85;

    expect(image.captionHeight).toBeCloseTo(expectedCaptionHeight, 4);
    expect(image.pdfHeight + image.captionHeight + image.blockSpacing)
      .toBeCloseTo(PDF_VISUAL_CONTRACT.page.contentHeight, 4);
    expect(image.pdfWidth / image.pdfHeight).toBeCloseTo(0.1, 5);
  });

  it("leaves a normal landscape native image unchanged", () => {
    const manifest = buildPreshotPdfLayoutManifest({
      plan: plan([nativeImage(400)], []),
      nativeImageDimensions: {
        "native-image": { width: 1_000, height: 500 },
      },
    });
    const image = manifest.nativeImagesByBlockId["native-image"];

    expect(image.logicalWidth).toBe(400);
    expect(image.logicalHeight).toBe(200);
    expect(image.pdfWidth).toBeCloseTo(
      400 * PDF_VISUAL_CONTRACT.editor.rootLogicalToPdfScale,
      4,
    );
    expect(image.pdfHeight).toBeCloseTo(
      200 * PDF_VISUAL_CONTRACT.editor.rootLogicalToPdfScale,
      4,
    );
  });

  it("uses intrinsic fallback width and respects a column parent width", () => {
    const manifest = buildPreshotPdfLayoutManifest({
      plan: plan([{
        id: "columns",
        type: "columnList",
        props: {},
        content: undefined,
        children: [
          {
            id: "image-column",
            type: "column",
            props: { width: 1 },
            content: undefined,
            children: [nativeImage(undefined)],
          },
          {
            id: "copy-column",
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
      }], []),
      nativeImageDimensions: {
        "native-image": { width: 2_000, height: 1_000 },
      },
    });
    const image = manifest.nativeImagesByBlockId["native-image"];
    const column = manifest.columnLists[0].columns[0];

    expect(image.logicalWidth).toBe(column.logicalWidth);
    expect(image.pdfWidth).toBe(column.pdfWidth);
    expect(image.pdfHeight).toBeCloseTo(column.pdfWidth / 2, 4);
  });

  it("fits a wrapped caption using the final column image width", () => {
    const caption = "column caption ".repeat(24).trim();
    const manifest = buildPreshotPdfLayoutManifest({
      plan: plan([{
        id: "columns",
        type: "columnList",
        props: {},
        content: undefined,
        children: [
          {
            id: "image-column",
            type: "column",
            props: { width: 1 },
            content: undefined,
            children: [nativeImage(300, caption)],
          },
          {
            id: "copy-column",
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
      }], []),
      nativeImageDimensions: {
        "native-image": { width: 100, height: 1_000 },
      },
      measureCaptionText: (value, fontSize) =>
        Array.from(value).length * fontSize * 0.5,
    });
    const image = manifest.nativeImagesByBlockId["native-image"];
    const column = manifest.columnLists[0].columns[0];

    expect(image.captionLines.length).toBeGreaterThan(1);
    expect(image.pdfWidth).toBeLessThanOrEqual(column.pdfWidth);
    expect(image.blockWidth).toBe(column.pdfWidth);
    expect(image.captionWidth).toBe(column.pdfWidth);
    expect(image.captionWidth).toBeGreaterThan(image.pdfWidth);
    expect(image.pdfWidth / image.pdfHeight).toBeCloseTo(0.1, 5);
    expect(image.blockHeight).toBeLessThanOrEqual(
      PDF_VISUAL_CONTRACT.page.contentHeight,
    );
  });

  it("fits a true 100x1000 image with a long CJK caption", () => {
    const caption = "这是用于验证超高图片导出时宽标题排版不会随图片缩窄的中文说明文字。".repeat(8);
    const manifest = buildPreshotPdfLayoutManifest({
      plan: plan([nativeImage(400, caption)], []),
      nativeImageDimensions: {
        "native-image": { width: 100, height: 1_000 },
      },
      measureCaptionText: (value, fontSize) =>
        Array.from(value).length * fontSize,
    });
    const image = manifest.nativeImagesByBlockId["native-image"];

    expect(image.captionLines.length).toBeGreaterThan(1);
    expect(image.captionWidth).toBe(
      PDF_VISUAL_CONTRACT.page.contentWidth,
    );
    expect(image.captionWidth).toBeGreaterThan(image.pdfWidth);
    expect(image.pdfWidth / image.pdfHeight).toBeCloseTo(0.1, 5);
    expect(image.blockHeight).toBeLessThanOrEqual(
      PDF_VISUAL_CONTRACT.page.contentHeight,
    );
  });

  it.each([
    { width: 0, height: 100 },
    { width: 100, height: 0 },
    { width: Number.NaN, height: 100 },
    { width: 100, height: Number.POSITIVE_INFINITY },
  ])("rejects invalid native dimensions %#", (dimensions) => {
    expect(() => buildPreshotPdfLayoutManifest({
      plan: plan([nativeImage(undefined)], []),
      nativeImageDimensions: { "native-image": dimensions },
    })).toThrowError(/could not determine native image dimensions/);
  });
});
