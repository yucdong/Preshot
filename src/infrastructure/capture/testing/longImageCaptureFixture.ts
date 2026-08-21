import notoSansBoldUrl from "../../pdf/fonts/NotoSansSC-Bold.ttf?url";
import notoSansRegularUrl from "../../pdf/fonts/NotoSansSC-Regular.ttf?url";
import {
  DOM_CAPTURE_MAX_PIXELS,
  type DomCaptureCanvasResult,
  type DomCaptureBlobResult,
} from "../domCapture";
import { modernScreenshotCaptureAdapter } from "../modernScreenshotCapture";

const FIXTURE_WIDTH = 900;
const FIXTURE_HEIGHT = 1600;
const LONG_FIXTURE_HEIGHT = 6000;
const imageDataUrl =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200">' +
      '<rect width="200" height="200" fill="#ef4444"/>' +
      '<rect x="200" width="200" height="200" fill="#22c55e"/>' +
      '<rect x="400" width="200" height="200" fill="#3b82f6"/>' +
      "</svg>",
  );

const style = document.createElement("style");
style.textContent = `
  @font-face {
    font-family: "Preshot Capture Noto Sans SC";
    font-style: normal;
    font-weight: 400;
    src: url("${notoSansRegularUrl}") format("truetype");
  }
  @font-face {
    font-family: "Preshot Capture Noto Sans SC";
    font-style: normal;
    font-weight: 700;
    src: url("${notoSansBoldUrl}") format("truetype");
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; background: #cbd5e1; }
  .capture-fixture {
    position: absolute;
    left: -10000px;
    top: 0;
    width: ${FIXTURE_WIDTH}px;
    height: ${FIXTURE_HEIGHT}px;
    overflow: hidden;
    color: #172033;
    background: #f8fafc;
    border: 4px solid #172033;
    font-family: "Preshot Capture Noto Sans SC", sans-serif;
  }
  .fixture-heading { position: absolute; left: 48px; top: 42px; width: 804px; }
  .fixture-heading h1 { margin: 0; font-size: 40px; line-height: 1.25; font-weight: 700; }
  .fixture-heading h2 { margin: 12px 0 0; font-size: 24px; color: #475569; }
  .fixture-list { position: absolute; left: 48px; top: 178px; width: 360px; font-size: 20px; }
  .fixture-list p { margin: 8px 0; }
  .marker { display: inline-block; width: 30px; color: #be123c; font-weight: 700; }
  .fixture-table { position: absolute; left: 448px; top: 178px; width: 404px; border-collapse: collapse; }
  .fixture-table th, .fixture-table td { height: 54px; border: 3px solid #334155; padding: 8px 12px; }
  .fixture-table th { background: #dbeafe; }
  .fixture-table td[data-probe] { background: #fef08a; }
  .column-section { position: absolute; left: 48px; width: 804px; display: grid; gap: 18px; }
  .two-columns { top: 390px; grid-template-columns: 2fr 1fr; }
  .three-columns { top: 590px; grid-template-columns: 1fr 1fr 1fr; }
  .column-card { height: 154px; padding: 22px; border: 3px solid #475569; border-radius: 16px; font-size: 20px; }
  .two-columns .column-card:first-child { background: #e0f2fe; }
  .two-columns .column-card:last-child { background: #fce7f3; }
  .three-columns .column-card:nth-child(1) { background: #dcfce7; }
  .three-columns .column-card:nth-child(2) { background: #ede9fe; }
  .three-columns .column-card:nth-child(3) { background: #ffedd5; }
  .image-group {
    position: absolute;
    left: 48px;
    top: 796px;
    width: 804px;
    height: 330px;
    padding: 26px;
    background: #f1f5f9;
    border: 4px solid #0f766e;
    border-radius: 28px;
  }
  .image-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 18px; }
  .image-tile { height: 190px; overflow: hidden; border: 4px solid #ffffff; border-radius: 24px; box-shadow: 0 4px 14px rgb(15 23 42 / 20%); }
  .image-tile img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: center; }
  .image-caption { margin: 18px 0 0; text-align: center; font-size: 21px; font-weight: 700; }
  .background-panel {
    position: absolute;
    left: 48px;
    top: 1170px;
    width: 804px;
    height: 330px;
    padding: 34px;
    color: #ffffff;
    background: linear-gradient(135deg, #0f766e 0%, #155e75 100%);
    border: 6px solid #67e8f9;
    border-radius: 22px;
    font-size: 24px;
  }
  .editor-chrome {
    position: absolute;
    left: 10px;
    top: 10px;
    width: 140px;
    height: 36px;
    background: #ff00ff;
  }
  .long-fixture {
    position: absolute;
    left: -12000px;
    top: 0;
    width: ${FIXTURE_WIDTH}px;
    height: ${LONG_FIXTURE_HEIGHT}px;
    background: repeating-linear-gradient(
      to bottom,
      #f8fafc 0,
      #f8fafc 499px,
      #dbeafe 500px,
      #dbeafe 999px
    );
    border: 4px solid #172033;
    font-family: "Preshot Capture Noto Sans SC", sans-serif;
  }
  .long-fixture::after {
    content: "";
    position: absolute;
    left: 100px;
    bottom: 20px;
    width: 700px;
    height: 40px;
    background: #be123c;
  }
`;
document.head.append(style);

function createStandardFixture(): HTMLElement {
  const fixture = document.createElement("main");
  fixture.className = "capture-fixture";
  fixture.innerHTML = `
    <div class="editor-chrome" data-capture-exclude="true"></div>
    <header class="fixture-heading" data-text-probe>
      <h1>拍摄计划：城市晨光</h1>
      <h2>标题、正文与本地字体离线渲染</h2>
    </header>
    <section class="fixture-list">
      <p><span class="marker">•</span>第一项：准备相机与镜头</p>
      <p><span class="marker">•</span>第二项：检查现场光线</p>
      <p><span class="marker">1.</span>建立主机位</p>
      <p><span class="marker">2.</span>记录备用构图</p>
    </section>
    <table class="fixture-table">
      <thead><tr><th>镜头</th><th>时间</th></tr></thead>
      <tbody>
        <tr><td data-probe data-color="254,240,138">广角全景</td><td>06:20</td></tr>
        <tr><td>人物近景</td><td>06:45</td></tr>
      </tbody>
    </table>
    <section class="column-section two-columns" data-columns="2">
      <article class="column-card" data-probe data-color="224,242,254">双栏主内容</article>
      <article class="column-card" data-probe data-color="252,231,243">双栏备注</article>
    </section>
    <section class="column-section three-columns" data-columns="3">
      <article class="column-card" data-probe data-color="220,252,231">三栏一</article>
      <article class="column-card" data-probe data-color="237,233,254">三栏二</article>
      <article class="column-card" data-probe data-color="255,237,213">三栏三</article>
    </section>
    <section class="image-group">
      <div class="image-row">
        <div class="image-tile"><img alt="裁切图一" src="${imageDataUrl}"></div>
        <div class="image-tile"><img alt="裁切图二" src="${imageDataUrl}"></div>
        <div class="image-tile"><img alt="裁切图三" src="${imageDataUrl}"></div>
      </div>
      <p class="image-caption">圆角裁切的图片组布局</p>
    </section>
    <section class="background-panel">
      深色背景、边框与圆角必须保留。画面中不得出现编辑器工具栏。
    </section>
  `;
  document.body.append(fixture);
  return fixture;
}

const trackedWorkers = new Set<Worker>();
const workerUrls: string[] = [];
const NativeWorker = window.Worker;
window.Worker = new Proxy(NativeWorker, {
  construct(Target, argumentsList) {
    const worker = new Target(...argumentsList as ConstructorParameters<typeof Worker>);
    workerUrls.push(String(argumentsList[0]));
    trackedWorkers.add(worker);
    const terminate = worker.terminate.bind(worker);
    worker.terminate = () => {
      trackedWorkers.delete(worker);
      terminate();
    };
    return worker;
  },
});

const fixture = createStandardFixture();
await Promise.all([
  document.fonts.load('400 24px "Preshot Capture Noto Sans SC"', "城市晨光"),
  document.fonts.load('700 40px "Preshot Capture Noto Sans SC"', "拍摄计划"),
  ...Array.from(fixture.querySelectorAll("img")).map((image) => image.decode()),
]);
await document.fonts.ready;

function requireCanvas(
  result: Awaited<ReturnType<typeof modernScreenshotCaptureAdapter.capture>>,
): asserts result is DomCaptureCanvasResult {
  if (result.output !== "canvas") throw new Error("Expected canvas output");
}

function requireBlob(
  result: Awaited<ReturnType<typeof modernScreenshotCaptureAdapter.capture>>,
): asserts result is DomCaptureBlobResult {
  if (result.output !== "blob") throw new Error("Expected Blob output");
}

function bytesSignature(bytes: Uint8Array): number[] {
  return [...bytes.slice(0, 8)];
}

async function blobDetails(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return {
    type: blob.type,
    size: blob.size,
    first: bytesSignature(bytes),
    last: [...bytes.slice(-2)],
    base64: btoa(binary),
  };
}

function relativeBox(element: Element, root: Element) {
  const box = element.getBoundingClientRect();
  const rootBox = root.getBoundingClientRect();
  return {
    x: box.x - rootBox.x,
    y: box.y - rootBox.y,
    width: box.width,
    height: box.height,
  };
}

function samplePixel(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
): number[] {
  return [...context.getImageData(Math.floor(x), Math.floor(y), 1, 1).data];
}

async function runStandardCapture() {
  const iframeBaseline = document.querySelectorAll("iframe").length;
  const canvasResult = await modernScreenshotCaptureAdapter.capture(fixture, {
    output: "canvas",
    format: "image/png",
  });
  requireCanvas(canvasResult);
  const context = canvasResult.canvas.getContext("2d", {
    willReadFrequently: true,
  });
  if (!context) throw new Error("Expected a 2D canvas context");

  const probes = Array.from(fixture.querySelectorAll<HTMLElement>("[data-probe]"))
    .map((element) => {
      const box = relativeBox(element, fixture);
      return {
        box,
        expected: element.dataset.color?.split(",").map(Number) ?? [],
        actual: samplePixel(
          context,
          box.x + box.width / 2,
          box.y + box.height / 2,
        ),
      };
    });
  const heading = relativeBox(
    fixture.querySelector("[data-text-probe]")!,
    fixture,
  );
  const headingPixels = context.getImageData(
    Math.floor(heading.x),
    Math.floor(heading.y),
    Math.floor(heading.width),
    Math.floor(heading.height),
  ).data;
  let headingInkPixels = 0;
  for (let index = 0; index < headingPixels.length; index += 4) {
    if (
      headingPixels[index] < 100 &&
      headingPixels[index + 1] < 120 &&
      headingPixels[index + 2] < 140 &&
      headingPixels[index + 3] > 0
    ) {
      headingInkPixels += 1;
    }
  }

  const pngResult = await modernScreenshotCaptureAdapter.capture(fixture, {
    output: "blob",
    format: "image/png",
  });
  requireBlob(pngResult);
  const jpegResult = await modernScreenshotCaptureAdapter.capture(fixture, {
    output: "blob",
    format: "image/jpeg",
    quality: 0.9,
  });
  requireBlob(jpegResult);

  const twoColumns = Array.from(
    fixture.querySelector("[data-columns='2']")!.children,
  ).map((element) => relativeBox(element, fixture));
  const threeColumns = Array.from(
    fixture.querySelector("[data-columns='3']")!.children,
  ).map((element) => relativeBox(element, fixture));
  const firstTile = relativeBox(fixture.querySelector(".image-tile")!, fixture);

  return {
    dimensions: {
      width: canvasResult.width,
      height: canvasResult.height,
      canvasWidth: canvasResult.canvas.width,
      canvasHeight: canvasResult.canvas.height,
      pixelRatio: canvasResult.pixelRatio,
    },
    png: await blobDetails(pngResult.blob),
    jpeg: await blobDetails(jpegResult.blob),
    probes,
    geometry: { twoColumns, threeColumns },
    chromePixel: samplePixel(context, 20, 20),
    croppedImageCenter: samplePixel(
      context,
      firstTile.x + firstTile.width / 2,
      firstTile.y + firstTile.height / 2,
    ),
    roundedImageCorner: samplePixel(
      context,
      firstTile.x + 2,
      firstTile.y + 2,
    ),
    headingInkPixels,
    fonts: {
      status: document.fonts.status,
      regular: document.fonts.check(
        '400 24px "Preshot Capture Noto Sans SC"',
        "城市晨光",
      ),
      bold: document.fonts.check(
        '700 40px "Preshot Capture Noto Sans SC"',
        "拍摄计划",
      ),
    },
    cleanup: {
      activeWorkers: trackedWorkers.size,
      iframeBaseline,
      iframeCount: document.querySelectorAll("iframe").length,
    },
    workerUrls,
  };
}

async function runLongCapture() {
  const longFixture = document.createElement("section");
  longFixture.className = "long-fixture";
  longFixture.innerHTML = "<h1>六千像素长图离线捕获</h1>";
  document.body.append(longFixture);
  const iframeBaseline = document.querySelectorAll("iframe").length;
  try {
    const result = await modernScreenshotCaptureAdapter.capture(longFixture, {
      output: "canvas",
      format: "image/png",
    });
    requireCanvas(result);
    const context = result.canvas.getContext("2d");
    if (!context) throw new Error("Expected a 2D canvas context");
    const blob = await new Promise<Blob>((resolve, reject) => {
      result.canvas.toBlob((value) => {
        if (value) resolve(value);
        else reject(new Error("Unable to encode long capture"));
      }, "image/png");
    });
    const segment = await modernScreenshotCaptureAdapter.capture(longFixture, {
      output: "canvas",
      format: "image/png",
      viewport: {
        x: 0,
        y: 5500,
        width: FIXTURE_WIDTH,
        height: 500,
        sourceWidth: FIXTURE_WIDTH,
        sourceHeight: LONG_FIXTURE_HEIGHT,
      },
    });
    requireCanvas(segment);
    const segmentContext = segment.canvas.getContext("2d");
    if (!segmentContext) throw new Error("Expected a segmented 2D context");
    return {
      dimensions: {
        width: result.width,
        height: result.height,
        canvasWidth: result.canvas.width,
        canvasHeight: result.canvas.height,
      },
      bottomSentinel: samplePixel(context, 450, LONG_FIXTURE_HEIGHT - 40),
      segment: {
        width: segment.width,
        height: segment.height,
        bottomSentinel: samplePixel(segmentContext, 450, 460),
      },
      png: await blobDetails(blob),
      cleanup: {
        activeWorkers: trackedWorkers.size,
        iframeBaseline,
        iframeCount: document.querySelectorAll("iframe").length,
      },
      boundedPixels: FIXTURE_WIDTH * LONG_FIXTURE_HEIGHT < DOM_CAPTURE_MAX_PIXELS,
    };
  } finally {
    longFixture.remove();
  }
}

async function runReusedSegmentCapture() {
  const longFixture = document.createElement("section");
  longFixture.className = "long-fixture";
  document.body.append(longFixture);
  const iframeBaseline = document.querySelectorAll("iframe").length;
  const workerBaseline = workerUrls.length;
  const session = await modernScreenshotCaptureAdapter.createSession(
    longFixture,
  );
  const canvases: HTMLCanvasElement[] = [];
  try {
    const capture = async (y: number) => {
      const result = await session.capture({
        output: "canvas",
        format: "image/png",
        viewport: {
          x: 0,
          y,
          width: FIXTURE_WIDTH,
          height: 3000,
          sourceWidth: FIXTURE_WIDTH,
          sourceHeight: LONG_FIXTURE_HEIGHT,
        },
      });
      requireCanvas(result);
      canvases.push(result.canvas);
      const context = result.canvas.getContext("2d");
      if (!context) throw new Error("Expected a segmented 2D context");
      return {
        width: result.width,
        height: result.height,
        first: samplePixel(context, 450, 0),
        last: samplePixel(context, 450, result.height - 1),
      };
    };
    const first = await capture(0);
    const second = await capture(3000);
    return {
      first,
      second,
      workerCount: workerUrls.length - workerBaseline,
      activeWorkersBeforeClose: trackedWorkers.size,
      cleanup: () => ({
        activeWorkers: trackedWorkers.size,
        iframeBaseline,
        iframeCount: document.querySelectorAll("iframe").length,
      }),
    };
  } finally {
    canvases.forEach((canvas) => {
      canvas.width = 0;
      canvas.height = 0;
    });
    session.close();
    longFixture.remove();
  }
}

Object.assign(window, {
  captureSpike: {
    fixtureWidth: FIXTURE_WIDTH,
    fixtureHeight: FIXTURE_HEIGHT,
    longFixtureHeight: LONG_FIXTURE_HEIGHT,
    runLongCapture,
    runReusedSegmentCapture,
    runStandardCapture,
  },
});
