// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type {
  PreshotBlock,
  ProjectPlanV14,
} from "../../domain/plan/canvas/blockDocument";
import type { LongImageExportMeasurements } from "../../features/plan/blocknote/export/longImageExportModel";
import type {
  DomCaptureAdapter,
  DomCaptureRequest,
  DomCaptureSession,
} from "../capture/domCapture";
import {
  BlockNoteLongImageExporter,
  type BlockNoteLongImageExportRequest,
} from "./BlockNoteLongImageExporter";
import type {
  LongImageExportSurfaceHandle,
  MountLongImageExportSurfaceOptions,
} from "./longImageExportSurface";

const JPEG_SIGNATURE = [255, 216, 255, 224];
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function planFor(
  blockIds: readonly string[],
  imageGroupId?: string,
): ProjectPlanV14 {
  return {
    schemaVersion: 15,
    artifacts: [],
    title: "Long export",
    document: {
      format: "preshot-blocks",
      version: 3,
      blocks: blockIds.map((id): PreshotBlock => {
        if (id === "image-group") {
          return {
            id,
            type: "imageGroup",
            props: { groupId: imageGroupId ?? "group" },
            content: undefined,
            children: [],
          };
        }
        return {
          id,
          type: "paragraph",
          props: {},
          content: [{ type: "text", text: id, styles: {} }],
          children: [],
        };
      }),
    },
    imageGroups: imageGroupId
      ? [{
        id: imageGroupId,
        type: "reference",
        name: "Group",
        description: "",
        x: 0,
        width: 840,
        height: 10_500,
        images: [],
      }]
      : [],
  };
}

function rect(
  blockId: string,
  top: number,
  bottom: number,
  blockType = "paragraph",
) {
  return {
    blockId,
    blockType,
    top,
    right: 900,
    bottom,
    left: 0,
    width: 900,
    height: bottom - top,
  };
}

function measurements(
  bottoms: readonly number[],
  options: {
    readonly width?: 890 | 900;
    readonly blockIds?: readonly string[];
    readonly imageRows?: readonly number[];
  } = {},
): LongImageExportMeasurements {
  const width = options.width ?? 900;
  const blockIds = options.blockIds ??
    bottoms.map((_, index) => `block-${index + 1}`);
  let top = 0;
  const topLevelBlocks = bottoms.map((bottom, index) => {
    const boundary = rect(
      blockIds[index]!,
      top,
      bottom,
      blockIds[index] === "image-group" ? "imageGroup" : "paragraph",
    );
    top = bottom;
    return boundary;
  });
  return {
    outerWidth: width,
    contentWidth: width === 900 ? 840 : 830.6666666666666,
    height: bottoms.at(-1)!,
    scale: width / 1080,
    topLevelBlocks,
    atomicBlocks: topLevelBlocks.filter((entry) =>
      entry.blockType === "imageGroup"
    ),
    imageGroupRows: (options.imageRows ?? []).map((bottom, rowIndex) => ({
      id: `group:${rowIndex}`,
      blockId: "image-group",
      groupId: "group",
      rowIndex,
      imageIds: [`image-${rowIndex}`],
      top: rowIndex === 0 ? 0 : options.imageRows![rowIndex - 1]!,
      right: width,
      bottom,
      left: 0,
      width,
      height: bottom -
        (rowIndex === 0 ? 0 : options.imageRows![rowIndex - 1]!),
    })),
  };
}

function sizedBlob(
  size: number,
  format: "jpeg" | "png",
): Blob {
  const signature = format === "jpeg" ? JPEG_SIGNATURE : PNG_SIGNATURE;
  const bytes = new Uint8Array([...signature, 1, 2, 3, 4]);
  return {
    size,
    type: format === "jpeg" ? "image/jpeg" : "image/png",
    arrayBuffer: async () => bytes.buffer.slice(0),
  } as Blob;
}

interface Harness {
  exporter: BlockNoteLongImageExporter;
  captures: DomCaptureRequest[];
  canvases: HTMLCanvasElement[];
  close: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  mount: ReturnType<typeof vi.fn>;
}

function harness(
  layout: LongImageExportMeasurements,
  encode: (
    canvas: HTMLCanvasElement,
    format: "jpeg" | "png",
    quality?: number,
  ) => Promise<Blob> = async (_canvas, format) => sizedBlob(100, format),
  captureFailure?: Error,
): Harness {
  const captures: DomCaptureRequest[] = [];
  const canvases: HTMLCanvasElement[] = [];
  const close = vi.fn();
  const destroy = vi.fn();
  const element = document.createElement("section");
  const session: DomCaptureSession = {
    async capture(request) {
      captures.push(request);
      if (captureFailure) throw captureFailure;
      if (!request.viewport) throw new Error("Expected bounded viewport");
      const canvas = document.createElement("canvas");
      canvas.width = request.viewport.width;
      canvas.height = request.viewport.height;
      canvases.push(canvas);
      return {
        output: "canvas",
        canvas,
        width: canvas.width,
        height: canvas.height,
        pixelRatio: 1,
      };
    },
    close,
  };
  const captureAdapter: DomCaptureAdapter = {
    createSession: vi.fn(async () => session),
    async capture(_element, request) {
      return session.capture(request);
    },
  };
  const mount = vi.fn(
    async (
      _options: MountLongImageExportSurfaceOptions,
    ): Promise<LongImageExportSurfaceHandle> => ({
      element,
      measurements: layout,
      destroy,
    }),
  );
  return {
    exporter: new BlockNoteLongImageExporter({
      captureAdapter,
      mountSurface: mount,
      encodeCanvas: encode,
    }),
    captures,
    canvases,
    close,
    destroy,
    mount,
  };
}

function request(
  plan: ProjectPlanV14,
  overrides: Partial<BlockNoteLongImageExportRequest> = {},
): BlockNoteLongImageExportRequest {
  return {
    plan,
    resolvedAssets: {},
    preset: "wechat",
    ...overrides,
  };
}

describe("BlockNoteLongImageExporter", () => {
  it("exports one short JPEG with exact width, signature, manifest, and progress", async () => {
    const test = harness(measurements([1200], {
      blockIds: ["one"],
      width: 890,
    }));
    const progress: string[] = [];
    const result = await test.exporter.export(request(planFor(["one"]), {
      options: { width: 890 },
      onProgress: (event) => progress.push(
        `${event.phase}:${event.partNumber ?? 0}/${event.partCount ?? 0}`,
      ),
    }));

    expect(test.mount).toHaveBeenCalledWith(expect.objectContaining({
      outerWidth: 890,
    }));
    expect(test.captures).toEqual([expect.objectContaining({
      viewport: {
        x: 0,
        y: 0,
        width: 890,
        height: 1200,
        sourceWidth: 890,
        sourceHeight: 1200,
      },
    })]);
    expect(result.manifest.format).toBe("jpeg");
    expect(result.manifest.fileNames).toEqual(["Long export.jpg"]);
    expect(result.parts[0]).toMatchObject({
      width: 890,
      height: 1200,
      quality: 0.84,
      mime: "image/jpeg",
      encodedBytes: 8,
    });
    expect([...result.parts[0]!.bytes.slice(0, 4)]).toEqual(JPEG_SIGNATURE);
    expect(progress).toEqual([
      "prepare:0/0",
      "assets:0/0",
      "layout:0/0",
      "render:1/1",
      "encode:1/1",
    ]);
    expect(test.canvases[0]).toMatchObject({ width: 0, height: 0 });
    expect(test.close).toHaveBeenCalledOnce();
    expect(test.destroy).toHaveBeenCalledOnce();
  });

  it("keeps the exact 6000px boundary in one capture", async () => {
    const test = harness(measurements([6000], { blockIds: ["one"] }));
    const result = await test.exporter.export(request(planFor(["one"])));

    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]?.part).toMatchObject({
      top: 0,
      bottom: 6000,
      height: 6000,
    });
    expect(test.captures[0]?.viewport).toMatchObject({
      y: 0,
      height: 6000,
    });
  });

  it("treats omitted allowSplit as false and rejects unsafe overflow", async () => {
    const test = harness(measurements([8001], { blockIds: ["one"] }));

    await expect(test.exporter.export(request(planFor(["one"]))))
      .rejects.toMatchObject({
        code: "SPLITTING_REQUIRED",
        message:
          "This document exceeds safe single-image limits. Enable automatic splitting, shorten the plan, or export PDF/DOCX.",
      });
    expect(test.captures).toEqual([]);
    expect(test.close).not.toHaveBeenCalled();
    expect(test.destroy).toHaveBeenCalledOnce();
  });

  it("tiles above the 8000px allocation cap when splitting is explicit", async () => {
    const test = harness(measurements([8001], { blockIds: ["one"] }));
    const result = await test.exporter.export(request(planFor(["one"]), {
      options: { allowSplit: true },
    }));

    expect(test.captures.map((entry) => entry.viewport)).toEqual([
      expect.objectContaining({ y: 0, height: 8000 }),
      expect.objectContaining({ y: 8000, height: 1 }),
    ]);
    expect(result.parts.map(({ height }) => height)).toEqual([8000, 1]);
    expect(result.warnings.map(({ code }) => code)).toContain(
      "ATOMIC_BLOCK_TILED",
    );
  });

  it("captures block-aware parts sequentially without gaps or duplicated pixels", async () => {
    const layout = measurements([2500, 5500, 10_000], {
      blockIds: ["one", "two", "three"],
    });
    const test = harness(layout);
    const result = await test.exporter.export(
      request(planFor(["one", "two", "three"]), {
        options: { allowSplit: true },
      }),
    );

    expect(result.parts.map(({ part }) => [part.top, part.bottom])).toEqual([
      [0, 5500],
      [5500, 10_000],
    ]);
    expect(test.captures.map((entry) => entry.viewport)).toEqual([
      expect.objectContaining({ y: 0, height: 5500 }),
      expect.objectContaining({ y: 5500, height: 4500 }),
    ]);
  });

  it("splits a huge image group only on complete row metadata", async () => {
    const layout = measurements([10_500], {
      blockIds: ["image-group"],
      imageRows: [2100, 4800, 7300, 10_500],
    });
    const test = harness(layout);
    const result = await test.exporter.export(
      request(planFor(["image-group"], "group"), {
        options: { allowSplit: true },
      }),
    );

    expect(result.manifest.blocks[0]?.imageGroupRows).toEqual([
      { rowIndex: 0, bottom: 2100 },
      { rowIndex: 1, bottom: 4800 },
      { rowIndex: 2, bottom: 7300 },
      { rowIndex: 3, bottom: 10_500 },
    ]);
    expect(result.parts.map(({ part }) => [
      part.top,
      part.bottom,
      part.endKind,
    ])).toEqual([
      [0, 4800, "image-group-row"],
      [4800, 10_500, "document-end"],
    ]);
  });

  it("converges to the highest bounded JPEG quality", async () => {
    const qualities: number[] = [];
    const test = harness(
      measurements([1200], { blockIds: ["one"] }),
      async (_canvas, format, quality) => {
        qualities.push(quality!);
        return sizedBlob(
          Math.round(400_000 + quality! * 900_000),
          format,
        );
      },
    );
    const result = await test.exporter.export(request(planFor(["one"])));

    expect(result.parts[0]?.quality).toBeCloseTo(0.72, 2);
    expect(qualities.slice(0, 2)).toEqual([0.84, 0.68]);
    expect(qualities.length).toBeLessThanOrEqual(14);
  });

  it("re-captures JPEG parts at successively earlier block boundaries", async () => {
    const layout = measurements([2000, 4000, 6000], {
      blockIds: ["one", "two", "three"],
    });
    const test = harness(
      layout,
      async (canvas, format) =>
        sizedBlob(canvas.height > 2000 ? 1_200_000 : 100_000, format),
    );
    const result = await test.exporter.export(
      request(planFor(["one", "two", "three"]), {
        options: { allowSplit: true },
      }),
    );

    expect(result.parts.map(({ part }) => [part.top, part.bottom])).toEqual([
      [0, 2000],
      [2000, 4000],
      [4000, 6000],
    ]);
    expect(test.captures.map((entry) => entry.viewport?.height)).toEqual([
      6000,
      4000,
      2000,
      2000,
      2000,
    ]);
    expect(result.manifest.fileNames).toEqual([
      "Long export-01.jpg",
      "Long export-02.jpg",
      "Long export-03.jpg",
    ]);
  });

  it("re-captures lossless PNG at an earlier byte-safe boundary", async () => {
    const layout = measurements([2000, 4000], {
      blockIds: ["one", "two"],
    });
    const test = harness(
      layout,
      async (canvas, format) =>
        sizedBlob(canvas.height > 2000 ? 9_000_000 : 1_000_000, format),
    );
    const result = await test.exporter.export(request(planFor(["one", "two"]), {
      preset: "lossless-png",
      options: { allowSplit: true },
    }));

    expect(result.parts.map(({ part }) => [part.top, part.bottom])).toEqual([
      [0, 2000],
      [2000, 4000],
    ]);
    expect(result.parts.every((part) =>
      part.mime === "image/png" && part.quality === undefined
    )).toBe(true);
    expect([...result.parts[0]!.bytes.slice(0, 8)]).toEqual(PNG_SIGNATURE);
  });

  it("accepts the exact preset cumulative encoded-byte budget", async () => {
    const bottoms = Array.from(
      { length: 16 },
      (_, index) => (index + 1) * 8_000,
    );
    const blockIds = bottoms.map((_, index) => `block-${index + 1}`);
    const test = harness(
      measurements(bottoms, { blockIds }),
      async (_canvas, format) => sizedBlob(3 * 1_048_576, format),
    );

    const result = await test.exporter.export(request(planFor(blockIds), {
      preset: "high-quality",
      options: { allowSplit: true },
    }));

    expect(result.parts).toHaveLength(16);
    expect(test.captures).toHaveLength(16);
    expect(test.canvases.every(
      (canvas) => canvas.width === 0 && canvas.height === 0,
    )).toBe(true);
  });

  it("rejects one cumulative encoded byte over budget before retaining it", async () => {
    const bottoms = Array.from(
      { length: 17 },
      (_, index) => (index + 1) * 8_000,
    );
    const blockIds = bottoms.map((_, index) => `block-${index + 1}`);
    let partNumber = 0;
    const test = harness(
      measurements(bottoms, { blockIds }),
      async (_canvas, format) => {
        partNumber += 1;
        return sizedBlob(
          partNumber <= 16 ? 3 * 1_048_576 : 1,
          format,
        );
      },
    );

    await expect(test.exporter.export(request(planFor(blockIds), {
      preset: "high-quality",
      options: { allowSplit: true },
    }))).rejects.toMatchObject({
      code: "TOTAL_ENCODED_BYTES_EXCEEDED",
      context: expect.objectContaining({
        maxTotalBytes: 48 * 1_048_576,
        nextPartBytes: 1,
        totalBytes: 48 * 1_048_576 + 1,
      }),
    });
    expect(test.canvases.at(-1)).toMatchObject({ width: 0, height: 0 });
    expect(test.close).toHaveBeenCalledOnce();
    expect(test.destroy).toHaveBeenCalledOnce();
  });

  it("rejects many tiny planned parts before creating a capture context", async () => {
    const bottoms = Array.from(
      { length: 33 },
      (_, index) => (index + 1) * 8_000,
    );
    const blockIds = bottoms.map((_, index) => `block-${index + 1}`);
    const test = harness(measurements(bottoms, { blockIds }));

    await expect(test.exporter.export(request(planFor(blockIds), {
      preset: "high-quality",
      options: { allowSplit: true },
    }))).rejects.toMatchObject({
      code: "PART_COUNT_EXCEEDED",
      context: expect.objectContaining({ maxParts: 32, partCount: 33 }),
    });
    expect(test.captures).toEqual([]);
    expect(test.close).not.toHaveBeenCalled();
    expect(test.destroy).toHaveBeenCalledOnce();
  });

  it("fails actionably when byte splitting is disabled", async () => {
    const test = harness(
      measurements([2000, 4000], { blockIds: ["one", "two"] }),
      async (_canvas, format) => sizedBlob(1_200_000, format),
    );

    await expect(test.exporter.export(request(planFor(["one", "two"]), {
      options: { allowSplit: false },
    }))).rejects.toMatchObject({ code: "SPLITTING_DISABLED" });
    expect(test.close).toHaveBeenCalledOnce();
    expect(test.destroy).toHaveBeenCalledOnce();
  });

  it("cancels between parts and cleans the surface, context, and canvas", async () => {
    const controller = new AbortController();
    const test = harness(measurements([3000, 9000], {
      blockIds: ["one", "two"],
    }));

    await expect(test.exporter.export(request(planFor(["one", "two"]), {
      signal: controller.signal,
      options: { allowSplit: true },
      onProgress: (event) => {
        if (event.phase === "render") controller.abort();
      },
    }))).rejects.toMatchObject({ name: "AbortError" });
    expect(test.captures).toEqual([]);
    expect(test.close).toHaveBeenCalledOnce();
    expect(test.destroy).toHaveBeenCalledOnce();
  });

  it("cleans up after capture and encode failures without success-shaped output", async () => {
    const capture = harness(
      measurements([1000], { blockIds: ["one"] }),
      undefined,
      new Error("worker crashed"),
    );
    await expect(capture.exporter.export(request(planFor(["one"]))))
      .rejects.toMatchObject({ phase: "render" });
    expect(capture.close).toHaveBeenCalledOnce();
    expect(capture.destroy).toHaveBeenCalledOnce();

    const encode = harness(
      measurements([1000], { blockIds: ["one"] }),
      async () => {
        throw new Error("encoder failed");
      },
    );
    await expect(encode.exporter.export(request(planFor(["one"]))))
      .rejects.toMatchObject({ phase: "encode" });
    expect(encode.canvases[0]).toMatchObject({ width: 0, height: 0 });
    expect(encode.close).toHaveBeenCalledOnce();
    expect(encode.destroy).toHaveBeenCalledOnce();
  });

  it("rejects malformed plan and remote asset context before capture", async () => {
    const test = harness(measurements([1000], { blockIds: ["one"] }));
    const malformed = { ...planFor(["one"]), schemaVersion: 13 } as
      unknown as ProjectPlanV14;
    await expect(test.exporter.export(request(malformed))).rejects
      .toMatchObject({ phase: "prepare" });
    expect(test.mount).not.toHaveBeenCalled();

    const media = planFor(["one"]);
    media.document.blocks[0] = {
      id: "image",
      type: "image",
      props: {
        caption: "",
        name: "private.png",
        showPreview: true,
        url: "media/private.png",
      },
      content: undefined,
      children: [],
    };
    await expect(test.exporter.export(request(media, {
      resolvedAssets: {
        "media/private.png": "https://example.com/private.png",
      },
    }))).rejects.toMatchObject({ phase: "assets" });
    expect(test.mount).not.toHaveBeenCalled();
  });
});
