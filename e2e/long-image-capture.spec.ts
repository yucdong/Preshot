import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

for (const preset of ["wechat", "lossless-png"] as const) {
  test(`exports pasted native image pixels with ${preset}`, async ({ page }) => {
    const { externalRequests } = trackExternalRequests(page);
    await page.goto("/e2e/fixtures/long-image-native-media.html");
    await page.waitForFunction(() => Boolean(window.exportPastedImages));
    const result = await page.evaluate(value => window.exportPastedImages(value), preset);
    expect(result.partCount).toBe(1);
    expect(result.imageRects).toHaveLength(2);
    expect(result.imageRects[0].width).toBeCloseTo(400, 0);
    expect(result.imageRects[1].width).toBeCloseTo(250, 0);
    for (const rect of result.imageRects) expect(rect.height).toBeCloseTo(rect.width / 2, 0);
    expect(result.imageRects[1].x).toBeGreaterThan(result.imageRects[0].x);
    expect(result.imageRects[1].y).toBeGreaterThan(result.imageRects[0].y + result.imageRects[0].height);
    const expected = [[239, 68, 68, 255], [34, 197, 94, 255], [59, 130, 246, 255]];
    for (const image of result.samples) image.forEach((pixel, index) => {
      pixel.forEach((value, channel) => expect(Math.abs(value - expected[index][channel]))
        .toBeLessThanOrEqual(preset === "lossless-png" ? 0 : 6));
    });
    expect(result.staticLabels).toEqual(["FILE · 拍摄清单.txt"]);
    expect(result.captions[0]).toContain("粘贴图片说明 1");
    expect(result.captions[1]).toContain("粘贴图片说明 2");
    expect(result.unchanged).toBe(true);
    expect(result.remainingSurfaces).toBe(0);
    expect(externalRequests).toEqual([]);
    await writeFile(test.info().outputPath(`pasted-images.${preset === "wechat" ? "jpg" : "png"}`),
      Buffer.from(result.bytes));
  });
}

function trackExternalRequests(page: Page): {
  externalRequests: string[];
  getAppOrigin(): string;
} {
  const externalRequests: string[] = [];
  let appOrigin = "";
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      !appOrigin &&
      request.isNavigationRequest() &&
      request.frame() === page.mainFrame()
    ) {
      appOrigin = url.origin;
    }
    if (
      url.protocol !== "data:" &&
      appOrigin &&
      url.origin !== appOrigin
    ) {
      externalRequests.push(request.url());
    }
  });
  return {
    externalRequests,
    getAppOrigin() {
      if (!appOrigin) throw new Error("Capture fixture origin was not observed");
      return appOrigin;
    },
  };
}

interface CaptureSpikeApi {
  fixtureWidth: number;
  fixtureHeight: number;
  longFixtureHeight: number;
  runStandardCapture(): Promise<{
    dimensions: {
      width: number;
      height: number;
      canvasWidth: number;
      canvasHeight: number;
      pixelRatio: number;
    };
    png: {
      type: string;
      size: number;
      first: number[];
      last: number[];
      base64: string;
    };
    jpeg: {
      type: string;
      size: number;
      first: number[];
      last: number[];
      base64: string;
    };
    probes: Array<{
      box: { x: number; y: number; width: number; height: number };
      expected: number[];
      actual: number[];
    }>;
    geometry: {
      twoColumns: Array<{ x: number; y: number; width: number; height: number }>;
      threeColumns: Array<{ x: number; y: number; width: number; height: number }>;
    };
    chromePixel: number[];
    croppedImageCenter: number[];
    roundedImageCorner: number[];
    headingInkPixels: number;
    fonts: { status: string; regular: boolean; bold: boolean };
    cleanup: {
      activeWorkers: number;
      iframeBaseline: number;
      iframeCount: number;
    };
    workerUrls: string[];
  }>;
  runLongCapture(height?: number): Promise<{
    dimensions: {
      width: number;
      height: number;
      canvasWidth: number;
      canvasHeight: number;
    };
    bottomSentinel: number[];
    segment: { width: number; height: number; bottomSentinel: number[] };
    png: {
      type: string;
      size: number;
      first: number[];
      last: number[];
      base64: string;
    };
    cleanup: {
      activeWorkers: number;
      iframeBaseline: number;
      iframeCount: number;
    };
    boundedPixels: boolean;
  }>;
  runReusedSegmentCapture(): Promise<{
    first: {
      width: number;
      height: number;
      first: number[];
      last: number[];
    };
    second: {
      width: number;
      height: number;
      first: number[];
      last: number[];
    };
    workerCount: number;
    activeWorkersBeforeClose: number;
    cleanup(): {
      activeWorkers: number;
      iframeBaseline: number;
      iframeCount: number;
    };
  }>;
}

declare global {
  interface Window {
    captureSpike: CaptureSpikeApi;
    exportPastedImages(preset: "wechat" | "lossless-png"): Promise<{
      bytes: number[];
      partCount: number;
      imageRects: Array<{ x: number; y: number; width: number; height: number }>;
      staticLabels: string[];
      captions: string[];
      samples: number[][][];
      unchanged: boolean;
      remainingSurfaces: number;
    }>;
  }
}

test("renders the representative offline fixture to exact canvas and Blob output", async ({
  page,
}) => {
  const { externalRequests, getAppOrigin } = trackExternalRequests(page);
  await page.goto("/e2e/fixtures/long-image-capture.html");
  await page.waitForFunction(() => Boolean(window.captureSpike));

  const result = await page.evaluate(() =>
    window.captureSpike.runStandardCapture(),
  );

  expect(result.dimensions).toEqual({
    width: 900,
    height: 1600,
    canvasWidth: 900,
    canvasHeight: 1600,
    pixelRatio: 1,
  });
  expect(result.png.type).toBe("image/png");
  expect(result.png.size).toBeGreaterThan(50_000);
  expect(result.png.first).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(result.jpeg.type).toBe("image/jpeg");
  expect(result.jpeg.size).toBeGreaterThan(50_000);
  expect(result.jpeg.first.slice(0, 3)).toEqual([255, 216, 255]);
  expect(result.jpeg.last).toEqual([255, 217]);
  for (const probe of result.probes) {
    expect(probe.box.width).toBeGreaterThan(100);
    expect(probe.actual.slice(0, 3)).toEqual(probe.expected);
    expect(probe.actual[3]).toBe(255);
  }
  expect(result.geometry.twoColumns).toHaveLength(2);
  expect(result.geometry.twoColumns[0].width).toBeGreaterThan(
    result.geometry.twoColumns[1].width * 1.9,
  );
  expect(result.geometry.threeColumns).toHaveLength(3);
  expect(result.geometry.threeColumns[0].width).toBeCloseTo(
    result.geometry.threeColumns[1].width,
    5,
  );
  expect(result.geometry.threeColumns[1].width).toBeCloseTo(
    result.geometry.threeColumns[2].width,
    5,
  );
  expect(result.chromePixel.slice(0, 3)).toEqual([248, 250, 252]);
  expect(result.croppedImageCenter.slice(0, 3)).toEqual([34, 197, 94]);
  expect(result.roundedImageCorner.slice(0, 3)).not.toEqual([34, 197, 94]);
  expect(result.headingInkPixels).toBeGreaterThan(1_000);
  expect(result.fonts).toEqual({
    status: "loaded",
    regular: true,
    bold: true,
  });
  expect(result.workerUrls.length).toBeGreaterThanOrEqual(3);
  for (const workerUrl of result.workerUrls) {
    expect(new URL(workerUrl, getAppOrigin()).origin).toBe(getAppOrigin());
  }
  expect(result.cleanup).toEqual({
    activeWorkers: 0,
    iframeBaseline: 0,
    iframeCount: 0,
  });
  expect(externalRequests).toEqual([]);

  const reviewArtifactDirectory =
    process.env.PRESHOT_LONG_IMAGE_REVIEW_ARTIFACTS;
  if (reviewArtifactDirectory) {
    const directory = resolve(reviewArtifactDirectory);
    await mkdir(directory, { recursive: true });
    await writeFile(
      resolve(directory, "capture-fidelity-900x1600.png"),
      Buffer.from(result.png.base64, "base64"),
    );
    await writeFile(
      resolve(directory, "capture-fidelity-900x1600.jpg"),
      Buffer.from(result.jpeg.base64, "base64"),
    );
    await writeFile(
      resolve(directory, "capture-fidelity-summary.json"),
      JSON.stringify({
        dimensions: result.dimensions,
        png: {
          type: result.png.type,
          size: result.png.size,
          first: result.png.first,
          last: result.png.last,
        },
        jpeg: {
          type: result.jpeg.type,
          size: result.jpeg.size,
          first: result.jpeg.first,
          last: result.jpeg.last,
        },
        probes: result.probes,
        geometry: result.geometry,
        chromePixel: result.chromePixel,
        croppedImageCenter: result.croppedImageCenter,
        roundedImageCorner: result.roundedImageCorner,
        headingInkPixels: result.headingInkPixels,
        fonts: result.fonts,
        cleanup: result.cleanup,
        workerUrls: result.workerUrls,
        externalRequests,
      }, null, 2),
    );
  }
});

for (const height of [6000, 20_000]) {
test(`captures a ${height}px fixture without truncation and releases its context`, async ({
  page,
}) => {
  const { externalRequests } = trackExternalRequests(page);
  await page.goto("/e2e/fixtures/long-image-capture.html");
  await page.waitForFunction(() => Boolean(window.captureSpike));
  const result = await page.evaluate(value => window.captureSpike.runLongCapture(value), height);

  expect(result.boundedPixels).toBe(true);
  expect(result.dimensions).toEqual({
    width: 900,
    height,
    canvasWidth: 900,
    canvasHeight: height,
  });
  expect(result.bottomSentinel.slice(0, 3)).toEqual([190, 18, 60]);
  expect(result.segment).toEqual({
    width: 900,
    height: 500,
    bottomSentinel: [190, 18, 60, 255],
  });
  expect(result.png.type).toBe("image/png");
  expect(result.png.size).toBeGreaterThan(100_000);
  expect(result.png.first).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(result.cleanup).toEqual({
    activeWorkers: 0,
    iframeBaseline: 0,
    iframeCount: 0,
  });
  expect(externalRequests).toEqual([]);

  const reviewArtifactDirectory =
    process.env.PRESHOT_LONG_IMAGE_REVIEW_ARTIFACTS;
  if (reviewArtifactDirectory) {
    const directory = resolve(reviewArtifactDirectory);
    await mkdir(directory, { recursive: true });
    await writeFile(
      resolve(directory, `capture-${height}.png`),
      Buffer.from(result.png.base64, "base64"),
    );
    await writeFile(
      resolve(directory, `capture-${height}-summary.json`),
      JSON.stringify({
        dimensions: result.dimensions,
        bottomSentinel: result.bottomSentinel,
        segment: result.segment,
        png: {
          type: result.png.type,
          size: result.png.size,
          first: result.png.first,
          last: result.png.last,
        },
        cleanup: result.cleanup,
        boundedPixels: result.boundedPixels,
        externalRequests,
      }, null, 2),
    );
  }
});
}

test("reuses one context for contiguous exact-width segments and then releases it", async ({
  page,
}) => {
  const { externalRequests } = trackExternalRequests(page);
  await page.goto("/e2e/fixtures/long-image-capture.html");
  await page.waitForFunction(() => Boolean(window.captureSpike));
  const result = await page.evaluate(async () => {
    const capture = await window.captureSpike.runReusedSegmentCapture();
    return {
      ...capture,
      cleanup: capture.cleanup(),
    };
  });

  expect(result.first).toEqual({
    width: 900,
    height: 3000,
    first: [23, 32, 51, 255],
    last: [219, 234, 254, 255],
  });
  expect(result.second).toEqual({
    width: 900,
    height: 3000,
    first: [219, 234, 254, 255],
    last: [23, 32, 51, 255],
  });
  expect(result.workerCount).toBe(1);
  expect(result.activeWorkersBeforeClose).toBe(1);
  expect(result.cleanup).toEqual({
    activeWorkers: 0,
    iframeBaseline: 0,
    iframeCount: 0,
  });
  expect(externalRequests).toEqual([]);
});
