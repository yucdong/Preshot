import { createHash } from "node:crypto";
import { deflateSync, inflateRawSync } from "node:zlib";
import { Document, Packer, type Paragraph } from "docx";
import { describe, expect, it, vi } from "vitest";
import {
  buildPreshotPdfLayoutManifest,
  type PreshotPdfExportContext,
} from "../../domain/plan/blocknote/pdfExportPreflight";
import { PDF_VISUAL_CONTRACT } from "../../domain/plan/blocknote/pdfVisualContract";
import type { ProjectPlanV14 } from "../../domain/plan/canvas/blockDocument";
import {
  DOCUMENT_IMAGE_GROUP_INSET,
  layoutDocumentImageGroupForWidth,
} from "../../domain/plan/canvas/documentImageGroupLayout";
import { buildPreshotImageGroupPdfRenderModel } from "../pdf/imageGroupPdfRenderModel";
import {
  buildPreshotDocxImageGroupCompositeRequest,
  calculateDocxImageGroupRasterPlan,
  createPreshotImageGroupDocxBlockMapping,
  DOCX_IMAGE_GROUP_MAX_AXIS_PIXELS,
  DOCX_IMAGE_GROUP_MAX_PIXELS,
  DOCX_IMAGE_GROUP_PAGE_EPSILON_POINTS,
  DOCX_IMAGE_GROUP_PAGE_SAFETY_POINTS,
  injectPreshotImageGroupDocxBlockMapping,
  pointsToDocxLayoutPixels,
  pointsToTwips,
  PreshotImageGroupDocxRenderError,
  type PreshotDocxImageGroupCompositeRequest,
} from "./imageGroupDocxMapping";
import type { PreshotImageGroupDocxMapping } from "./preshotDocxMappings";

function image(
  id: string,
  frameWidth: number,
  frameHeight: number,
  crop = { x: 0, y: 0, width: 1, height: 1 },
  offset: { x?: number; y?: number } = {},
) {
  return {
    id,
    file: `references/${id}.png`,
    aspectRatio: frameWidth / frameHeight,
    sourceWidth: 1_600,
    sourceHeight: 1_200,
    frameWidth,
    frameHeight,
    frameOffsetX: offset.x,
    frameOffsetY: offset.y,
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
    name: `Accessible ${id}`,
    type: "reference" as const,
    x: options.x ?? 0,
    width: options.width ?? 300,
    height: options.height ?? 180,
    frameOffsetY: options.frameOffsetY,
    description: `Composite description for ${id}`,
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

function paragraphBlock(id: string) {
  return {
    id,
    type: "paragraph" as const,
    props: {},
    content: [],
    children: [],
  };
}

function plan(
  blocks: ProjectPlanV14["document"]["blocks"],
  imageGroups: ProjectPlanV14["imageGroups"],
): ProjectPlanV14 {
  return {
    schemaVersion: 14,
    title: "DOCX composite",
    document: { format: "preshot-blocks", version: 2, blocks },
    imageGroups,
  };
}

function exportContext(value: ProjectPlanV14): PreshotPdfExportContext {
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

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function deterministicCompositePng(
  request: PreshotDocxImageGroupCompositeRequest,
): Uint8Array {
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({
      display: request.display,
      surface: request.surface,
      images: request.images.map((entry) => ({
        imageId: entry.imageId,
        crop: entry.crop,
        x: entry.xPoints,
        y: entry.yPoints,
        width: entry.widthPoints,
        height: entry.heightPoints,
      })),
    }))
    .digest();
  const width = 2;
  const height = 2;
  const rows = Buffer.from([
    0, fingerprint[0], fingerprint[1], fingerprint[2], 255,
    fingerprint[3], fingerprint[4], fingerprint[5], 255,
    0, fingerprint[6], fingerprint[7], fingerprint[8], 255,
    fingerprint[9], fingerprint[10], fingerprint[11], 255,
  ]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = deflateSync(rows, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

const PACKABLE_PNG = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0,
  0, 0, 13, 73, 68, 65, 84, 8, 215, 99, 248, 207, 192, 240, 31, 0,
  5, 0, 1, 255, 137, 153, 61, 29, 0, 0, 0, 0, 73, 69, 78, 68,
  174, 66, 96, 130,
]);

function unzip(buffer: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("ZIP end record is missing");
  const entries = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let index = 0; index < entries; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("ZIP central directory is malformed");
    }
    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(
      offset + 46,
      offset + 46 + nameLength,
    ).toString("utf8");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start =
      localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(start, start + compressedSize);
    files.set(
      name,
      compression === 0
        ? Buffer.from(compressed)
        : inflateRawSync(compressed),
    );
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

async function paragraphXml(paragraph: Paragraph): Promise<{
  xml: string;
  media: string[];
}> {
  const packed = await Packer.toBuffer(new Document({
    sections: [{ children: [paragraph] }],
  }));
  const files = unzip(packed);
  return {
    xml: files.get("word/document.xml")?.toString("utf8") ?? "",
    media: [...files.keys()].filter((name) =>
      name.startsWith("word/media/") && !name.endsWith("/"),
    ),
  };
}

describe("DOCX image-group composite request", () => {
  it.each([
    { label: "root", weights: [] as number[], expectedRows: 1 },
    { label: "two-column", weights: [1, 1], expectedRows: 3 },
    { label: "three-column", weights: [1, 1, 1], expectedRows: 3 },
  ])(
    "keeps editor, PDF, and DOCX manifests in parity for $label 240-height frames",
    ({ weights, expectedRows }) => {
      const source = group("parity", {
        width: 1_008,
        height: 240,
        images: [
          image("first", 320, 240),
          image("second", 320, 240),
          image("third", 320, 240),
        ],
      });
      const block = imageGroupBlock("block", source.id);
      const blocks = weights.length === 0
        ? [block]
        : [{
            id: "columns",
            type: "columnList" as const,
            props: {},
            content: undefined,
            children: weights.map((weight, index) => ({
              id: `column-${index}`,
              type: "column" as const,
              props: { width: weight },
              content: undefined,
              children: index === 0
                ? [block]
                : [paragraphBlock(`copy-${index}`)],
            })),
          }];
      const context = exportContext(plan(blocks, [source]));
      const groupContext = context.groupsByBlockId.block;
      const editorLayout = layoutDocumentImageGroupForWidth(
        source.images,
        groupContext.logical.width,
      );
      const pdfModel = buildPreshotImageGroupPdfRenderModel(block, context);
      const docxRequest = buildPreshotDocxImageGroupCompositeRequest(
        block,
        context,
      )!;
      const rowCount = (ys: readonly number[]) =>
        new Set(ys.map((value) => value.toFixed(4))).size;

      expect(groupContext.logical.layoutScale).toBe(1);
      expect(rowCount(editorLayout.slots.map((slot) => slot.y)))
        .toBe(expectedRows);
      expect(rowCount(groupContext.slots.map((slot) => slot.logical.y)))
        .toBe(expectedRows);
      expect(pdfModel.kind).toBe("content");
      if (pdfModel.kind !== "content") return;
      expect(rowCount(pdfModel.images.map((entry) => entry.y)))
        .toBe(expectedRows);
      expect(rowCount(docxRequest.images.map((entry) =>
        entry.yPoints - docxRequest.surface.yPoints
      ))).toBe(expectedRows);

      editorLayout.slots.forEach((editorSlot, index) => {
        const manifestSlot = groupContext.slots[index];
        const pdfSlot = pdfModel.images[index];
        const docxSlot = docxRequest.images[index];
        expect(manifestSlot.logical).toMatchObject({
          x: DOCUMENT_IMAGE_GROUP_INSET + editorSlot.x,
          y: DOCUMENT_IMAGE_GROUP_INSET + editorSlot.y,
          width: editorSlot.width,
          height: editorSlot.height,
        });
        expect(pdfSlot).toMatchObject({
          imageId: editorSlot.id,
          width: manifestSlot.pdf.width,
          height: manifestSlot.pdf.height,
        });
        expect(docxSlot).toMatchObject({
          imageId: editorSlot.id,
          widthPoints: manifestSlot.pdf.width,
          heightPoints: manifestSlot.pdf.height,
        });
      });

      if (weights.length === 3) {
        expect(groupContext.slots[0].logical.width).toBe(320);
        expect(groupContext.docx.exportOnlyGroupPhysicalScale).toBeLessThan(1);
      }
    },
  );

  it("preserves order, crops, wrapping, offsets, dimensions, gaps, and visual surfaces", () => {
    const firstCrop = { x: 0.2, y: 0.1, width: 0.5, height: 0.7 };
    const source = group("wrapped", {
      x: 24,
      width: 260,
      height: 240,
      frameOffsetY: 15,
      images: [
        image("first", 170, 100, firstCrop, { x: -12, y: 8 }),
        image("second", 120, 80),
        image("third", 90, 70),
      ],
    });
    const context = exportContext(plan(
      [imageGroupBlock("block", source.id)],
      [source],
    ));

    const request = buildPreshotDocxImageGroupCompositeRequest(
      imageGroupBlock("block", source.id),
      context,
    );

    expect(request).not.toBeNull();
    if (!request) return;
    expect(request.images.map((entry) => entry.imageId)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(request.images[0].crop).toEqual(firstCrop);
    expect(request.images[1].yPoints).toBeGreaterThan(
      request.images[0].yPoints,
    );
    expect(request.images[2].xPoints).toBeGreaterThan(
      request.images[1].xPoints,
    );
    expect(request.display.indentPoints).toBeCloseTo(
      context.groupsByBlockId.block.pdf.x,
      4,
    );
    expect(request.surface).toMatchObject({
      yPoints: context.groupsByBlockId.block.pdf.flowTopPadding,
      backgroundColor: PDF_VISUAL_CONTRACT.colors.softSurface,
      borderColor: PDF_VISUAL_CONTRACT.colors.border,
    });
    expect(request.images.every((entry) =>
      entry.backgroundColor === PDF_VISUAL_CONTRACT.colors.imageFrame &&
      entry.borderColor === PDF_VISUAL_CONTRACT.colors.border
    )).toBe(true);
    request.images.forEach((entry, index) => {
      const slot = context.groupsByBlockId.block.slots[index];
      expect(entry.xPoints).toBeCloseTo(slot.pdf.x, 4);
      expect(entry.yPoints).toBeCloseTo(
        request.surface.yPoints + slot.pdf.y,
        4,
      );
      expect(entry.widthPoints).toBeCloseTo(slot.pdf.width, 4);
      expect(entry.heightPoints).toBeCloseTo(slot.pdf.height, 4);
    });
    expect(JSON.stringify(request)).not.toMatch(
      /selection|handle|guide|toolbar|placeholder|references\//i,
    );
  });

  it("produces a stable composite pixel fingerprint and changes it with order", () => {
    const source = group("hash", {
      images: [
        image("first", 100, 80, {
          x: 0.1,
          y: 0.2,
          width: 0.7,
          height: 0.6,
        }),
        image("second", 90, 70),
      ],
    });
    const context = exportContext(plan(
      [imageGroupBlock("block", source.id)],
      [source],
    ));
    const request = buildPreshotDocxImageGroupCompositeRequest(
      imageGroupBlock("block", source.id),
      context,
    )!;
    const firstHash = createHash("sha256")
      .update(deterministicCompositePng(request))
      .digest("hex");
    const secondHash = createHash("sha256")
      .update(deterministicCompositePng(request))
      .digest("hex");
    const reversedHash = createHash("sha256")
      .update(deterministicCompositePng({
        ...request,
        images: [...request.images].reverse(),
      }))
      .digest("hex");

    expect(firstHash).toBe(secondHash);
    expect(reversedHash).not.toBe(firstHash);
  });

  it("uses 300 PPI and proportionally enforces both raster caps", () => {
    expect(calculateDocxImageGroupRasterPlan(72, 36)).toEqual({
      width: 300,
      height: 150,
      targetPpi: 300,
      effectivePpi: 300,
      capped: false,
    });

    const capped = calculateDocxImageGroupRasterPlan(4_000, 4_000);
    expect(capped.capped).toBe(true);
    expect(capped.width).toBeLessThanOrEqual(
      DOCX_IMAGE_GROUP_MAX_AXIS_PIXELS,
    );
    expect(capped.height).toBeLessThanOrEqual(
      DOCX_IMAGE_GROUP_MAX_AXIS_PIXELS,
    );
    expect(capped.width * capped.height).toBeLessThanOrEqual(
      DOCX_IMAGE_GROUP_MAX_PIXELS,
    );
    expect(capped.width / capped.height).toBeCloseTo(1, 5);
    expect(capped.effectivePpi).toBeLessThan(150);
  });

  it("applies one uniform safety scale only to an oversized complete flow", () => {
    const source = group("oversized", {
      x: 30,
      width: 400,
      height: 2_000,
      frameOffsetY: 18,
      images: [image("tall", 200, 1_900)],
    });
    const context = exportContext(plan(
      [imageGroupBlock("block", source.id)],
      [source],
    ));
    const groupContext = context.groupsByBlockId.block;
    const request = buildPreshotDocxImageGroupCompositeRequest(
      imageGroupBlock("block", source.id),
      context,
    )!;
    const expectedHeight =
      context.page.contentHeight -
      DOCX_IMAGE_GROUP_PAGE_SAFETY_POINTS -
      DOCX_IMAGE_GROUP_PAGE_EPSILON_POINTS;
    const ratio = request.display.heightPoints /
      groupContext.pdf.flowHeight;

    expect(groupContext.pdf.unscaledFlowHeight).toBeGreaterThan(
      expectedHeight,
    );
    expect(request.display.heightPoints).toBeCloseTo(expectedHeight, 3);
    expect(request.display.heightPoints).toBeLessThan(
      context.page.contentHeight -
        DOCX_IMAGE_GROUP_PAGE_SAFETY_POINTS,
    );
    expect(request.display.widthPoints).toBeCloseTo(
      groupContext.pdf.width * ratio,
      4,
    );
    expect(request.images[0].heightPoints).toBeCloseTo(
      groupContext.slots[0].pdf.height * ratio,
      4,
    );
  });

  it("clips a negative group offset inside the one composite flow image", () => {
    const source = group("negative-offset", {
      height: 180,
      frameOffsetY: -20,
    });
    const context = exportContext(plan(
      [imageGroupBlock("block", source.id)],
      [source],
    ));
    const request = buildPreshotDocxImageGroupCompositeRequest(
      imageGroupBlock("block", source.id),
      context,
    )!;

    expect(request.surface.yPoints).toBeCloseTo(
      context.groupsByBlockId.block.pdf.offsetY,
      4,
    );
    expect(request.surface.yPoints).toBeLessThan(0);
    expect(request.display.heightPoints).toBeCloseTo(
      context.groupsByBlockId.block.pdf.flowHeight,
      4,
    );
  });

  it.each([
    { columns: 0, weights: [] as number[] },
    { columns: 2, weights: [2, 1] },
    { columns: 3, weights: [1, 1, 1] },
  ])("matches root and weighted $columns-column widths", ({ columns, weights }) => {
    const source = group(`layout-${columns}`, {
      x: 12,
      width: 900,
      height: 160,
    });
    const block = imageGroupBlock("block", source.id);
    const blocks = columns === 0
      ? [block]
      : [{
          id: "columns",
          type: "columnList" as const,
          props: {},
          content: undefined,
          children: weights.map((weight, index) => ({
            id: `column-${index}`,
            type: "column" as const,
            props: { width: weight },
            content: undefined,
            children: index === 0
              ? [block]
              : [paragraphBlock(`copy-${index}`)],
          })),
        }];
    const context = exportContext(plan(blocks, [source]));
    const request = buildPreshotDocxImageGroupCompositeRequest(
      block,
      context,
    )!;
    const groupContext = context.groupsByBlockId.block;

    expect(request.display.widthPoints).toBeCloseTo(
      groupContext.pdf.width,
      4,
    );
    expect(request.display.widthPoints).toBeLessThanOrEqual(
      groupContext.parent.pdfWidth,
    );
    if (columns > 0) {
      expect(groupContext.parent.columnBlockId).toBe("column-0");
    }
  });
});

describe("DOCX image-group mapping", () => {
  it("maps one group to one inline PNG paragraph with exact Word geometry and alt text", async () => {
    const source = group("hero", {
      x: 36,
      width: 300,
      height: 180,
    });
    source.name = "Lighting board";
    source.description = "Three lighting references";
    const block = imageGroupBlock("block", source.id);
    const context = exportContext(plan([block], [source]));
    const requests: PreshotDocxImageGroupCompositeRequest[] = [];
    const compositor = vi.fn(async (
      request: PreshotDocxImageGroupCompositeRequest,
    ) => {
      requests.push(request);
      return PACKABLE_PNG;
    });
    const paragraph = await createPreshotImageGroupDocxBlockMapping(
      context,
      { compositor },
    )(block);

    expect(Array.isArray(paragraph)).toBe(false);
    const request = requests[0]!;
    const packed = await paragraphXml(paragraph as Paragraph);
    const widthEmu = Math.round(
      pointsToDocxLayoutPixels(request.display.widthPoints) * 9_525,
    );
    const heightEmu = Math.round(
      pointsToDocxLayoutPixels(request.display.heightPoints) * 9_525,
    );

    expect(compositor).toHaveBeenCalledTimes(1);
    expect(packed.media).toHaveLength(1);
    expect(packed.xml.match(/<wp:inline\b/g)).toHaveLength(1);
    expect(packed.xml.match(/<w:drawing>/g)).toHaveLength(1);
    expect(packed.xml).toContain(
      `cx="${widthEmu}" cy="${heightEmu}"`,
    );
    expect(packed.xml).toContain(
      `w:left="${pointsToTwips(request.display.indentPoints)}"`,
    );
    expect(packed.xml).toContain("<w:keepLines");
    expect(packed.xml).toMatch(/<w:spacing[^>]*w:before="0"/);
    expect(packed.xml).toMatch(/<w:spacing[^>]*w:after="0"/);
    expect(packed.xml).toContain('<w:keepNext w:val="false"');
    expect(packed.xml).not.toContain("<w:pageBreakBefore");
    expect(packed.xml).not.toContain("<wp:anchor");
    expect(packed.xml).not.toContain("<a:srcRect");
    expect(packed.xml).toContain('name="Lighting board"');
    expect(packed.xml).toContain('descr="Three lighting references"');
    expect(packed.xml).not.toContain("references/");
    expect(packed.xml).not.toContain("hero-image.png");
  });

  it("injects only imageGroup without mutating concurrent ordinary mappings", () => {
    const source = group("injected");
    const context = exportContext(plan(
      [imageGroupBlock("block", source.id)],
      [source],
    ));
    const paragraph = vi.fn();
    const ordinary = { paragraph, heading: vi.fn() };
    const compatibleMapping: PreshotImageGroupDocxMapping =
      createPreshotImageGroupDocxBlockMapping(
        context,
        { compositor: async () => PACKABLE_PNG },
      );
    const injected = injectPreshotImageGroupDocxBlockMapping(
      ordinary,
      context,
      { compositor: async () => PACKABLE_PNG },
    );

    expect(injected).not.toBe(ordinary);
    expect(injected.paragraph).toBe(paragraph);
    expect(injected.heading).toBe(ordinary.heading);
    expect(injected.imageGroup).toBeTypeOf("function");
    expect(compatibleMapping).toBeTypeOf("function");
    expect(ordinary).not.toHaveProperty("imageGroup");
  });

  it("returns deterministic no-content for an empty group", async () => {
    const source = group("empty", { images: [] });
    const block = imageGroupBlock("block", source.id);
    const context = exportContext(plan([block], [source]));
    const compositor = vi.fn(async () => PACKABLE_PNG);

    await expect(createPreshotImageGroupDocxBlockMapping(
      context,
      { compositor },
    )(block)).resolves.toEqual([]);
    expect(compositor).not.toHaveBeenCalled();
  });

  it("fails contextually for missing or corrupt non-empty assets", async () => {
    const source = group("broken");
    const block = imageGroupBlock("block", source.id);
    const context = exportContext(plan([block], [source]));
    const missing: PreshotPdfExportContext = {
      ...context,
      assets: [],
      assetsById: {},
    };

    await expect(createPreshotImageGroupDocxBlockMapping(
      missing,
      { compositor: async () => PACKABLE_PNG },
    )(block)).rejects.toMatchObject({
      name: "PreshotImageGroupDocxRenderError",
      code: "MISSING_OPTIMIZED_ASSET",
      context: {
        blockId: "block",
        groupId: "broken",
        imageId: "broken-image",
      },
    } satisfies Partial<PreshotImageGroupDocxRenderError>);

    const assetId = context.groupsByBlockId.block.slots[0].assetId;
    const corrupt: PreshotPdfExportContext = {
      ...context,
      assetsById: {
        ...context.assetsById,
        [assetId]: {
          ...context.assetsById[assetId],
          bytes: new Uint8Array(),
        },
      },
    };
    await expect(createPreshotImageGroupDocxBlockMapping(
      corrupt,
      { compositor: async () => PACKABLE_PNG },
    )(block)).rejects.toMatchObject({
      code: "INVALID_OPTIMIZED_ASSET",
      context: { assetId },
    });
  });

  it("emits a contextual warning below 150 PPI", async () => {
    const source = group("warning");
    const block = imageGroupBlock("block", source.id);
    const context = exportContext(plan([block], [source]));
    const original = context.groupsByBlockId.block;
    const hugeGroup = {
      ...original,
      parent: {
        ...original.parent,
        pdfWidth: 5_000 as typeof original.parent.pdfWidth,
      },
      pdf: {
        ...original.pdf,
        x: 0 as typeof original.pdf.x,
        width: 5_000 as typeof original.pdf.width,
        unscaledHeight: 5_000 as typeof original.pdf.unscaledHeight,
        unscaledFlowHeight: 5_000 as typeof original.pdf.unscaledFlowHeight,
        displayedHeight: 5_000 as typeof original.pdf.displayedHeight,
        flowHeight: 5_000 as typeof original.pdf.flowHeight,
      },
      docx: {
        exportOnlyGroupPhysicalScale:
          1 as typeof original.docx.exportOnlyGroupPhysicalScale,
      },
    };
    const warningContext: PreshotPdfExportContext = {
      ...context,
      page: {
        ...context.page,
        contentHeight: 6_000 as typeof context.page.contentHeight,
      },
      groups: [hugeGroup],
      groupsByBlockId: { block: hugeGroup },
      groupsByGroupId: { warning: hugeGroup },
    };
    const onWarning = vi.fn();

    await createPreshotImageGroupDocxBlockMapping(
      warningContext,
      {
        compositor: async () => PACKABLE_PNG,
        onWarning,
      },
    )(block);

    expect(onWarning).toHaveBeenCalledWith(expect.objectContaining({
      code: "LOW_EFFECTIVE_PPI",
      blockId: "block",
      groupId: "warning",
      effectivePpi: expect.any(Number),
    }));
    expect(onWarning.mock.calls[0][0].effectivePpi).toBeLessThan(150);
  });
});
