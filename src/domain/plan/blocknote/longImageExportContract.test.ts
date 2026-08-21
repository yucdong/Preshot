import { describe, expect, it } from "vitest";
import {
  LONG_IMAGE_PRESETS,
  LongImageContractError,
  assertLongImageCumulativeBudget,
  buildLongImageExportManifest,
  createLongImageGeometry,
  decideJpegEncoding,
  decidePngEncoding,
  estimateLongImageDecodedMemory,
  findEarlierLongImageBoundary,
  planLongImageFileNames,
  planLongImageParts,
  sanitizeLongImageBaseName,
  type LongImageMeasuredBlock,
} from "./longImageExportContract";
import {
  MAX_LONG_IMAGE_BASE_NAME_CODE_POINTS,
  MAX_LONG_IMAGE_BASE_NAME_UTF16_CODE_UNITS,
  MAX_LONG_IMAGE_FILENAME_UTF16_CODE_UNITS,
  MAX_LONG_IMAGE_PARTS,
} from "../longImageSave";

const block = (
  blockId: string,
  top: number,
  bottom: number,
  rows?: readonly number[],
): LongImageMeasuredBlock => ({
  blockId,
  blockType: rows ? "imageGroup" : "paragraph",
  top,
  bottom,
  atomic: true,
  imageGroupRows: rows?.map((rowBottom, rowIndex) => ({
    rowIndex,
    bottom: rowBottom,
  })),
});

describe("long-image geometry and limits", () => {
  it("scales the 1080px surface and 1008px content exactly to 900px", () => {
    const geometry = createLongImageGeometry(900);

    expect(geometry.scale).toBe(5 / 6);
    expect(geometry.contentWidth).toBe(840);
    expect(geometry.sidePadding).toBe(30);
  });

  it("uses the same uniform scale at the supported 890px width", () => {
    const geometry = createLongImageGeometry(890);

    expect(geometry.scale).toBe(89 / 108);
    expect(geometry.contentWidth).toBeCloseTo(830.6666666667, 10);
    expect(geometry.sidePadding).toBeCloseTo(29.6666666667, 10);
  });

  it("publishes conservative JPEG and PNG preset limits", () => {
    expect(LONG_IMAGE_PRESETS.wechat).toMatchObject({
      default: true,
      format: "jpeg",
      width: 900,
      limits: {
        targetHeight: 6_000,
        targetBytes: 1_048_576,
        hardMaxBytes: 2_097_152,
        initialQuality: 0.84,
        minimumQuality: 0.68,
      },
      cumulativeBudget: {
        maxParts: 32,
        maxTotalBytes: 25_165_824,
      },
    });
    expect(LONG_IMAGE_PRESETS["high-quality"]).toMatchObject({
      format: "jpeg",
      width: 900,
      limits: {
        targetHeight: 8_000,
        targetBytes: 3_145_728,
        initialQuality: 0.9,
      },
      cumulativeBudget: {
        maxParts: 32,
        maxTotalBytes: 50_331_648,
      },
    });
    expect(LONG_IMAGE_PRESETS["lossless-png"]).toMatchObject({
      format: "png",
      width: 900,
      limits: {
        targetHeight: 4_000,
        targetBytes: 8_388_608,
        hardMaxBytes: 10_485_760,
      },
      cumulativeBudget: {
        maxParts: 32,
        maxTotalBytes: 67_108_864,
      },
    });
  });

  it("accepts exact cumulative limits and rejects one additional byte or part", () => {
    const exact = LONG_IMAGE_PRESETS.wechat.cumulativeBudget.maxTotalBytes;
    expect(assertLongImageCumulativeBudget({
      preset: "wechat",
      partCount: 32,
      retainedBytes: exact - 1,
      nextPartBytes: 1,
    })).toBe(exact);

    expect(() => assertLongImageCumulativeBudget({
      preset: "wechat",
      partCount: 32,
      retainedBytes: exact,
      nextPartBytes: 1,
    })).toThrow(expect.objectContaining({
      code: "TOTAL_ENCODED_BYTES_EXCEEDED",
      context: expect.objectContaining({
        maxTotalBytes: exact,
        nextPartBytes: 1,
        totalBytes: exact + 1,
      }),
    }));
    expect(() => assertLongImageCumulativeBudget({
      preset: "lossless-png",
      partCount: 33,
      retainedBytes: 33,
    })).toThrow(expect.objectContaining({
      code: "PART_COUNT_EXCEEDED",
      context: expect.objectContaining({ maxParts: 32, partCount: 33 }),
    }));
  });

  it("estimates decoded RGBA memory without relying on browser APIs", () => {
    const estimate = estimateLongImageDecodedMemory(900, 6_000);

    expect(estimate.pixelCount).toBe(5_400_000);
    expect(estimate.rgbaBytes).toBe(21_600_000);
    expect(estimate.mebibytes).toBeCloseTo(20.6, 1);
    expect(estimate.withinSafetyBudget).toBe(true);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid geometry values: %s",
    (value) => {
      expect(() => createLongImageGeometry(value as 900)).toThrow(
        LongImageContractError,
      );
      expect(() => estimateLongImageDecodedMemory(900, value)).toThrow(
        LongImageContractError,
      );
    },
  );
});

describe("planLongImageParts", () => {
  it("keeps an exact 6000px document in one part", () => {
    const plan = planLongImageParts({
      documentHeight: 6_000,
      targetHeight: 6_000,
      blocks: [block("one", 0, 6_000)],
      allowSplit: true,
    });

    expect(plan.parts).toEqual([expect.objectContaining({
      index: 0,
      top: 0,
      bottom: 6_000,
      height: 6_000,
      endKind: "document-end",
    })]);
    expect(plan.warnings).toEqual([]);
  });

  it("chooses the last complete block boundary at or below the target", () => {
    const plan = planLongImageParts({
      documentHeight: 10_000,
      targetHeight: 6_000,
      blocks: [
        block("one", 0, 2_500),
        block("two", 2_500, 5_500),
        block("three", 5_500, 10_000),
      ],
      allowSplit: true,
    });

    expect(plan.parts.map(({ top, bottom }) => [top, bottom])).toEqual([
      [0, 5_500],
      [5_500, 10_000],
    ]);
    expect(plan.parts[0]?.endBlockId).toBe("two");
  });

  it("keeps one atomic block whole above the target but below the emergency cap", () => {
    const plan = planLongImageParts({
      documentHeight: 7_200,
      targetHeight: 6_000,
      blocks: [block("huge-table", 0, 7_200)],
      allowSplit: true,
    });

    expect(plan.parts).toHaveLength(1);
    expect(plan.parts[0]).toMatchObject({
      top: 0,
      bottom: 7_200,
      endKind: "block",
      endBlockId: "huge-table",
    });
    expect(plan.warnings.map((warning) => warning.code)).toContain(
      "TARGET_HEIGHT_EXCEEDED",
    );
  });

  it("tiles one indivisible block at the absolute cap and guarantees progress", () => {
    const plan = planLongImageParts({
      documentHeight: 17_500,
      targetHeight: 6_000,
      blocks: [block("huge-table", 0, 17_500)],
      allowSplit: true,
    });

    expect(plan.parts.map(({ top, bottom }) => [top, bottom])).toEqual([
      [0, 8_000],
      [8_000, 16_000],
      [16_000, 17_500],
    ]);
    expect(plan.parts.slice(0, 2).every(
      (part) => part.endKind === "emergency-tile",
    )).toBe(true);
    expect(plan.warnings.filter(
      (warning) => warning.code === "ATOMIC_BLOCK_TILED",
    )).toHaveLength(2);
  });

  it("splits an oversized image group only at wrapped row boundaries", () => {
    const plan = planLongImageParts({
      documentHeight: 10_500,
      targetHeight: 6_000,
      blocks: [block("group", 0, 10_500, [2_100, 4_800, 7_300, 10_500])],
      allowSplit: true,
    });

    expect(plan.parts.map(({ top, bottom, endKind }) => ({
      top,
      bottom,
      endKind,
    }))).toEqual([
      { top: 0, bottom: 4_800, endKind: "image-group-row" },
      { top: 4_800, bottom: 10_500, endKind: "document-end" },
    ]);
  });

  it("produces contiguous parts with no duplicated or missing pixels", () => {
    const plan = planLongImageParts({
      documentHeight: 20_250,
      targetHeight: 6_000,
      blocks: [
        block("one", 0, 4_000),
        block("group", 4_000, 15_500, [7_000, 10_000, 13_000, 15_500]),
        block("three", 15_500, 20_250),
      ],
      allowSplit: true,
    });

    expect(plan.parts[0]?.top).toBe(0);
    expect(plan.parts.at(-1)?.bottom).toBe(20_250);
    for (let index = 1; index < plan.parts.length; index += 1) {
      expect(plan.parts[index]?.top).toBe(plan.parts[index - 1]?.bottom);
    }
    expect(plan.parts.every((part) => part.height > 0)).toBe(true);
    expect(plan.parts.reduce((sum, part) => sum + part.height, 0)).toBe(
      20_250,
    );
  });

  it("fails actionably when safe output requires splitting but it is disabled", () => {
    expect(() => planLongImageParts({
      documentHeight: 8_001,
      targetHeight: 6_000,
      blocks: [
        block("one", 0, 4_000),
        block("two", 4_000, 8_001),
      ],
      allowSplit: false,
    })).toThrow(expect.objectContaining({
      code: "SPLITTING_REQUIRED",
      message:
        "This document exceeds safe single-image limits. Enable automatic splitting, shorten the plan, or export PDF/DOCX.",
    }));
  });

  it("rejects unsorted, overlapping, or out-of-range boundary input", () => {
    const invalidCases: readonly (readonly LongImageMeasuredBlock[])[] = [
      [block("one", 2_000, 3_000), block("two", 0, 1_000)],
      [block("one", 0, 3_000), block("two", 2_000, 4_000)],
      [block("one", 0, 4_001)],
      [block("group", 0, 4_000, [2_000, 1_000, 4_000])],
    ];

    for (const blocks of invalidCases) {
      expect(() => planLongImageParts({
        documentHeight: 4_000,
        targetHeight: 2_000,
        blocks,
        allowSplit: true,
      })).toThrow(LongImageContractError);
    }
  });
});

describe("encoded-size decisions", () => {
  it("binary-searches the highest JPEG quality under target from 0.84 to 0.68", async () => {
    const calls: number[] = [];
    const decision = await decideJpegEncoding({
      limits: LONG_IMAGE_PRESETS.wechat.limits,
      encodeSize: (quality) => {
        calls.push(quality);
        return Math.round(400_000 + quality * 900_000);
      },
      qualityPrecision: 0.001,
      maxIterations: 12,
    });

    expect(decision.kind).toBe("accepted");
    if (decision.kind !== "accepted") throw new Error("Expected acceptance");
    expect(decision.quality).toBeCloseTo(0.72, 2);
    expect(decision.encodedBytes).toBeLessThanOrEqual(
      LONG_IMAGE_PRESETS.wechat.limits.targetBytes,
    );
    expect(calls[0]).toBe(0.84);
    expect(calls[1]).toBe(0.68);
  });

  it("requests an earlier boundary when minimum JPEG quality exceeds target", async () => {
    const decision = await decideJpegEncoding({
      limits: LONG_IMAGE_PRESETS.wechat.limits,
      encodeSize: (quality) => 1_100_000 + quality * 100_000,
    });

    expect(decision).toMatchObject({
      kind: "resplit",
      reason: "byte-target",
      minimumQuality: 0.68,
    });
  });

  it("finds a deterministic earlier boundary for a byte-driven re-split", () => {
    const blocks = [
      block("one", 0, 2_000),
      block("two", 2_000, 4_000),
      block("three", 4_000, 6_000),
    ];
    const boundary = findEarlierLongImageBoundary({
      part: {
        index: 0,
        top: 0,
        bottom: 6_000,
        height: 6_000,
        endKind: "block",
        endBlockId: "three",
      },
      blocks,
      allowSplit: true,
    });

    expect(boundary).toMatchObject({
      position: 4_000,
      kind: "block",
      blockId: "two",
    });
  });

  it("keeps the split-disabled byte-limit message distinct", () => {
    const part = {
      index: 0,
      top: 0,
      bottom: 4_000,
      height: 4_000,
      endKind: "block" as const,
      endBlockId: "one",
    };
    const blocks = [block("one", 0, 4_000)];

    expect(() => findEarlierLongImageBoundary({
      part,
      blocks,
      allowSplit: false,
    })).toThrow(expect.objectContaining({
      code: "SPLITTING_DISABLED",
      message:
        "Encoded output exceeds the single-image byte target. Enable automatic splitting, shorten the plan, or export PDF/DOCX.",
    }));
  });

  it("fails actionably when one atomic block cannot be split further", () => {
    const part = {
      index: 0,
      top: 0,
      bottom: 4_000,
      height: 4_000,
      endKind: "block" as const,
      endBlockId: "one",
    };
    const blocks = [block("one", 0, 4_000)];

    expect(() => findEarlierLongImageBoundary({
      part,
      blocks,
      allowSplit: true,
    })).toThrow(expect.objectContaining({
      code: "NO_EARLIER_BOUNDARY",
      message: expect.stringContaining(
        "Shorten or divide that block or image group",
      ),
      context: {
        partIndex: 0,
        partTop: 0,
        partBottom: 4_000,
        atomicKind: "block",
        blockId: "one",
        blockType: "paragraph",
      },
    }));
  });

  it("identifies an unsplittable image-group row in diagnostic context", () => {
    const part = {
      index: 1,
      top: 2_000,
      bottom: 5_000,
      height: 3_000,
      endKind: "image-group-row" as const,
      endBlockId: "group",
      endRowIndex: 1,
    };

    expect(() => findEarlierLongImageBoundary({
      part,
      blocks: [block("group", 0, 5_000, [2_000, 5_000])],
      allowSplit: true,
    })).toThrow(expect.objectContaining({
      code: "NO_EARLIER_BOUNDARY",
      context: expect.objectContaining({
        partIndex: 1,
        atomicKind: "image-group-row",
        blockId: "group",
        blockType: "imageGroup",
        rowIndex: 1,
      }),
    }));
  });

  it("requests a split for PNG above target and never exposes quality", () => {
    expect(decidePngEncoding({
      encodedBytes: LONG_IMAGE_PRESETS["lossless-png"].limits.targetBytes,
      limits: LONG_IMAGE_PRESETS["lossless-png"].limits,
    })).toEqual({
      kind: "accepted",
      encodedBytes: 8_388_608,
    });
    expect(decidePngEncoding({
      encodedBytes: 8_388_609,
      limits: LONG_IMAGE_PRESETS["lossless-png"].limits,
    })).toMatchObject({
      kind: "resplit",
      reason: "byte-target",
    });
  });
});

describe("long-image filename and manifest contracts", () => {
  it("sanitizes project names and Windows-reserved base names", () => {
    expect(sanitizeLongImageBaseName("  Summer: Look / 2026.  ")).toBe(
      "Summer- Look - 2026",
    );
    expect(sanitizeLongImageBaseName("CON")).toBe("CON-project");
    expect(sanitizeLongImageBaseName("...")).toBe("output-long");
  });

  it("normalizes project titles to NFC and truncates by Unicode code point", () => {
    expect(sanitizeLongImageBaseName("Cafe\u0301")).toBe("Café");
    expect(sanitizeLongImageBaseName("图".repeat(43))).toBe("图".repeat(43));

    const emoji = "😀".repeat(MAX_LONG_IMAGE_BASE_NAME_CODE_POINTS + 1);
    const sanitized = sanitizeLongImageBaseName(emoji);
    expect(Array.from(sanitized)).toHaveLength(
      MAX_LONG_IMAGE_BASE_NAME_UTF16_CODE_UNITS / 2,
    );
    expect(sanitized).toBe(
      "😀".repeat(MAX_LONG_IMAGE_BASE_NAME_UTF16_CODE_UNITS / 2),
    );
  });

  it("keeps generated numbered names within the Windows UTF-16 limit", () => {
    const baseName = "😀".repeat(
      MAX_LONG_IMAGE_BASE_NAME_UTF16_CODE_UNITS / 2,
    );
    const names = planLongImageFileNames({
      baseName,
      format: "jpeg",
      partCount: MAX_LONG_IMAGE_PARTS,
    });

    expect(names[0]).toBe(`${baseName}-01.jpg`);
    expect(names.at(-1)).toBe(`${baseName}-32.jpg`);
    expect(names.every(
      (fileName) =>
        fileName.length <= MAX_LONG_IMAGE_FILENAME_UTF16_CODE_UNITS,
    )).toBe(true);
  });

  it("trims a trailing dot or space introduced at the truncation boundary", () => {
    const prefix = "a".repeat(MAX_LONG_IMAGE_BASE_NAME_CODE_POINTS - 1);
    expect(sanitizeLongImageBaseName(`${prefix}.tail`)).toBe(prefix);
    expect(sanitizeLongImageBaseName(`${prefix} tail`)).toBe(prefix);
  });

  it("plans jpg/png names and pads numbering beyond nine parts", () => {
    expect(planLongImageFileNames({
      baseName: "Summer",
      format: "jpeg",
      partCount: 1,
    })).toEqual(["Summer.jpg"]);
    expect(planLongImageFileNames({
      baseName: "Summer",
      format: "png",
      partCount: 12,
    })).toEqual([
      "Summer-01.png",
      "Summer-02.png",
      "Summer-03.png",
      "Summer-04.png",
      "Summer-05.png",
      "Summer-06.png",
      "Summer-07.png",
      "Summer-08.png",
      "Summer-09.png",
      "Summer-10.png",
      "Summer-11.png",
      "Summer-12.png",
    ]);
  });

  it("builds copied, frozen manifest structures with typed warnings", () => {
    const blocks = [
      block("one", 0, 4_000),
      block("two", 4_000, 9_000),
    ];
    const manifest = buildLongImageExportManifest({
      projectTitle: "Campaign / A",
      preset: "wechat",
      width: 890,
      documentHeight: 9_000,
      blocks,
      allowSplit: true,
    });
    blocks[0] = block("mutated", 0, 4_000);

    expect(manifest).toMatchObject({
      version: 1,
      projectTitle: "Campaign / A",
      baseName: "Campaign - A",
      preset: "wechat",
      format: "jpeg",
      geometry: { outputWidth: 890 },
    });
    expect(manifest.blocks[0]?.blockId).toBe("one");
    expect(manifest.fileNames).toEqual([
      "Campaign - A-01.jpg",
      "Campaign - A-02.jpg",
    ]);
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.blocks)).toBe(true);
    expect(Object.isFrozen(manifest.parts)).toBe(true);
  });

  it.each([
    { baseName: "x", format: "gif", partCount: 1 },
    { baseName: "x", format: "jpeg", partCount: 0 },
    { baseName: "x", format: "png", partCount: 1.5 },
  ])("rejects invalid filename values: $format/$partCount", (input) => {
    expect(() => planLongImageFileNames(
      input as Parameters<typeof planLongImageFileNames>[0],
    )).toThrow(LongImageContractError);
  });
});
