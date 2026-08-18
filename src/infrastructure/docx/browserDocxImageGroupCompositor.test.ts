// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { composePreshotDocxImageGroupInBrowser } from "./browserDocxImageGroupCompositor";
import type { PreshotDocxImageGroupCompositeRequest } from "./imageGroupDocxMapping";

const PNG = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 1,
]);

function request(): PreshotDocxImageGroupCompositeRequest {
  const image = (imageId: string, xPoints: number, byte: number) => ({
    imageId,
    assetId: `asset-${imageId}`,
    crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
    xPoints,
    yPoints: 8,
    widthPoints: 30,
    heightPoints: 20,
    backgroundColor: "#E7E8EA",
    borderColor: "#DADBDD",
    borderWidthPoints: 0.75,
    borderRadiusPoints: 3,
    asset: {
      mime: "image/png",
      bytes: Uint8Array.from([byte]),
    },
  });
  return {
    blockId: "block",
    groupId: "group",
    display: {
      widthPoints: 100,
      heightPoints: 50,
      indentPoints: 0,
    },
    raster: {
      width: 400,
      height: 200,
      targetPpi: 300,
      effectivePpi: 288,
      capped: false,
    },
    backgroundColor: "#FFFFFF",
    surface: {
      xPoints: 0,
      yPoints: 5,
      widthPoints: 100,
      heightPoints: 45,
      backgroundColor: "#F7F6F4",
      borderColor: "#DADBDD",
      borderWidthPoints: 0.75,
      borderRadiusPoints: 3,
    },
    images: [
      image("first", 8, 1),
      image("second", 45, 2),
    ],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("browser DOCX image-group compositor", () => {
  it("draws an opaque sRGB composite from local assets in document order", async () => {
    const operations: string[] = [];
    const context = {
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(() => operations.push("fill")),
      fillRect: vi.fn(() => operations.push("opaque-background")),
      save: vi.fn(),
      clip: vi.fn(),
      restore: vi.fn(),
      stroke: vi.fn(),
      drawImage: vi.fn((bitmap: { id: string }) =>
        operations.push(`image-${bitmap.id}`)
      ),
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 0,
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
    };
    const getContext = vi.fn(() => context);
    const canvas = {
      width: 0,
      height: 0,
      getContext,
      toBlob(callback: BlobCallback) {
        callback(new Blob([PNG], { type: "image/png" }));
      },
    };
    vi.spyOn(document, "createElement").mockReturnValue(
      canvas as unknown as HTMLCanvasElement,
    );
    const bitmaps = [
      { id: "first", close: vi.fn() },
      { id: "second", close: vi.fn() },
    ];
    const createImageBitmapMock = vi.fn()
      .mockResolvedValueOnce(bitmaps[0])
      .mockResolvedValueOnce(bitmaps[1]);
    vi.stubGlobal("createImageBitmap", createImageBitmapMock);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const png = await composePreshotDocxImageGroupInBrowser(request());

    expect(png).toEqual(PNG);
    expect(canvas).toMatchObject({ width: 400, height: 200 });
    expect(getContext).toHaveBeenCalledWith("2d", {
      alpha: false,
      colorSpace: "srgb",
    });
    expect(operations[0]).toBe("opaque-background");
    expect(operations.filter((entry) => entry.startsWith("image-"))).toEqual([
      "image-first",
      "image-second",
    ]);
    expect(createImageBitmapMock).toHaveBeenCalledTimes(2);
    expect(bitmaps.every((bitmap) => bitmap.close.mock.calls.length === 1))
      .toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(context.drawImage).toHaveBeenCalledTimes(2);
  });
});
