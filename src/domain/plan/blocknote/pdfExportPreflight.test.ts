import { describe, expect, it } from "vitest";
import type { ProjectPlanV14 } from "../canvas/blockDocument";
import type { ReferenceImage } from "../canvas/models";
import { PDF_VISUAL_CONTRACT } from "./pdfVisualContract";
import {
  acceptsPdfImageGroupEmergencyRowScale,
  PDF_IMAGE_GROUP_MIN_EMERGENCY_ROW_SCALE,
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

function rowGroup(
  id: string,
  rowHeights: readonly number[],
  frameOffsetY = 0,
) {
  const width = 1_008;
  const height =
    18 +
    rowHeights.reduce((total, rowHeight) => total + rowHeight, 0) +
    Math.max(0, rowHeights.length - 1) * 7;
  return {
    id,
    name: id,
    type: "reference" as const,
    x: 0,
    width,
    height,
    frameOffsetY,
    description: "",
    images: rowHeights.map((rowHeight, index) => ({
      id: `${id}-row-${index + 1}`,
      file: `references/${id}-${index + 1}.png`,
      aspectRatio: 900 / rowHeight,
      sourceWidth: 1_800,
      sourceHeight: Math.max(1, rowHeight * 2),
      frameWidth: 900,
      frameHeight: rowHeight,
      crop: index === 0
        ? { x: 0.2, y: 0.1, width: 0.6, height: 0.8 }
        : { x: 0, y: 0, width: 1, height: 1 },
    })),
  };
}

function emergencyRowGroup(id: string, requiredScale: number) {
  const pdfScale = PDF_VISUAL_CONTRACT.editor.rootLogicalToPdfScale;
  const availableRowHeight =
    PDF_VISUAL_CONTRACT.page.contentHeight -
    PDF_VISUAL_CONTRACT.imageGroup.inset * 2 -
    0.1;
  const pdfRowHeight = Number(
    (availableRowHeight / requiredScale).toFixed(4),
  );
  return rowGroup(id, [pdfRowHeight / pdfScale]);
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

  it("uses the full source crop only for explicit stretch mode", () => {
    const cover = group("cover");
    cover.images[0].crop = {
      x: 0.2,
      y: 0.1,
      width: 0.6,
      height: 0.8,
    };
    const stretch = group("stretch");
    stretch.images[0].crop = {
      x: 0.2,
      y: 0.1,
      width: 0.6,
      height: 0.8,
    };
    (stretch.images[0] as ReferenceImage).fitMode = "stretch";
    const manifest = buildPreshotPdfLayoutManifest({
      plan: plan([
        {
          id: "cover-block",
          type: "imageGroup",
          props: { groupId: "cover" },
          content: undefined,
          children: [],
        },
        {
          id: "stretch-block",
          type: "imageGroup",
          props: { groupId: "stretch" },
          content: undefined,
          children: [],
        },
      ], [cover, stretch]),
    });

    expect(manifest.groupsByBlockId["cover-block"].slots[0].crop).toEqual(
      cover.images[0].crop,
    );
    expect(manifest.groupsByBlockId["stretch-block"].slots[0].crop).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
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

    expect(manifest.groups[0].pdf.horizontalFitScale).toBe(1);
    expect(manifest.groups[0].pagination.mode).toBe("keep-together");
    expect(manifest.groups[0].pdf.unscaledHeight).toBeLessThanOrEqual(
      PDF_VISUAL_CONTRACT.page.contentHeight,
    );
  });

  it("partitions a two-page group at authoritative image-row boundaries", () => {
    const oversized = rowGroup("group-1", [600, 600, 600]);
    oversized.images = oversized.images.flatMap((image, rowIndex) => [
      {
        ...image,
        id: `group-1-row-${rowIndex + 1}-left`,
        frameWidth: 400,
        aspectRatio: 2 / 3,
      },
      {
        ...image,
        id: `group-1-row-${rowIndex + 1}-right`,
        file: `references/group-1-${rowIndex + 1}-right.png`,
        frameWidth: 400,
        aspectRatio: 2 / 3,
        crop: { x: 0, y: 0, width: 1, height: 1 },
      },
    ]);

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

    expect(context.pagination.mode).toBe("row-fragments");
    expect(context.logical.layoutScale).toBe(1);
    expect(context.pagination.rows.map((row) => row.imageIds)).toEqual([
      ["group-1-row-1-left", "group-1-row-1-right"],
      ["group-1-row-2-left", "group-1-row-2-right"],
      ["group-1-row-3-left", "group-1-row-3-right"],
    ]);
    expect(context.pagination.fragments.map((fragment) =>
      fragment.imageIds
    )).toEqual([
      [
        "group-1-row-1-left",
        "group-1-row-1-right",
        "group-1-row-2-left",
        "group-1-row-2-right",
      ],
      ["group-1-row-3-left", "group-1-row-3-right"],
    ]);
    expect(context.pagination.fragments.every((fragment) =>
      fragment.flowHeight <= PDF_VISUAL_CONTRACT.page.contentHeight
    )).toBe(true);
    expect(context.pagination.fragments.flatMap((fragment) =>
      fragment.imageIds
    )).toEqual(oversized.images.map((image) => image.id));
    const firstRowSlots = context.slots.filter((slot) => slot.rowIndex === 0);
    expect(firstRowSlots[1].pdf.x - (
      firstRowSlots[0].pdf.x + firstRowSlots[0].pdf.width
    )).toBeCloseTo(context.pdf.gap, 4);
    expect(context.slots.map((slot) => slot.pdf.height)).toEqual(
      oversized.images.map((image) =>
        expect.closeTo(
          image.frameHeight * context.parent.logicalToPdfScale,
          4,
        )
      ),
    );
  });

  it("packs a three-page group without row duplication or trailing fragments", () => {
    const oversized = rowGroup("group-1", [600, 600, 600, 600, 600]);
    const manifest = buildPreshotPdfLayoutManifest({
      plan: plan([{
        id: "group-block",
        type: "imageGroup",
        props: { groupId: "group-1" },
        content: undefined,
        children: [],
      }], [oversized]),
    });
    const pagination = manifest.groups[0].pagination;

    expect(pagination.mode).toBe("row-fragments");
    expect(pagination.fragments.map((fragment) => fragment.rowIndexes)).toEqual(
      [[0, 1], [2, 3], [4]],
    );
    expect(pagination.fragments.flatMap((fragment) =>
      fragment.imageIds
    )).toEqual(oversized.images.map((image) => image.id));
    expect(pagination.fragments.at(-1)?.imageIds).toEqual([
      "group-1-row-5",
    ]);
  });

  it("partitions authoritative rows inside a weighted two-thirds column", () => {
    const source = rowGroup("group-1", [600, 600, 600]);
    source.images = source.images.map((image) => ({
      ...image,
      frameWidth: 600,
      aspectRatio: 1,
    }));
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
    expect(context.keepTogether.scope).toBe("column-row");
    expect(context.pagination.mode).toBe("row-fragments");
    expect(context.pagination.fragments.map((fragment) =>
      fragment.rowIndexes
    )).toEqual([[0, 1], [2]]);
    expect(context.slots.every((slot) =>
      slot.pdf.x + slot.pdf.width <= context.parent.pdfWidth + 0.01
    )).toBe(true);
  });

  it("keeps a narrow-column image authoritative and uses width-only fitting", () => {
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
    expect(context.pdf.horizontalFitScale).toBeLessThan(1);
    expect(context.pagination.mode).toBe("keep-together");
    expect(context.slots[0].pdf.width / context.slots[0].pdf.height)
      .toBeCloseTo(2, 5);
    expect(context.pdf.x + context.pdf.width).toBeLessThanOrEqual(
      context.parent.pdfWidth,
    );
  });

  it("keeps positive root offset as first-fragment padding only", () => {
    const offset = 250;
    const oversized = rowGroup("group-1", [600, 600, 600], offset);

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
    expect(context.pagination.mode).toBe("row-fragments");
    expect(context.pagination.fragments[0].flowTopPadding).toBeCloseTo(
      offset * context.parent.logicalToPdfScale,
      4,
    );
    expect(context.pagination.fragments.slice(1).map((fragment) =>
      fragment.flowTopPadding
    )).toEqual([0]);
    expect(context.pagination.fragments.map((fragment) =>
      fragment.rowIndexes
    )).toEqual([[0], [1, 2]]);
  });

  it("uses a scale-only tolerance for the emergency row minimum", () => {
    expect(acceptsPdfImageGroupEmergencyRowScale(0.25)).toBe(true);
    expect(acceptsPdfImageGroupEmergencyRowScale(0.7 - 0.45)).toBe(true);
    expect(acceptsPdfImageGroupEmergencyRowScale(0.250001)).toBe(true);
    expect(acceptsPdfImageGroupEmergencyRowScale(0.249999)).toBe(false);
    expect(acceptsPdfImageGroupEmergencyRowScale(0.24475)).toBe(false);
    expect(acceptsPdfImageGroupEmergencyRowScale(0.24)).toBe(false);
  });

  it.each([
    { label: "exactly at", requiredScale: 0.25 },
    { label: "just above", requiredScale: 0.250001 },
  ])("accepts an emergency row $label the 0.25 minimum", ({
    requiredScale,
  }) => {
    const source = emergencyRowGroup("boundary", requiredScale);
    const manifest = buildPreshotPdfLayoutManifest({
      plan: plan([{
        id: "boundary-block",
        type: "imageGroup",
        props: { groupId: source.id },
        content: undefined,
        children: [],
      }], [source]),
    });

    expect(manifest.groups[0].pagination.mode).toBe("row-fragments");
    expect(manifest.groups[0].pagination.rows[0].emergencyScale)
      .toBeCloseTo(requiredScale, 7);
    expect(manifest.groups[0].pagination.rows[0].emergencyScale)
      .toBeGreaterThanOrEqual(PDF_IMAGE_GROUP_MIN_EMERGENCY_ROW_SCALE);
  });

  it.each([0.249999, 0.24475, 0.24])(
    "rejects a required emergency row scale of %s with typed context",
    (requiredScale) => {
      const source = emergencyRowGroup("below-floor", requiredScale);

      try {
        buildPreshotPdfLayoutManifest({
          plan: plan([{
            id: "below-floor-block",
            type: "imageGroup",
            props: { groupId: source.id },
            content: undefined,
            children: [],
          }], [source]),
        });
        expect.fail("Expected emergency row scale rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(PreshotPdfPreflightError);
        const issue = (error as PreshotPdfPreflightError).fatalErrors[0];
        expect(issue).toMatchObject({
          code: "IMAGE_GROUP_ROW_SCALE_BELOW_MINIMUM",
          blockId: "below-floor-block",
          groupId: "below-floor",
          rowIndex: 0,
          minimumScale: 0.25,
        });
        expect(issue.requiredScale).toBeCloseTo(requiredScale, 7);
        expect(issue.message).toMatch(
          /row 1.*below the minimum emergency scale 0\.25/i,
        );
      }
    },
  );

  it("scales only one overheight row", () => {
    const emergency = rowGroup("group-1", [1_800, 500]);
    const manifest = buildPreshotPdfLayoutManifest({
      plan: plan([{
        id: "group-block",
        type: "imageGroup",
        props: { groupId: "group-1" },
        content: undefined,
        children: [],
      }], [emergency]),
    });
    const context = manifest.groups[0];

    expect(context.pagination.mode).toBe("row-fragments");
    expect(context.pagination.rows[0].emergencyScale).toBeLessThan(1);
    expect(context.pagination.rows[0].emergencyScale).toBeGreaterThanOrEqual(
      context.pagination.minimumEmergencyRowScale,
    );
    expect(context.pagination.rows[1].emergencyScale).toBe(1);
    expect(context.pagination.fragments.map((fragment) =>
      fragment.rowIndexes
    )).toEqual([[0], [1]]);
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
