// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectPlanV14 } from "../../domain/plan/canvas/blockDocument";
import {
  mountLongImageExportSurface,
  waitForLongImageExportSurface,
} from "./longImageExportSurface";

const plan: ProjectPlanV14 = {
  schemaVersion: 14,
  title: "Mount test",
  document: {
    format: "preshot-blocks",
    version: 2,
    blocks: [{
      id: "paragraph",
      type: "paragraph",
      props: {},
      content: [{ type: "text", text: "离屏长图", styles: {} }],
      children: [],
    }],
  },
  imageGroups: [],
};

const originalFonts = Object.getOwnPropertyDescriptor(document, "fonts");
const originalImageDecode = Object.getOwnPropertyDescriptor(
  HTMLImageElement.prototype,
  "decode",
);

function setFontReadiness(ready: Promise<unknown>): void {
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready },
  });
}

function restoreFonts(): void {
  if (originalFonts) {
    Object.defineProperty(document, "fonts", originalFonts);
  } else {
    Reflect.deleteProperty(document, "fonts");
  }
}

function restoreImageDecode(): void {
  if (originalImageDecode) {
    Object.defineProperty(
      HTMLImageElement.prototype,
      "decode",
      originalImageDecode,
    );
  } else {
    Reflect.deleteProperty(HTMLImageElement.prototype, "decode");
  }
}

function createSurfaceWithImage(
  decode: (() => Promise<void>) | undefined,
): { image: HTMLImageElement; surface: HTMLDivElement } {
  const surface = document.createElement("div");
  const image = document.createElement("img");
  image.src = "file:///C:/Editorial/references/0001.png";
  Object.defineProperty(image, "decode", {
    configurable: true,
    value: decode,
  });
  surface.append(image);
  return { image, surface };
}

function installImmediateFrames(): {
  cancel: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
} {
  let frame = 0;
  const request = vi.fn((callback: FrameRequestCallback) => {
    frame += 1;
    callback(frame);
    return frame;
  });
  const cancel = vi.fn();
  vi.stubGlobal("requestAnimationFrame", request);
  vi.stubGlobal("cancelAnimationFrame", cancel);
  return { cancel, request };
}

afterEach(() => {
  restoreFonts();
  restoreImageDecode();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("waitForLongImageExportSurface", () => {
  it("aborts promptly while image decoding is pending", async () => {
    setFontReadiness(Promise.resolve());
    const decode = vi.fn(() => new Promise<void>(() => undefined));
    const { surface } = createSurfaceWithImage(decode);
    const controller = new AbortController();
    const removeAbortListener = vi.spyOn(
      controller.signal,
      "removeEventListener",
    );
    const clearTimeout = vi.spyOn(window, "clearTimeout");
    const readiness = waitForLongImageExportSurface(
      surface,
      60_000,
      controller.signal,
    );
    await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce());
    clearTimeout.mockClear();
    const rejection = expect(readiness).rejects.toMatchObject({
      name: "AbortError",
    });

    controller.abort(new Error("non-DOM abort reason"));

    await rejection;
    expect(clearTimeout).toHaveBeenCalledOnce();
    expect(removeAbortListener).toHaveBeenCalledOnce();
  });

  it("aborts promptly while fonts are pending", async () => {
    setFontReadiness(new Promise(() => undefined));
    const controller = new AbortController();
    const readiness = waitForLongImageExportSurface(
      document.createElement("div"),
      60_000,
      controller.signal,
    );
    const rejection = expect(readiness).rejects.toMatchObject({
      name: "AbortError",
    });

    controller.abort();

    await rejection;
  });

  it.each([
    {
      expectedContext: "font readiness",
      prepare: () => {
        setFontReadiness(new Promise(() => undefined));
        return document.createElement("div");
      },
    },
    {
      expectedContext: 'image decode for "file:///C:/Editorial/references/0001.png"',
      prepare: () => {
        setFontReadiness(Promise.resolve());
        return createSurfaceWithImage(
          () => new Promise<void>(() => undefined),
        ).surface;
      },
    },
    {
      expectedContext: "stable-height animation frame 1",
      prepare: () => {
        setFontReadiness(Promise.resolve());
        vi.stubGlobal("requestAnimationFrame", vi.fn(() => 42));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());
        return document.createElement("div");
      },
    },
  ])(
    "uses the overall timeout during $expectedContext",
    async ({ expectedContext, prepare }) => {
      vi.useFakeTimers();
      const surface = prepare();
      const readiness = waitForLongImageExportSurface(surface, 25);
      const rejection = expect(readiness).rejects.toThrow(
        `Long-image export surface readiness timed out after 25ms during ${expectedContext}.`,
      );

      await vi.advanceTimersByTimeAsync(25);

      await rejection;
    },
  );

  it("waits for decoded images and two stable-height frames", async () => {
    setFontReadiness(Promise.resolve());
    const decode = vi.fn().mockResolvedValue(undefined);
    const { surface } = createSurfaceWithImage(decode);
    const heights = [100, 120, 120, 120];
    const measure = vi.spyOn(surface, "getBoundingClientRect")
      .mockImplementation(() =>
        new DOMRect(0, 0, 0, heights.shift() ?? 120)
      );
    const { request } = installImmediateFrames();

    await waitForLongImageExportSurface(surface, 1_000);

    expect(decode).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledTimes(3);
    expect(measure).toHaveBeenCalledTimes(4);
  });

  it("keeps decode failures contextual", async () => {
    setFontReadiness(Promise.resolve());
    const decodeFailure = new Error("corrupt image");
    const { surface } = createSurfaceWithImage(
      () => Promise.reject(decodeFailure),
    );

    await expect(
      waitForLongImageExportSurface(surface, 1_000),
    ).rejects.toMatchObject({
      cause: decodeFailure,
      message:
        'Unable to decode local export image "file:///C:/Editorial/references/0001.png".',
    });
  });

  it("cleans pending image listeners when a sibling decode fails", async () => {
    setFontReadiness(Promise.resolve());
    const { image: pendingImage, surface } = createSurfaceWithImage(undefined);
    Object.defineProperty(pendingImage, "complete", {
      configurable: true,
      value: false,
    });
    const removeImageListener = vi.spyOn(
      pendingImage,
      "removeEventListener",
    );
    const rejectingImage = document.createElement("img");
    rejectingImage.src = "file:///C:/Editorial/references/broken.png";
    Object.defineProperty(rejectingImage, "decode", {
      configurable: true,
      value: () => Promise.reject(new Error("broken")),
    });
    surface.append(rejectingImage);

    await expect(
      waitForLongImageExportSurface(surface, 1_000),
    ).rejects.toThrow("Unable to decode local export image");

    expect(removeImageListener).toHaveBeenCalledTimes(2);
  });

  it("cleans the deadline, abort, image, and frame resources on success", async () => {
    setFontReadiness(Promise.resolve());
    const { image, surface } = createSurfaceWithImage(undefined);
    Object.defineProperty(image, "complete", {
      configurable: true,
      value: false,
    });
    const addImageListener = vi.spyOn(image, "addEventListener");
    const removeImageListener = vi.spyOn(image, "removeEventListener");
    const controller = new AbortController();
    const addAbortListener = vi.spyOn(controller.signal, "addEventListener");
    const removeAbortListener = vi.spyOn(
      controller.signal,
      "removeEventListener",
    );
    const clearTimeout = vi.spyOn(window, "clearTimeout");
    const { cancel, request } = installImmediateFrames();
    const readiness = waitForLongImageExportSurface(
      surface,
      1_000,
      controller.signal,
    );
    await vi.waitFor(() =>
      expect(addImageListener).toHaveBeenCalledTimes(2)
    );

    image.dispatchEvent(new Event("load"));
    await readiness;

    expect(addAbortListener).toHaveBeenCalledOnce();
    expect(removeAbortListener).toHaveBeenCalledOnce();
    expect(removeImageListener).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(clearTimeout).toHaveBeenCalledOnce();
  });
});

describe("mountLongImageExportSurface", () => {
  it("mounts offscreen, waits for two stable frames, measures, and destroys", async () => {
    installImmediateFrames();
    const handle = await mountLongImageExportSurface({
      plan,
      resolvedAssets: {},
      outerWidth: 890,
      timeoutMs: 1_000,
    });
    const host = handle.element.parentElement;

    expect(host).toHaveAttribute("data-preshot-long-image-export-host");
    expect(host).toHaveStyle({
      left: "-100000px",
      position: "absolute",
      width: "890px",
    });
    expect(handle.element).toHaveTextContent("离屏长图");
    expect(handle.measurements).toMatchObject({
      outerWidth: 890,
      contentWidth: 830.6666666666666,
      scale: 890 / 1080,
    });
    expect(handle.measurements.topLevelBlocks).toHaveLength(1);

    handle.destroy();
    expect(document.querySelector("[data-preshot-long-image-export-host]"))
      .toBeNull();
  });

  it("unmounts and removes the offscreen surface when readiness is aborted", async () => {
    const mediaPlan: ProjectPlanV14 = {
      ...plan,
      document: {
        ...plan.document,
        blocks: [{
          id: "image",
          type: "image",
          props: {
            caption: "",
            name: "pending.png",
            showPreview: true,
            url: "media/pending.png",
          },
          content: undefined,
          children: [],
        }],
      },
    };
    setFontReadiness(Promise.resolve());
    const decode = vi.fn(() => new Promise<void>(() => undefined));
    Object.defineProperty(HTMLImageElement.prototype, "decode", {
      configurable: true,
      value: decode,
    });
    const controller = new AbortController();
    const mounting = mountLongImageExportSurface({
      plan: mediaPlan,
      resolvedAssets: {
        "media/pending.png": "data:image/png;base64,AA",
      },
      signal: controller.signal,
      timeoutMs: 60_000,
    });
    await vi.waitFor(() => expect(decode).toHaveBeenCalled());
    const rejection = expect(mounting).rejects.toMatchObject({
      name: "AbortError",
    });

    controller.abort();

    await rejection;
    expect(document.querySelector("[data-preshot-long-image-export-host]"))
      .toBeNull();
  });

  it("rejects unresolved assets before creating an offscreen host", async () => {
    const mediaPlan: ProjectPlanV14 = {
      ...plan,
      document: {
        ...plan.document,
        blocks: [{
          id: "image",
          type: "image",
          props: {
            caption: "",
            name: "missing.png",
            showPreview: true,
            url: "media/missing.png",
          },
          content: undefined,
          children: [],
        }],
      },
    };

    await expect(mountLongImageExportSurface({
      plan: mediaPlan,
      resolvedAssets: {},
    })).rejects.toThrow(
      'resolved local asset for "media/missing.png"',
    );
    expect(document.querySelector("[data-preshot-long-image-export-host]"))
      .toBeNull();
  });
});
