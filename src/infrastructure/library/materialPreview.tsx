import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { MaterialDetail, MaterialPreviewInput } from "../../domain/library/models";
import type { MaterialLibraryRepository } from "../../domain/library/ports";
import type { DomCaptureSession } from "../capture/domCapture";
import { modernScreenshotCaptureAdapter } from "../capture/modernScreenshotCapture";
import {
  mountLongImageExportSurface,
  type LongImageExportSurfaceHandle,
} from "../longImage/longImageExportSurface";
import {
  assertPreviewActive,
  prepareMaterialPreview,
  previewAbortable,
  type PreparedMaterialPreview,
} from "./materialPreviewAssets";

const SURFACE_WIDTH = 900;
const MAX_CAPTURE_HEIGHT = 8192;
const MAX_CAPTURE_PIXELS = 8_000_000;
const MAX_THUMBNAIL_WIDTH = 480;
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const PREVIEW_TIMEOUT_MS = 60_000;
const RENDER_KEY = "preshot-material-preview:v3:plan15:bn0.53:light:900:480:8192:8M:png";
const PARTIAL_LABEL = "局部缩略图 · 完整内容请打开预览";
const hiddenText: CSSProperties = {
  position: "absolute", width: 1, height: 1, padding: 0, margin: -1,
  overflow: "hidden", clipPath: "inset(50%)", whiteSpace: "pre-wrap",
};

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function previewDeadline(): { controller: AbortController; clear(): void } {
  const controller = new AbortController();
  const timer = window.setTimeout(() => {
    controller.abort(new Error("素材预览生成超时，请重试或减小素材尺寸。"));
  }, PREVIEW_TIMEOUT_MS);
  return { controller, clear: () => window.clearTimeout(timer) };
}

function releaseCanvas(canvas: HTMLCanvasElement | undefined): void {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

function applyPreviewPresentation(element: HTMLElement): void {
  element.style.setProperty("--app-panel", "var(--paper-subtle)");
  element.style.setProperty("--app-border", "var(--paper-border)");
  element.style.colorScheme = "light";
  element.setAttribute("data-preshot-material-preview-surface", "");
  const style = element.ownerDocument.createElement("style");
  // BlockNote applies node-selection outlines to children, not the selected wrapper.
  style.textContent = `
    [data-preshot-material-preview-surface] .bn-block-content.ProseMirror-selectednode > *,
    [data-preshot-material-preview-surface] .ProseMirror-selectednode > .bn-block-content > * {
      outline: none !important;
    }
  `;
  element.append(style);
}

function encodePng(canvas: HTMLCanvasElement, signal: AbortSignal): Promise<Blob> {
  return previewAbortable(new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob || blob.type !== "image/png") {
        reject(new Error("无法编码 PNG 素材缩略图，请重试。"));
      } else {
        resolve(blob);
      }
    }, "image/png");
  }), signal);
}

async function thumbnail(
  source: HTMLCanvasElement,
  isPartial: boolean,
  signal: AbortSignal,
): Promise<MaterialPreviewInput> {
  const canvas = document.createElement("canvas");
  try {
    let width = Math.min(MAX_THUMBNAIL_WIDTH, source.width);
    for (;;) {
      assertPreviewActive(signal);
      const imageHeight = Math.max(1, Math.round(source.height * width / source.width));
      const labelHeight = isPartial ? 28 : 0;
      canvas.width = width;
      canvas.height = imageHeight + labelHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("无法创建素材缩略图画布。");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(source, 0, 0, width, imageHeight);
      if (isPartial) {
        context.fillStyle = "#111827";
        context.font = "12px sans-serif";
        context.textBaseline = "middle";
        context.fillText(PARTIAL_LABEL, 8, imageHeight + labelHeight / 2);
      }
      const blob = await encodePng(canvas, signal);
      if (blob.size <= MAX_THUMBNAIL_BYTES) {
        const bytes = new Uint8Array(await previewAbortable(blob.arrayBuffer(), signal));
        assertPreviewActive(signal);
        return {
          bytes: Array.from(bytes), width, height: canvas.height,
          renderKey: RENDER_KEY, isPartial,
        };
      }
      if (width <= 240) {
        throw new Error("素材 PNG 缩略图超过 2 MiB，请减少素材尺寸后重试。");
      }
      width = Math.max(240, Math.floor(width * 0.8));
    }
  } finally {
    releaseCanvas(canvas);
  }
}

async function persistPreview(
  repository: MaterialLibraryRepository,
  material: MaterialDetail,
): Promise<void> {
  const deadline = previewDeadline();
  const signal = deadline.controller.signal;
  let prepared: PreparedMaterialPreview | undefined;
  let surface: LongImageExportSurfaceHandle | undefined;
  let session: DomCaptureSession | undefined;
  let canvas: HTMLCanvasElement | undefined;
  const disposeSurface = () => {
    surface?.destroy();
    surface = undefined;
    prepared?.dispose();
    prepared = undefined;
  };
  const abort = () => {
    session?.close();
    disposeSurface();
    releaseCanvas(canvas);
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    prepared = await prepareMaterialPreview(repository, material, signal);
    surface = await mountLongImageExportSurface({
      plan: prepared.plan, resolvedAssets: prepared.resolvedAssets,
      outerWidth: SURFACE_WIDTH, theme: "light", signal,
      includeImageGroupMetadata: true,
    });
    assertPreviewActive(signal);
    applyPreviewPresentation(surface.element);
    const measuredHeight = Math.ceil(surface.measurements.height);
    if (
      !Number.isSafeInteger(measuredHeight) || measuredHeight <= 0 ||
      surface.measurements.outerWidth !== SURFACE_WIDTH
    ) {
      throw new Error("素材组件布局尺寸无效，无法生成缩略图。");
    }
    const height = Math.min(
      measuredHeight, MAX_CAPTURE_HEIGHT, Math.floor(MAX_CAPTURE_PIXELS / SURFACE_WIDTH),
    );
    const isPartial = measuredHeight > height;
    // Clip only this disposable capture surface. The live preview has no height truncation.
    surface.element.style.height = `${height}px`;
    surface.element.style.maxHeight = `${height}px`;
    surface.element.style.overflow = "hidden";
    const opening = modernScreenshotCaptureAdapter.createSession(surface.element);
    void opening.then((opened) => {
      if (signal.aborted) opened.close();
    }, () => undefined);
    session = await previewAbortable(opening, signal);
    assertPreviewActive(signal);
    const capturing = session.capture({
      output: "canvas", format: "image/png",
      viewport: {
        x: 0, y: 0, width: SURFACE_WIDTH, height,
        sourceWidth: SURFACE_WIDTH, sourceHeight: height,
      },
    });
    void capturing.then((result) => {
      if (signal.aborted && result.output === "canvas") releaseCanvas(result.canvas);
    }, () => undefined);
    const result = await previewAbortable(capturing, signal);
    if (result.output !== "canvas") throw new Error("素材截图未返回可缩放画布。");
    canvas = result.canvas;
    assertPreviewActive(signal);
    if (
      canvas.width !== SURFACE_WIDTH || canvas.height !== height ||
      canvas.width * canvas.height > MAX_CAPTURE_PIXELS
    ) {
      throw new Error("素材截图尺寸超出安全边界。");
    }
    const preview = await thumbnail(canvas, isPartial, signal);
    assertPreviewActive(signal);
    deadline.clear();
    await repository.savePreview(material.id, material.revision, preview);
  } catch (error) {
    try {
      await repository.markPreviewFailed(material.id, material.revision);
    } catch (persistenceError) {
      throw new Error(
        `素材预览失败：${detail(error)}；无法记录预览失败状态：${detail(persistenceError)}`,
        { cause: error },
      );
    }
    throw new Error(`素材预览失败：${detail(error)}`, { cause: error });
  } finally {
    deadline.clear();
    signal.removeEventListener("abort", abort);
    session?.close();
    releaseCanvas(canvas);
    disposeSurface();
  }
}

const activePreviews = new WeakMap<MaterialLibraryRepository, Map<string, Promise<void>>>();

// This module intentionally exposes the preview component together with its cache command.
// eslint-disable-next-line react-refresh/only-export-components
export function createMaterialPreview(
  repository: MaterialLibraryRepository,
  material: MaterialDetail,
): Promise<void> {
  let pending = activePreviews.get(repository);
  if (!pending) {
    pending = new Map();
    activePreviews.set(repository, pending);
  }
  const key = JSON.stringify([material.id, material.revision]);
  const existing = pending.get(key);
  if (existing) return existing;
  const operation = persistPreview(repository, material).finally(() => pending.delete(key));
  pending.set(key, operation);
  return operation;
}

interface PreviewProps {
  repository: MaterialLibraryRepository;
  material: MaterialDetail;
}

function LiveMaterialPreview({ repository, material }: PreviewProps): ReactNode {
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<
    { status: "loading" } | { status: "ready"; text: string } | { status: "error"; message: string }
  >({ status: "loading" });

  useEffect(() => {
    const viewport = container.current;
    if (!viewport) return;
    const deadline = previewDeadline();
    const signal = deadline.controller.signal;
    let mounted = true;
    let prepared: PreparedMaterialPreview | undefined;
    let surface: LongImageExportSurfaceHandle | undefined;
    let observer: ResizeObserver | undefined;
    const dispose = () => {
      observer?.disconnect();
      observer = undefined;
      const retainedSurface = surface;
      const retainedAssets = prepared;
      surface = undefined;
      prepared = undefined;
      if (retainedSurface) {
        // Remove pixels immediately; unmount the independent root after React's parent commit.
        retainedSurface.element.parentElement?.remove();
        queueMicrotask(() => {
          try {
            retainedSurface.destroy();
          } finally {
            retainedAssets?.dispose();
          }
        });
      } else {
        retainedAssets?.dispose();
      }
    };
    signal.addEventListener("abort", dispose, { once: true });

    void (async () => {
      try {
        prepared = await prepareMaterialPreview(repository, material, signal);
        surface = await mountLongImageExportSurface({
          plan: prepared.plan, resolvedAssets: prepared.resolvedAssets,
          outerWidth: SURFACE_WIDTH, theme: "light", signal,
          includeImageGroupMetadata: true,
        });
        assertPreviewActive(signal);
        applyPreviewPresentation(surface.element);
        const host = surface.element.parentElement;
        if (!host) throw new Error("无法挂载完整素材预览。");
        host.style.position = "relative";
        host.style.left = "0";
        host.style.top = "0";
        host.style.width = `${SURFACE_WIDTH}px`;
        host.style.pointerEvents = "none";
        host.setAttribute("inert", "");
        viewport.append(host);
        const resize = () => {
          const width = viewport.clientWidth;
          if (width > 0) host.style.zoom = String(Math.min(1, width / SURFACE_WIDTH));
        };
        resize();
        observer = new ResizeObserver(resize);
        observer.observe(viewport);
        if (mounted) setState({ status: "ready", text: prepared.text });
        deadline.clear();
      } catch (error) {
        dispose();
        if (mounted) setState({ status: "error", message: `素材预览加载失败：${detail(error)}` });
      } finally {
        deadline.clear();
      }
    })();

    return () => {
      mounted = false;
      deadline.clear();
      deadline.controller.abort();
      signal.removeEventListener("abort", dispose);
      dispose();
    };
  }, [repository, material]);

  return (
    <section
      aria-label={`${material.name} · 完整预览`}
      aria-busy={state.status === "loading"}
      role="region"
      tabIndex={0}
      style={{ position: "relative", width: "100%", minWidth: 0, maxHeight: "65vh", overflowY: "auto", overflowX: "hidden" }}
    >
      {state.status === "loading" && <p role="status">正在加载完整素材预览…</p>}
      {state.status === "error" && <p role="alert">{state.message} 请重试或重新保存素材。</p>}
      {state.status === "ready" && (
        <div style={hiddenText}>
          <p>{material.name}，只读完整组件，包含 {material.imageCount} 张图片。</p>
          <p>{state.text}</p>
        </div>
      )}
      <div ref={container} style={{ width: "100%", minWidth: 0 }} />
    </section>
  );
}

export function MaterialComponentPreview(props: PreviewProps): ReactNode {
  return <LiveMaterialPreview key={`${props.material.id}:${props.material.revision}:${props.material.metadataVersion}`} {...props} />;
}
