import { Minus, Plus } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type {
  BlockNotePlanLoadResult,
  BlockNotePlanService,
} from "../../../domain/plan/blocknote/service";
import type {
  PreshotBlockDocument,
  ProjectPlanV13,
} from "../../../domain/plan/canvas/blockDocument";
import { DEFAULT_REFERENCE_HEIGHT } from "../../../domain/plan/canvas/models";
import {
  MIN_COMPONENT_HEIGHT,
  MIN_COMPONENT_WIDTH,
} from "../../../domain/plan/canvas/models";
import { cropForResizedFrame } from "../../../domain/plan/canvas/imageView";
import type { PlanImagePicker, ScreenCapture } from "../../../domain/plan/ports";
import type { PdfSaveTarget } from "../../../domain/plan/canvas/ports";
import type { BlockNotePdfExporter } from "../../../infrastructure/pdf/blockNotePdfExporter";
import { setBlockNoteImageNaturalDimensions } from "../../../domain/plan/blocknote/plan";
import { SaveStatus, type SaveState } from "../SaveStatus";
import { ReferenceImageLightbox } from "../ReferenceImageLightbox";
import { BlockNoteDocumentEditor } from "./BlockNoteDocumentEditor";
import {
  BLOCKNOTE_DOCUMENT_CONTENT_WIDTH,
  BLOCKNOTE_DOCUMENT_HORIZONTAL_PADDING,
  BLOCKNOTE_DOCUMENT_WIDTH,
  BLOCKNOTE_MAX_ZOOM,
  BLOCKNOTE_MIN_ZOOM,
  BLOCKNOTE_WORKSPACE_GUTTER,
  BLOCKNOTE_ZOOM_STEP,
  fitBlockNoteDocumentZoom,
} from "./canvasViewport";
import type { ImageGroupBlockController } from "./ImageGroupBlockContext";

interface BlockNoteProjectCanvasProviderProps {
  projectName: string;
  projectPath: string;
  exporter: BlockNotePdfExporter;
  picker: PlanImagePicker;
  saver: PdfSaveTarget;
  screenCapture?: ScreenCapture;
  service: BlockNotePlanService;
}

type LoadState =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | Extract<BlockNotePlanLoadResult, { status: "incompatible" }>
  | { status: "ready"; plan: ProjectPlanV13 };

async function imageDimensions(dataUrl: string): Promise<{
  sourceWidth: number;
  sourceHeight: number;
}> {
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Unable to measure imported image"));
  });
  image.src = dataUrl;
  try {
    await image.decode();
  } catch {
    await loaded;
  }
  return {
    sourceWidth: image.naturalWidth,
    sourceHeight: image.naturalHeight,
  };
}

async function applyMeasuredImages(
  plan: ProjectPlanV13,
  entries: ReadonlyArray<readonly [string, string]>,
): Promise<ProjectPlanV13> {
  let next = plan;
  for (const [file, dataUrl] of entries) {
    const dimensions = await imageDimensions(dataUrl);
    next = setBlockNoteImageNaturalDimensions(next, { file, ...dimensions });
  }
  return next;
}

export function BlockNoteProjectCanvasProvider({
  projectName,
  projectPath,
  exporter,
  picker,
  saver,
  screenCapture,
  service,
}: BlockNoteProjectCanvasProviderProps) {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [imageSrc, setImageSrc] = useState<Record<string, string>>({});
  const [lightboxFile, setLightboxFile] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const scrollerRef = useRef<HTMLDivElement>(null);
  const autoFitRef = useRef(true);
  const initializedProjectRef = useRef("");
  const captureTokenRef = useRef<string | null>(null);
  const planRef = useRef<ProjectPlanV13 | null>(null);
  const metadataListenersRef = useRef(new Set<() => void>());
  const detachedGroupsRef = useRef(new Map<string, ProjectPlanV13["imageGroups"][number]>());
  const savedRef = useRef("");

  const save = useCallback(async () => {
    const plan = planRef.current;
    if (!plan) return;
    const serialized = JSON.stringify(plan);
    if (serialized === savedRef.current) {
      setSaveState("saved");
      return;
    }
    setSaveState("saving");
    await service.savePlan(projectPath, plan);
    savedRef.current = serialized;
    setSaveState("saved");
  }, [projectPath, service]);

  const changeZoom = useCallback((
    requested: number,
    anchor?: { clientX: number; clientY: number },
  ) => {
    const scroller = scrollerRef.current;
    const canvas = scroller?.querySelector<HTMLElement>(
      '[data-testid="plan-document-canvas"]',
    );
    const next = Math.max(
      BLOCKNOTE_MIN_ZOOM,
      Math.min(BLOCKNOTE_MAX_ZOOM, Math.round(requested * 100) / 100),
    );
    if (!scroller || !canvas || next === zoom) return;
    const before = canvas.getBoundingClientRect();
    const clientX = anchor?.clientX ?? before.left + before.width / 2;
    const clientY = anchor?.clientY ??
      before.top + Math.min(before.height / 2, scroller.clientHeight / 2);
    const anchorX = (clientX - before.left) / zoom;
    const anchorY = (clientY - before.top) / zoom;
    setZoom(next);
    window.requestAnimationFrame(() => {
      const after = canvas.getBoundingClientRect();
      scroller.scrollBy({
        left: after.left + anchorX * next - clientX,
        top: after.top + anchorY * next - clientY,
      });
    });
  }, [zoom]);

  const applyPlan = useCallback((plan: ProjectPlanV13) => {
    planRef.current = plan;
    metadataListenersRef.current.forEach((listener) => listener());
    setSaveState("unsaved");
    setLoadState({ status: "ready", plan });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void service.loadPlan(projectPath, projectName).then(
      (result) => {
        if (cancelled) return;
        if (result.status === "incompatible") {
          setLoadState(result);
          return;
        }
        const plan = result.plan;
        planRef.current = plan;
        savedRef.current = result.status === "loaded" ? JSON.stringify(plan) : "";
        setSaveState(result.status === "loaded" ? "saved" : "unsaved");
        setLoadState({ status: "ready", plan });
        const files = new Set(
          plan.imageGroups.flatMap((group) =>
            group.images.map((image) => image.file),
          ),
        );
        void Promise.all(
          [...files].map(async (file) => [
            file,
            await service.loadImage(projectPath, file),
          ] as const),
        ).then((entries) => {
          if (cancelled) return;
          setImageSrc(Object.fromEntries(entries));
          const measurementBase = planRef.current ?? plan;
          void applyMeasuredImages(measurementBase, entries).then(
            (measured) => {
              if (
                !cancelled &&
                planRef.current === measurementBase &&
                measured !== measurementBase
              ) {
                applyPlan(measured);
              }
            },
          );
        });
      },
      (error: unknown) => {
        if (cancelled) return;
        setLoadState({
          status: "failed",
          message: error instanceof Error ? error.message : String(error),
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [applyPlan, projectName, projectPath, service]);

  useEffect(() => () => {
    const activePlan = planRef.current;
    const detachedGroups = [...detachedGroupsRef.current.values()];
    if (activePlan && detachedGroups.length > 0) {
      void service.purgeDetachedGroups(
        projectPath,
        activePlan,
        detachedGroups,
      );
    }
    const captureToken = captureTokenRef.current;
    if (captureToken && screenCapture) {
      void screenCapture.cancel(captureToken);
    }
  }, [projectPath, screenCapture, service]);

  useEffect(() => {
    if (loadState.status !== "ready" || saveState !== "unsaved") return;
    const timer = window.setTimeout(() => {
      void save();
    }, 5_000);
    return () => window.clearTimeout(timer);
  }, [loadState.status, save, saveState]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "s"
      ) {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [save]);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const rect = scroller.getBoundingClientRect();
      setViewportSize((current) =>
        current.width === rect.width && current.height === rect.height
          ? current
          : { width: rect.width, height: rect.height });
    };
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    update();
    return () => observer.disconnect();
  }, [loadState.status]);

  useEffect(() => {
    if (loadState.status !== "ready" || viewportSize.width <= 0) return;
    const next = fitBlockNoteDocumentZoom(viewportSize.width);
    if (initializedProjectRef.current !== projectPath) {
      initializedProjectRef.current = projectPath;
      autoFitRef.current = true;
      setZoom(next);
      window.requestAnimationFrame(() => scrollerRef.current?.scrollTo(0, 0));
      return;
    }
    if (autoFitRef.current) {
      setZoom(next);
      window.requestAnimationFrame(() => {
        const scroller = scrollerRef.current;
        if (scroller) scroller.scrollLeft = 0;
      });
    }
  }, [loadState.status, projectPath, viewportSize.width]);

  if (loadState.status === "loading") {
    return <div className="p-6 text-sm text-app-muted">正在加载 BlockNote 方案…</div>;
  }
  if (loadState.status === "failed") {
    return <div className="m-6 rounded border border-app-danger bg-app-danger-soft p-4 text-sm" role="alert">{loadState.message}</div>;
  }
  if (loadState.status === "incompatible") {
    return (
      <div className="m-6 rounded-lg border border-app-danger bg-app-danger-soft p-5 text-app-ink" role="alert">
        <h2 className="mb-2 text-lg font-semibold">方案版本不兼容</h2>
        <p className="text-sm">
          当前项目使用 schema {loadState.foundSchemaVersion ?? "未知"}，
          此版本仅支持新建 schema {loadState.requiredSchemaVersion} 的 BlockNote 项目。
        </p>
        <p className="mt-2 text-xs text-app-muted">项目文件未被修改。</p>
      </div>
    );
  }

  const updateDocument = (document: PreshotBlockDocument) => {
    const current = planRef.current;
    if (!current) return;
    const referencedIds = new Set(
      document.blocks
        .filter((block) => block.type === "imageGroup")
        .map((block) => String(block.props.groupId)),
    );
    for (const group of current.imageGroups) {
      if (!referencedIds.has(group.id)) {
        detachedGroupsRef.current.set(group.id, group);
      }
    }
    const activeById = new Map(
      current.imageGroups
        .filter((group) => referencedIds.has(group.id))
        .map((group) => [group.id, group]),
    );
    for (const groupId of referencedIds) {
      const detached = detachedGroupsRef.current.get(groupId);
      if (!activeById.has(groupId) && detached) {
        activeById.set(groupId, detached);
        detachedGroupsRef.current.delete(groupId);
      }
    }
    applyPlan({
      ...current,
      document,
      imageGroups: [...activeById.values()],
    });
  };
  const imageGroupController: ImageGroupBlockController = {
    subscribe(listener) {
      metadataListenersRef.current.add(listener);
      return () => metadataListenersRef.current.delete(listener);
    },
    createGroup() {
      const current = planRef.current;
      if (!current) return "";
      const groupId = crypto.randomUUID();
      applyPlan({
        ...current,
        imageGroups: [...current.imageGroups, {
          id: groupId,
          name: `图片组 ${current.imageGroups.length + 1}`,
          type: "reference",
          x: 0,
          width: BLOCKNOTE_DOCUMENT_CONTENT_WIDTH,
          height: DEFAULT_REFERENCE_HEIGHT,
          description: "",
          images: [],
        }],
      });
      return groupId;
    },
    cloneGroup(sourceGroupId) {
      const current = planRef.current;
      const source = current?.imageGroups.find((group) => group.id === sourceGroupId);
      if (!current || !source) return null;
      const groupId = crypto.randomUUID();
      applyPlan({
        ...current,
        imageGroups: [...current.imageGroups, {
          ...structuredClone(source),
          id: groupId,
          name: `${source.name} 副本`,
          images: source.images.map((image) => ({
            ...structuredClone(image),
            id: crypto.randomUUID(),
          })),
        }],
      });
      return groupId;
    },
    getGroup(groupId) {
      return planRef.current?.imageGroups.find((group) => group.id === groupId);
    },
    getImageSrc(file) {
      return imageSrc[file];
    },
    addImages(groupId) {
      const current = planRef.current;
      if (!current) return;
      void picker.pickImageFiles("选择参考图片").then(async (files) => {
        if (!files || files.length === 0 || !planRef.current) return;
        const result = await service.importImages(
          projectPath,
          planRef.current,
          groupId,
          files,
        );
        setImageSrc((existing) => ({
          ...existing,
          ...Object.fromEntries(
            result.images.map((entry) => [entry.image.file, entry.dataUrl]),
          ),
        }));
        const entries = result.images.map((entry) => [
          entry.image.file,
          entry.dataUrl,
        ] as const);
        applyPlan(await applyMeasuredImages(result.plan, entries));
      });
    },
    captureImage: screenCapture
      ? (groupId) => {
          if (captureTokenRef.current || !planRef.current) return;
          void (async () => {
            const token = await screenCapture.start();
            captureTokenRef.current = token;
            try {
              for (;;) {
                const result = await screenCapture.poll(token);
                if (result.status === "pending") {
                  await new Promise((resolve) => window.setTimeout(resolve, 250));
                  continue;
                }
                if (!planRef.current) return;
                const imported = await service.importImages(
                  projectPath,
                  planRef.current,
                  groupId,
                  [result.path],
                );
                setImageSrc((existing) => ({
                  ...existing,
                  ...Object.fromEntries(
                    imported.images.map((entry) => [
                      entry.image.file,
                      entry.dataUrl,
                    ]),
                  ),
                }));
                const entries = imported.images.map((entry) => [
                  entry.image.file,
                  entry.dataUrl,
                ] as const);
                applyPlan(await applyMeasuredImages(imported.plan, entries));
                return;
              }
            } finally {
              captureTokenRef.current = null;
            }
          })();
        }
      : undefined,
    removeImage(groupId, imageId) {
      if (!planRef.current) return;
      void service.removeImage(
        projectPath,
        planRef.current,
        groupId,
        imageId,
      ).then(applyPlan);
    },
    openImage(_groupId, _imageId, file) {
      setLightboxFile(file);
    },
    setImageFrame(groupId, imageId, frame) {
      const current = planRef.current;
      if (!current) return;
      applyPlan({
        ...current,
        imageGroups: current.imageGroups.map((group) =>
          group.id !== groupId
            ? group
            : {
                ...group,
                images: group.images.map((image) =>
                  image.id !== imageId
                    ? image
                    : {
                        ...image,
                        ...frame,
                        crop: cropForResizedFrame(image, frame),
                      },
                ),
              },
        ),
      });
    },
    resizeGroup(groupId, frame) {
      const current = planRef.current;
      if (!current) return;
      const canvasWidth = BLOCKNOTE_DOCUMENT_CONTENT_WIDTH;
      const width = Math.max(
        MIN_COMPONENT_WIDTH,
        Math.min(frame.width, canvasWidth),
      );
      applyPlan({
        ...current,
        imageGroups: current.imageGroups.map((group) =>
          group.id !== groupId
            ? group
            : {
                ...group,
                x: Math.max(0, Math.min(frame.x, canvasWidth - width)),
                width,
                height: Math.max(MIN_COMPONENT_HEIGHT, frame.height),
                frameOffsetY: frame.frameOffsetY,
              },
        ),
      });
    },
    moveImage(fromGroupId, imageId, toGroupId, toIndex) {
      const current = planRef.current;
      if (!current) return;
      const source = current.imageGroups.find((group) => group.id === fromGroupId);
      const image = source?.images.find((entry) => entry.id === imageId);
      if (!source || !image) return;
      const imageGroups = current.imageGroups.map((group) => ({
        ...group,
        images: group.images.filter((entry) => entry.id !== imageId),
      }));
      const target = imageGroups.find((group) => group.id === toGroupId);
      if (!target) return;
      const index = Math.max(0, Math.min(toIndex, target.images.length));
      target.images = [
        ...target.images.slice(0, index),
        image,
        ...target.images.slice(index),
      ];
      applyPlan({ ...current, imageGroups });
    },
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 items-center justify-between bg-[#202329] px-4 text-white">
        <span className="text-xs font-semibold">BlockNote Canvas v13</span>
        <div className="flex items-center gap-3">
          <div className="flex h-8 items-center rounded-md border border-white/10 bg-white/[0.06] p-0.5">
            <button
              aria-label="缩小画布"
              className="grid h-7 w-7 place-items-center rounded text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
              onClick={() => {
                autoFitRef.current = false;
                changeZoom(zoom - BLOCKNOTE_ZOOM_STEP);
              }}
              type="button"
            >
              <Minus aria-hidden className="h-3.5 w-3.5" />
            </button>
            <button
              aria-label="恢复 100% 缩放"
              className="h-7 min-w-12 rounded px-1 text-[10px] tabular-nums text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
              onClick={() => {
                autoFitRef.current = false;
                changeZoom(1);
              }}
              type="button"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              aria-label="放大画布"
              className="grid h-7 w-7 place-items-center rounded text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
              onClick={() => {
                autoFitRef.current = false;
                changeZoom(zoom + BLOCKNOTE_ZOOM_STEP);
              }}
              type="button"
            >
              <Plus aria-hidden className="h-3.5 w-3.5" />
            </button>
            <button
              aria-label="适合宽度"
              className="ml-0.5 h-7 rounded px-2 text-[10px] font-semibold text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
              onClick={() => {
                const next = fitBlockNoteDocumentZoom(viewportSize.width);
                autoFitRef.current = true;
                changeZoom(next);
              }}
              type="button"
            >
              适宽
            </button>
          </div>
          <SaveStatus state={saveState} />
          <button
            className="rounded bg-app-accent px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            disabled={exporting}
            onClick={() => {
              const plan = planRef.current;
              if (!plan) return;
              setExporting(true);
              void exporter.export(plan, imageSrc)
                .then((bytes) => saver.save(bytes, "output.pdf"))
                .finally(() => setExporting(false));
            }}
            type="button"
          >
            {exporting ? "导出中…" : "导出 PDF"}
          </button>
        </div>
      </div>
      <div
        className="editor-workspace-grid min-h-0 flex-1 overflow-auto p-5"
        data-testid="canvas-scroller"
        onWheel={(event) => {
          if (!event.ctrlKey) return;
          event.preventDefault();
          autoFitRef.current = false;
          changeZoom(
            zoom + (event.deltaY < 0 ? BLOCKNOTE_ZOOM_STEP : -BLOCKNOTE_ZOOM_STEP),
            event,
          );
        }}
        ref={scrollerRef}
      >
        <div
          className="relative mx-auto bg-white py-[36px] shadow-[0_12px_34px_rgb(27_30_35_/_14%)]"
          data-testid="plan-document-canvas"
          style={{
            minHeight: `${Math.max(
              842,
              viewportSize.height > 0
                ? (viewportSize.height - BLOCKNOTE_WORKSPACE_GUTTER * 2) / zoom
                : 842,
            )}px`,
            paddingInline: `${BLOCKNOTE_DOCUMENT_HORIZONTAL_PADDING}px`,
            width: `${BLOCKNOTE_DOCUMENT_WIDTH}px`,
            zoom,
          }}
        >
          <BlockNoteDocumentEditor
            ariaLabel="方案正文"
            document={loadState.plan.document}
            imageGroupController={imageGroupController}
            key={`${projectPath}:${loadState.plan.schemaVersion}`}
            onChange={updateDocument}
          />
        </div>
      </div>
      {lightboxFile && imageSrc[lightboxFile] ? (
        <ReferenceImageLightbox
          alt="参考图"
          onClose={() => setLightboxFile(null)}
          src={imageSrc[lightboxFile]}
        />
      ) : null}
    </div>
  );
}
