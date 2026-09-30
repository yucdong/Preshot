import { ui, useUiLanguage } from "../../shared/i18n/ui";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { FolderOpen } from "lucide-react";
import type { MaterialDetail, MaterialPreviewInput } from "../../domain/library/models";
import type { MaterialLibraryRepository } from "../../domain/library/ports";
import { MATERIAL_PREVIEW_RENDER_KEY } from "./materialPreviewCache";
import { artifactCollectionsInPlan } from "../../domain/plan/canvas/blockDocument";
import type { ImageClipboardSelection } from "../../domain/clipboard/imageClipboard";
import { imageClipboardFilename, unavailableImageClipboard } from "../../domain/clipboard/imageClipboard";
import { useImageClipboardPort } from "../../features/plan/ImageClipboardContext";
import { materialArtifactLabels } from "../../features/library/libraryUi";
import { ImageClipboardScope } from "../../features/plan/blocknote/clipboard/ImageClipboardScope";
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
    controller.abort(new Error(ui("素材预览生成超时，请重试或减小素材尺寸。")));
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
        reject(new Error(ui("无法编码 PNG 素材缩略图，请重试。")));
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
      if (!context) throw new Error(ui("无法创建素材缩略图画布。"));
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(source, 0, 0, width, imageHeight);
      if (isPartial) {
        context.fillStyle = "#111827";
        context.font = "12px sans-serif";
        context.textBaseline = "middle";
        context.fillText(ui(PARTIAL_LABEL), 8, imageHeight + labelHeight / 2);
      }
      const blob = await encodePng(canvas, signal);
      if (blob.size <= MAX_THUMBNAIL_BYTES) {
        const bytes = new Uint8Array(await previewAbortable(blob.arrayBuffer(), signal));
        assertPreviewActive(signal);
        return {
          bytes: Array.from(bytes), width, height: canvas.height,
          renderKey: MATERIAL_PREVIEW_RENDER_KEY, isPartial,
        };
      }
      if (width <= 240) {
        throw new Error(ui("素材 PNG 缩略图超过 2 MiB，请减少素材尺寸后重试。"));
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
  let mountingSurface = false;
  let session: DomCaptureSession | undefined;
  let canvas: HTMLCanvasElement | undefined;
  const disposeSurface = () => {
    // The mount promise tears down its root before rejecting cancellation.
    if (mountingSurface) return;
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
    prepared = await prepareMaterialPreview(repository, material, signal, "data");
    mountingSurface = true;
    try {
      surface = await mountLongImageExportSurface({
        plan: prepared.plan, resolvedAssets: prepared.resolvedAssets,
        outerWidth: SURFACE_WIDTH, theme: "light", signal,
        includeImageGroupMetadata: true,
        artifactKindLabels: materialArtifactLabels,
      });
    } finally {
      mountingSurface = false;
    }
    assertPreviewActive(signal);
    // Original bytes may decode even when the rendered image is blocked.
    // Never persist a capture of that empty frame as a valid cache.
    for (const image of surface.element.querySelectorAll("img")) {
      if (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
        throw new Error(ui("无法加载素材原图"));
      }
    }
    applyPreviewPresentation(surface.element);
    const measuredHeight = Math.ceil(surface.measurements.height);
    if (
      !Number.isSafeInteger(measuredHeight) || measuredHeight <= 0 ||
      surface.measurements.outerWidth !== SURFACE_WIDTH
    ) {
      throw new Error(ui("素材组件布局尺寸无效，无法生成缩略图。"));
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
    if (result.output !== "canvas") throw new Error(ui("素材截图未返回可缩放画布。"));
    canvas = result.canvas;
    assertPreviewActive(signal);
    if (
      canvas.width !== SURFACE_WIDTH || canvas.height !== height ||
      canvas.width * canvas.height > MAX_CAPTURE_PIXELS
    ) {
      throw new Error(ui("素材截图尺寸超出安全边界。"));
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
        ui("素材预览失败：{{v0}}；无法记录预览失败状态：{{v1}}", { v0: detail(error), v1: detail(persistenceError) }),
        { cause: error },
      );
    }
    throw new Error(ui("素材预览失败：{{v0}}", { v0: detail(error) }), { cause: error });
  } finally {
    deadline.clear();
    signal.removeEventListener("abort", abort);
    session?.close();
    releaseCanvas(canvas);
    disposeSurface();
  }
}

const activePreviews = new WeakMap<MaterialLibraryRepository, Map<string, Promise<void>>>();
const previewQueues = new WeakMap<MaterialLibraryRepository, Promise<void>>();

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
  // An upgrade can expose 50 stale thumbnails at once. Bound decoded images
  // and capture surfaces to one component per repository, including saves.
  const previous = previewQueues.get(repository) ?? Promise.resolve();
  const operation = previous.catch(() => undefined)
    .then(() => persistPreview(repository, material))
    .finally(() => {
      pending.delete(key);
      if (previewQueues.get(repository) === operation) previewQueues.delete(repository);
    });
  pending.set(key, operation);
  previewQueues.set(repository, operation);
  return operation;
}

interface PreviewProps {
  repository: MaterialLibraryRepository;
  material: MaterialDetail;
}

function LiveMaterialPreview({ repository, material }: PreviewProps): ReactNode {
  useUiLanguage();
  const container = useRef<HTMLDivElement>(null);
  const imageClipboard = useImageClipboardPort();
  const clipboardSources = useRef<PreparedMaterialPreview | null>(null);
  const [selectedOriginal, setSelectedOriginal] = useState<{ token: string; index: number } | null>(null);
  const [revealState, setRevealState] = useState({ busy: false, error: "" });
  const revealing = useRef(false);
  const revealGroup = material.kind === "imageGroup" ? repository.revealImageGroup : undefined;
  const singleOriginal = material.kind === "image" && material.images.length === 1 ? material.images[0].localImageId : undefined;
  const originalToken = singleOriginal ?? selectedOriginal?.token;
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
    let mountingSurface = false;
    let observer: ResizeObserver | undefined;
    let frameObserver: MutationObserver | undefined;
    let imageTargets: HTMLDivElement | undefined;
    const dispose = () => {
      clipboardSources.current = null;
      imageTargets?.remove();
      imageTargets = undefined;
      observer?.disconnect();
      observer = undefined;
      frameObserver?.disconnect();
      frameObserver = undefined;
      // A cancelled mount may still render while its asynchronous root cleanup runs.
      if (mountingSurface) return;
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
        mountingSurface = true;
        try {
          surface = await mountLongImageExportSurface({
            plan: prepared.plan, resolvedAssets: prepared.resolvedAssets,
            outerWidth: SURFACE_WIDTH, theme: "light", signal,
            includeImageGroupMetadata: true,
            artifactKindLabels: materialArtifactLabels,
          });
        } finally {
          mountingSurface = false;
        }
        assertPreviewActive(signal);
        applyPreviewPresentation(surface.element);
        const host = surface.element.parentElement;
        if (!host) throw new Error(ui("无法挂载完整素材预览。"));
        host.style.position = "relative";
        host.style.left = "0";
        host.style.top = "0";
        host.style.width = `${SURFACE_WIDTH}px`;
        host.style.pointerEvents = "none";
        host.setAttribute("inert", "");
        viewport.append(host);
        clipboardSources.current = prepared;
        imageTargets = document.createElement("div");
        Object.assign(imageTargets.style, { position: "absolute", inset: "0", pointerEvents: "none" });
        const targets = new Map<string, { button: HTMLButtonElement; frame: HTMLElement }>();
        const canCopy = imageClipboard && imageClipboard.availability !== "unavailable";
        const canSelect = canCopy || Boolean(repository.revealImage);
        if (canSelect) viewport.append(imageTargets);
        const resize = () => {
          if (!mounted || signal.aborted || !surface || !imageTargets) return;
          const width = viewport.clientWidth;
          if (width > 0) host.style.zoom = String(Math.min(1, width / SURFACE_WIDTH));
          if (canSelect) {
            const present = new Set<string>();
            for (const frame of surface.element.querySelectorAll<HTMLElement>("[data-preshot-export-image]")) {
              const groupId = frame.closest<HTMLElement>("[data-preshot-export-image-group]")?.dataset.preshotExportImageGroup;
              const imageId = frame.dataset.preshotExportImage;
              if (!groupId || !imageId) continue;
              const key = `${groupId}\0${imageId}`;
              let target = targets.get(key);
              if (!target) {
                const button = document.createElement("button");
                button.type = "button";
                button.dataset.clipboardGallery = groupId;
                button.dataset.imageClipboardId = imageId;
                Object.assign(button.style, {
                  position: "absolute", background: "transparent", border: "0",
                  borderRadius: "4px", padding: "0", cursor: "default", pointerEvents: "auto",
                });
                button.addEventListener("focus", () => { button.style.outline = "2px solid #0891b2"; });
                button.addEventListener("blur", () => { button.style.outline = ""; });
                const select = () => {
                  const groups = prepared && [...prepared.plan.imageGroups, ...artifactCollectionsInPlan(prepared.plan)];
                  const image = groups?.find((group) => group.id === groupId)?.images.find((image) => image.id === imageId);
                  const token = image && prepared?.sourceTokens.get(image.file);
                  if (token) setSelectedOriginal({ token, index: Number(button.dataset.originalIndex) });
                };
                button.addEventListener("focus", select);
                button.addEventListener("click", select);
                target = { button, frame };
                targets.set(key, target);
              }
              target.frame = frame;
              const index = present.size;
              target.button.dataset.originalIndex = String(index + 1);
              present.add(key);
              target.button.setAttribute("aria-label", ui("选择素材图片 {{v0}}", { v0: index + 1 }));
              if (imageTargets.children[index] !== target.button) {
                imageTargets.insertBefore(target.button, imageTargets.children[index] ?? null);
              }
            }
            for (const [key, target] of targets) {
              if (!present.has(key)) { target.button.remove(); targets.delete(key); }
            }
          }
          const bounds = viewport.getBoundingClientRect();
          for (const { button, frame } of targets.values()) {
            const rectangle = frame.getBoundingClientRect();
            Object.assign(button.style, {
              left: `${rectangle.left - bounds.left}px`, top: `${rectangle.top - bounds.top}px`,
              width: `${rectangle.width}px`, height: `${rectangle.height}px`,
            });
          }
        };
        resize();
        observer = new ResizeObserver(resize);
        observer.observe(viewport);
        observer.observe(surface.element);
        if (canSelect) {
          frameObserver = new MutationObserver(resize);
          frameObserver.observe(surface.element, {
            childList: true, subtree: true, attributes: true,
            attributeFilter: ["data-preshot-export-image", "data-preshot-export-image-group", "style", "class"],
          });
        }
        if (mounted) setState({ status: "ready", text: prepared.text });
        deadline.clear();
      } catch (error) {
        dispose();
        if (mounted) setState({ status: "error", message: ui("素材预览加载失败：{{v0}}", { v0: detail(error) }) });
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
  }, [repository, material, imageClipboard]);

  const resolveImage = async (selection: ImageClipboardSelection) => {
    const prepared = clipboardSources.current;
    if (!prepared || selection.kind !== "gallery") throw new Error(ui("素材预览尚未就绪，请稍候再复制。"));
    const groups = [...prepared.plan.imageGroups, ...artifactCollectionsInPlan(prepared.plan)];
    const image = groups.find(group => group.id === selection.groupId)?.images.find(image => image.id === selection.imageId);
    const token = image && prepared.sourceTokens.get(image.file);
    if (!image || !token) throw new Error(ui("找不到选中的素材原图，请重新打开预览。"));
    const dataUrl = await repository.loadImage(material.id, material.revision, token);
    if (clipboardSources.current !== prepared) throw new Error(ui("素材预览已关闭或改变，请重新复制。"));
    const { id: _id, file: _file, presentationAxes: _axes, ...presentation } = image;
    return { dataUrl, name: imageClipboardFilename(`${material.name}.png`), presentation };
  };

  const revealOriginal = async () => {
    const prepared = clipboardSources.current;
    if (!prepared || (!revealGroup && (!originalToken || !repository.revealImage)) || revealing.current) return;
    revealing.current = true;
    setRevealState({ busy: true, error: "" });
    try {
      if (revealGroup) await revealGroup(material.id, material.revision);
      else await repository.revealImage!(material.id, material.revision, originalToken!);
      if (clipboardSources.current === prepared) setRevealState({ busy: false, error: "" });
    } catch (error) {
      if (clipboardSources.current === prepared) setRevealState({ busy: false, error: detail(error) });
    } finally {
      revealing.current = false;
    }
  };

  return (
    <ImageClipboardScope port={imageClipboard ?? unavailableImageClipboard} resolveImage={resolveImage}>
    {(revealGroup || repository.revealImage) && <div className="ml-actions" role="toolbar" aria-label={ui("素材图片操作")}>
      <button type="button" disabled={state.status !== "ready" || (!revealGroup && !originalToken) || revealState.busy}
        title={ui(revealGroup ? "打开已保存的图片组原图目录" : "在资源管理器中选中素材库保存的原图")} onClick={() => void revealOriginal()}>
        <FolderOpen size={16} aria-hidden />{ui("打开原图所在位置")}
      </button>
      {!revealGroup && !singleOriginal && <span className="ml-muted">{selectedOriginal ? ui("已选第 {{index}} 张图片", { index: selectedOriginal.index }) : ui("请先选择一张图片")}</span>}
      {revealState.error && <p className="ml-error" role="alert">{revealState.error}</p>}
    </div>}
    <section
      aria-label={ui("{{v0}} · 完整预览", { v0: material.name })}
      aria-busy={state.status === "loading"}
      role="region"
      tabIndex={0}
      style={{ position: "relative", width: "100%", minWidth: 0, maxHeight: "65vh", overflowY: "auto", overflowX: "hidden" }}
    >
      {state.status === "loading" && <p role="status">{ui("正在加载完整素材预览…")}</p>}
      {state.status === "error" && <p role="alert">{state.message} {ui("请重试或重新保存素材。")}</p>}
      {state.status === "ready" && (
        <div style={hiddenText}>
          <p>{material.name}{ui("，只读完整组件，包含")} {material.imageCount} {ui("张图片。")}</p>
          <p>{state.text}</p>
        </div>
      )}
      <div ref={container} style={{ position: "relative", width: "100%", minWidth: 0 }} />
    </section>
    </ImageClipboardScope>
  );
}

export function MaterialComponentPreview(props: PreviewProps): ReactNode {
  useUiLanguage();
  return <LiveMaterialPreview key={`${props.material.id}:${props.material.revision}:${props.material.metadataVersion}`} {...props} />;
}
