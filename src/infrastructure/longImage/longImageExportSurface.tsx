import { createRoot, type Root } from "react-dom/client";
import type { ProjectPlanV14 } from "../../domain/plan/canvas/blockDocument";
import { LongImageExportSurface } from "../../features/plan/blocknote/export/LongImageExportSurface";
import {
  assertLongImageExportOuterWidth,
  LONG_IMAGE_EXPORT_DEFAULT_OUTER_WIDTH,
  measureLongImageExportSurface,
  type LongImageExportMeasurements,
  type LongImageExportOuterWidth,
  validateLongImageExportAssets,
} from "../../features/plan/blocknote/export/longImageExportModel";

export interface MountLongImageExportSurfaceOptions {
  plan: ProjectPlanV14;
  resolvedAssets: Readonly<Record<string, string>>;
  outerWidth?: LongImageExportOuterWidth;
  theme?: "light" | "dark";
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface LongImageExportSurfaceHandle {
  element: HTMLElement;
  measurements: LongImageExportMeasurements;
  destroy(): void;
}

function abortError(): DOMException {
  return new DOMException("Long-image export was cancelled.", "AbortError");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

interface ReadinessDeadline {
  wait<T>(operation: PromiseLike<T>, context: string): Promise<T>;
  trackCleanup(cleanup: () => void): () => void;
  finish(): void;
}

function createReadinessDeadline(
  timeoutMs: number,
  signal?: AbortSignal,
): ReadinessDeadline {
  throwIfAborted(signal);
  let resolveTimeout!: () => void;
  let resolveAbort!: () => void;
  const timeout = new Promise<void>((resolve) => {
    resolveTimeout = resolve;
  });
  const aborted = new Promise<void>((resolve) => {
    resolveAbort = resolve;
  });
  const cleanups = new Set<() => void>();
  const onAbort = () => resolveAbort();
  const timer = window.setTimeout(resolveTimeout, timeoutMs);
  signal?.addEventListener("abort", onAbort, { once: true });
  let finished = false;

  const runCleanup = (cleanup: () => void) => {
    if (!cleanups.delete(cleanup)) return;
    cleanup();
  };

  return {
    wait<T>(operation: PromiseLike<T>, context: string): Promise<T> {
      throwIfAborted(signal);
      return Promise.race([
        Promise.resolve(operation),
        timeout.then<never>(() => {
          throw new Error(
            `Long-image export surface readiness timed out after ${timeoutMs}ms during ${context}.`,
          );
        }),
        aborted.then<never>(() => {
          throw abortError();
        }),
      ]);
    },
    trackCleanup(cleanup: () => void): () => void {
      if (finished) {
        cleanup();
        return () => undefined;
      }
      cleanups.add(cleanup);
      return () => runCleanup(cleanup);
    },
    finish(): void {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      for (const cleanup of [...cleanups]) runCleanup(cleanup);
    },
  };
}

async function nextFrame(
  deadline: ReadinessDeadline,
  context: string,
): Promise<void> {
  let frame: number | undefined;
  let timer: number | undefined;
  const operation = new Promise<void>((resolve) => {
    const finish = () => resolve();
    if (typeof window.requestAnimationFrame === "function") {
      frame = window.requestAnimationFrame(finish);
    } else {
      timer = window.setTimeout(finish, 0);
    }
  });
  const releaseCleanup = deadline.trackCleanup(() => {
    if (frame !== undefined) window.cancelAnimationFrame(frame);
    if (timer !== undefined) window.clearTimeout(timer);
  });
  try {
    await deadline.wait(operation, context);
  } finally {
    releaseCleanup();
  }
}

async function waitForImage(
  image: HTMLImageElement,
  deadline: ReadinessDeadline,
): Promise<void> {
  const source = image.currentSrc || image.src || "unknown";
  if (typeof image.decode === "function") {
    const decoding = Promise.resolve()
      .then(() => image.decode())
      .catch((error: unknown) => {
        throw new Error(
          `Unable to decode local export image "${source}".`,
          { cause: error },
        );
      });
    await deadline.wait(decoding, `image decode for "${source}"`);
    return;
  }
  if (image.complete) return;

  let resolveLoad!: () => void;
  let rejectLoad!: (error: Error) => void;
  const loaded = new Promise<void>((resolve, reject) => {
    resolveLoad = resolve;
    rejectLoad = reject;
  });
  const onLoad = () => resolveLoad();
  const onError = () => {
    rejectLoad(new Error(`Unable to load local export image "${source}".`));
  };
  const releaseCleanup = deadline.trackCleanup(() => {
    image.removeEventListener("load", onLoad);
    image.removeEventListener("error", onError);
  });
  try {
    image.addEventListener("load", onLoad, { once: true });
    image.addEventListener("error", onError, { once: true });
    await deadline.wait(loaded, `image load for "${source}"`);
  } finally {
    releaseCleanup();
  }
}

export async function waitForLongImageExportSurface(
  surface: HTMLElement,
  timeoutMs = 10_000,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = createReadinessDeadline(timeoutMs, signal);
  try {
    const fonts = surface.ownerDocument.fonts;
    if (fonts) {
      const ready = Promise.resolve(fonts.ready).catch((error: unknown) => {
        throw new Error(
          "Unable to prepare fonts for the long-image export surface.",
          { cause: error },
        );
      });
      await deadline.wait(ready, "font readiness");
    }
    await Promise.all(
      Array.from(surface.querySelectorAll("img")).map((image) =>
        waitForImage(image, deadline)
      ),
    );

    let previousHeight = surface.getBoundingClientRect().height;
    let stableFrames = 0;
    let frameNumber = 0;
    while (stableFrames < 2) {
      frameNumber += 1;
      await nextFrame(
        deadline,
        `stable-height animation frame ${frameNumber}`,
      );
      const height = surface.getBoundingClientRect().height;
      stableFrames = Math.abs(height - previousHeight) <= 0.01
        ? stableFrames + 1
        : 0;
      previousHeight = height;
    }
  } finally {
    deadline.finish();
  }
}

function createOffscreenHost(outerWidth: number): HTMLDivElement {
  const host = document.createElement("div");
  host.dataset.preshotLongImageExportHost = "";
  host.style.position = "absolute";
  host.style.left = "-100000px";
  host.style.top = "0";
  host.style.width = `${outerWidth}px`;
  host.style.pointerEvents = "none";
  host.style.overflow = "visible";
  document.body.append(host);
  return host;
}

function cleanup(root: Root, host: HTMLElement): void {
  root.unmount();
  if (host.isConnected) host.remove();
}

function waitForMountedSurface(
  mounted: Promise<HTMLElement>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<HTMLElement> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    let settled = false;
    const cleanupWait = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanupWait();
      reject(abortError());
    };
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanupWait();
      reject(new Error(
        `Long-image export surface did not mount within ${timeoutMs}ms.`,
      ));
    }, timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    void mounted.then(
      (surface) => {
        if (settled) return;
        settled = true;
        cleanupWait();
        resolve(surface);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanupWait();
        reject(error);
      },
    );
  });
}

export async function mountLongImageExportSurface({
  plan,
  resolvedAssets,
  outerWidth = LONG_IMAGE_EXPORT_DEFAULT_OUTER_WIDTH,
  theme,
  timeoutMs = 10_000,
  signal,
}: MountLongImageExportSurfaceOptions): Promise<LongImageExportSurfaceHandle> {
  throwIfAborted(signal);
  assertLongImageExportOuterWidth(outerWidth);
  validateLongImageExportAssets(plan, resolvedAssets);
  const host = createOffscreenHost(outerWidth);
  const root = createRoot(host);
  let resolveSurface!: (surface: HTMLElement) => void;
  const mounted = new Promise<HTMLElement>((resolve) => {
    resolveSurface = resolve;
  });

  root.render(
    <LongImageExportSurface
      onSurfaceReady={resolveSurface}
      outerWidth={outerWidth}
      plan={plan}
      resolvedAssets={resolvedAssets}
      theme={theme}
    />,
  );

  try {
    const element = await waitForMountedSurface(mounted, timeoutMs, signal);
    await waitForLongImageExportSurface(element, timeoutMs, signal);
    throwIfAborted(signal);
    let destroyed = false;
    return {
      element,
      measurements: measureLongImageExportSurface(element),
      destroy: () => {
        if (destroyed) return;
        destroyed = true;
        cleanup(root, host);
      },
    };
  } catch (error) {
    cleanup(root, host);
    throw error;
  }
}
