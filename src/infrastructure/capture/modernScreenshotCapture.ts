import {
  createContext,
  destroyContext,
  domToBlob,
  domToCanvas,
  type Context,
  type Options,
} from "modern-screenshot";
import workerUrl from "modern-screenshot/worker?url&no-inline";
import {
  DOM_CAPTURE_MAX_DIMENSION,
  DOM_CAPTURE_MAX_PIXELS,
  DOM_CAPTURE_PIXEL_RATIO,
  type DomCaptureAdapter,
  type DomCaptureRequest,
  type DomCaptureResult,
  type DomCaptureSession,
  type DomCaptureViewport,
} from "./domCapture";

const EDITOR_CHROME_SELECTOR = [
  '[data-capture-exclude="true"]',
  "[data-editor-chrome]",
  ".bn-side-menu",
  ".bn-formatting-toolbar",
].join(",");

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isExcludedNode(node: Node): boolean {
  return (
    node.nodeType === Node.ELEMENT_NODE &&
    (node as Element).matches(EDITOR_CHROME_SELECTOR)
  );
}

function requireFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a finite positive number`);
  }
}

function validateViewport(viewport: DomCaptureViewport): void {
  requireFinitePositive(viewport.width, "Capture viewport width");
  requireFinitePositive(viewport.height, "Capture viewport height");
  requireFinitePositive(viewport.sourceWidth, "Capture source width");
  requireFinitePositive(viewport.sourceHeight, "Capture source height");
  if (
    viewport.x < 0 ||
    viewport.y < 0 ||
    viewport.x + viewport.width > viewport.sourceWidth ||
    viewport.y + viewport.height > viewport.sourceHeight
  ) {
    throw new Error("Capture viewport must remain inside the source bounds");
  }
}

function viewportOptions(
  viewport: DomCaptureViewport | undefined,
): Pick<Options, "height" | "style" | "width"> {
  if (!viewport) return {};
  validateViewport(viewport);
  return {
    width: viewport.width,
    height: viewport.height,
    style: {
      width: `${viewport.sourceWidth}px`,
      height: `${viewport.sourceHeight}px`,
      transform: `translate(${-viewport.x}px, ${-viewport.y}px)`,
      transformOrigin: "top left",
    },
  };
}

function validateCaptureBounds(width: number, height: number): void {
  requireFinitePositive(width, "Capture width");
  requireFinitePositive(height, "Capture height");
  if (
    width > DOM_CAPTURE_MAX_DIMENSION ||
    height > DOM_CAPTURE_MAX_DIMENSION
  ) {
    throw new Error(
      `Capture dimensions exceed ${DOM_CAPTURE_MAX_DIMENSION}px`,
    );
  }
  if (width * height > DOM_CAPTURE_MAX_PIXELS) {
    throw new Error(`Capture exceeds ${DOM_CAPTURE_MAX_PIXELS} pixels`);
  }
}

function requestedBounds(
  element: HTMLElement,
  request: DomCaptureRequest,
): { width: number; height: number } {
  if (request.viewport) {
    return {
      width: request.viewport.width,
      height: request.viewport.height,
    };
  }
  const rect = element.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}

function disposeContext(context: Context): void {
  for (const worker of context.workers) worker.terminate();
  destroyContext(context);
}

function applyRequest(
  context: Context<HTMLElement>,
  request: DomCaptureRequest,
): void {
  const viewport = viewportOptions(request.viewport);
  context.width = viewport.width ?? context.node.getBoundingClientRect().width;
  context.height =
    viewport.height ?? context.node.getBoundingClientRect().height;
  context.style = viewport.style ?? null;
  context.backgroundColor =
    request.format === "image/jpeg" ? "#ffffff" : null;
  context.quality = request.quality ?? 0.92;
  context.type = request.format;
}

function localOnlyFetch(url: string): Promise<false> {
  if (/^https?:/i.test(url)) {
    const target = new URL(url, window.location.href);
    if (target.origin !== window.location.origin) {
      return Promise.reject(
        new Error(`External capture resource is not allowed: ${target.origin}`),
      );
    }
  }
  return Promise.resolve(false);
}

async function captureWithContext(
  context: Context<HTMLElement>,
  request: DomCaptureRequest,
): Promise<DomCaptureResult> {
  applyRequest(context, request);
  if (request.output === "canvas") {
    const canvas = await domToCanvas(context);
    return {
      output: "canvas",
      canvas,
      width: canvas.width,
      height: canvas.height,
      pixelRatio: DOM_CAPTURE_PIXEL_RATIO,
    };
  }

  const blob = await domToBlob(context);
  return {
    output: "blob",
    blob,
    width: context.width,
    height: context.height,
    pixelRatio: DOM_CAPTURE_PIXEL_RATIO,
  };
}

export function createModernScreenshotCaptureAdapter(): DomCaptureAdapter {
  return {
    async createSession(element): Promise<DomCaptureSession> {
      let context: Context<HTMLElement> | undefined;
      try {
        context = await createContext(element, {
          autoDestruct: false,
          backgroundColor: null,
          filter: (node) => !isExcludedNode(node),
          fetchFn: localOnlyFetch,
          height: 1,
          maximumCanvasSize: DOM_CAPTURE_MAX_DIMENSION,
          quality: 0.92,
          scale: DOM_CAPTURE_PIXEL_RATIO,
          type: "image/png",
          width: 1,
          workerNumber: 1,
          workerUrl,
        });
        let closed = false;
        let capturing = false;
        const retainedContext = context;
        return {
          async capture(request) {
            if (closed) {
              throw new Error("DOM capture session is already closed");
            }
            if (capturing) {
              throw new Error("DOM capture session does not allow concurrent captures");
            }
            const bounds = requestedBounds(element, request);
            validateCaptureBounds(bounds.width, bounds.height);
            capturing = true;
            try {
              return await captureWithContext(retainedContext, request);
            } catch (error) {
              throw new Error(`Unable to capture DOM content: ${detail(error)}`, {
                cause: error,
              });
            } finally {
              capturing = false;
            }
          },
          close() {
            if (closed) return;
            closed = true;
            disposeContext(retainedContext);
          },
        };
      } catch (error) {
        if (context) disposeContext(context);
        throw new Error(`Unable to capture DOM content: ${detail(error)}`, {
          cause: error,
        });
      }
    },
    async capture(element, request) {
      const session = await this.createSession(element);
      try {
        return await session.capture(request);
      } finally {
        session.close();
      }
    },
  };
}

export const modernScreenshotCaptureAdapter =
  createModernScreenshotCaptureAdapter();
