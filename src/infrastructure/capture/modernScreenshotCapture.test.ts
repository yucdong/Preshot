// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createContext, destroyContext } = vi.hoisted(() => ({
  createContext: vi.fn(),
  destroyContext: vi.fn(),
}));

vi.mock("modern-screenshot", () => ({
  createContext,
  destroyContext,
  domToBlob: vi.fn(),
  domToCanvas: vi.fn(),
}));

vi.mock("modern-screenshot/worker?url&no-inline", () => ({
  default: "/assets/modern-screenshot-worker.js",
}));

describe("modernScreenshotCaptureAdapter", () => {
  beforeEach(() => {
    createContext.mockReset();
    destroyContext.mockReset();
    createContext.mockResolvedValue({
      node: document.createElement("section"),
      workers: [],
    });
  });

  it("uses a same-origin worker and rejects hosted capture resources", async () => {
    const { createModernScreenshotCaptureAdapter } = await import(
      "./modernScreenshotCapture"
    );
    const element = document.createElement("section");
    element.getBoundingClientRect = () => ({
      bottom: 100,
      height: 100,
      left: 0,
      right: 100,
      top: 0,
      width: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const session = await createModernScreenshotCaptureAdapter()
      .createSession(element);
    const options = createContext.mock.calls[0]?.[1] as {
      fetchFn(url: string): Promise<false>;
      workerUrl: string;
    };

    expect(options.workerUrl).toBe("/assets/modern-screenshot-worker.js");
    await expect(options.fetchFn(`${window.location.origin}/asset.png`))
      .resolves.toBe(false);
    await expect(options.fetchFn("data:image/png;base64,AA=="))
      .resolves.toBe(false);
    await expect(options.fetchFn("https://example.com/asset.png"))
      .rejects.toThrow("External capture resource is not allowed");

    session.close();
    expect(destroyContext).toHaveBeenCalledOnce();
  });

  it("captures 900x20000 while rejecting excess dimensions or pixel area", async () => {
    const { createModernScreenshotCaptureAdapter } = await import("./modernScreenshotCapture");
    const { domToCanvas } = await import("modern-screenshot");
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 20_000;
    vi.mocked(domToCanvas).mockReset().mockResolvedValue(canvas);
    const session = await createModernScreenshotCaptureAdapter().createSession(document.createElement("section"));
    const capture = (width: number, height: number) => session.capture({
      output: "canvas", format: "image/png",
      viewport: { x: 0, y: 0, width, height, sourceWidth: width, sourceHeight: height },
    });
    try {
      await expect(capture(900, 20_000)).resolves.toMatchObject({ width: 900, height: 20_000 });
      await expect(capture(900, 20_001)).rejects.toThrow("Capture dimensions exceed 20000px");
      await expect(capture(901, 20_000)).rejects.toThrow("Capture exceeds 18000000 pixels");
      expect(domToCanvas).toHaveBeenCalledOnce();
    } finally {
      session.close();
      canvas.width = canvas.height = 0;
    }
  });
});
