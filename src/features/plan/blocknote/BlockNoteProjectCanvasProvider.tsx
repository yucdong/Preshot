import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import type {
  BlockNotePlanLoadResult,
  BlockNotePlanService,
} from "../../../domain/plan/blocknote/service";
import { LongImageContractError } from "../../../domain/plan/blocknote/longImageExportContract";
import {
  migrateLegacyDefaultImageFrames,
} from "../../../domain/plan/blocknote/plan";
import type {
  PreshotBlockDocument,
  ProjectPlanV14,
} from "../../../domain/plan/canvas/blockDocument";
import {
  imageGroupIdsInBlockDocument,
  mediaFilesInBlockDocument,
} from "../../../domain/plan/canvas/blockDocument";
import { layoutDocumentImageGroupForWidth } from "../../../domain/plan/canvas/documentImageGroupLayout";
import { DEFAULT_REFERENCE_HEIGHT } from "../../../domain/plan/canvas/models";
import {
  MIN_COMPONENT_HEIGHT,
  MIN_COMPONENT_WIDTH,
} from "../../../domain/plan/canvas/models";
import {
  cropForResizedFrame,
  type NormalizedImageCrop,
} from "../../../domain/plan/canvas/imageView";
import type { PlanImagePicker, ScreenCapture } from "../../../domain/plan/ports";
import type {
  DocxSaveTarget,
  PdfSaveTarget,
} from "../../../domain/plan/canvas/ports";
import type {
  ProjectDirectoryRevealer,
  WorkspaceLogger,
} from "../../../domain/workspace/ports";
import type { BlockNotePdfExporter } from "../../../infrastructure/pdf/blockNotePdfExporter";
import type { BlockNoteDocxExporter } from "../../../infrastructure/docx/blockNoteDocxExporter";
import type {
  LongImageExportProgress,
  LongImageExporter,
} from "./dependencies";
import type { LongImageSaveTarget } from "../../../domain/plan/longImageSave";
import { useTheme } from "../../../app/theme/ThemeContext";
import type { SaveState } from "../SaveStatus";
import { ReferenceImageLightbox } from "../ReferenceImageLightbox";
import { getProjectRetirementCoordinator } from "../projectRetirementCoordinator";
import { BlockNoteCanvasToolbar } from "./BlockNoteCanvasToolbar";
import { BlockNoteDocumentEditor } from "./BlockNoteDocumentEditor";
import { ImageDragPreviewProvider } from "./ImageDragPreviewContext";
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
import { applyMeasuredImages } from "./imageHydration";
import type { LongImageExportSettings } from "./LongImageExportDialog";

interface BlockNoteProjectCanvasProviderProps {
  projectName: string;
  projectPath: string;
  docxExporter: BlockNoteDocxExporter;
  docxSaver: DocxSaveTarget;
  exporter: BlockNotePdfExporter;
  longImageExporter: LongImageExporter;
  longImageSaver: LongImageSaveTarget;
  logger: WorkspaceLogger;
  picker: PlanImagePicker;
  projectDirectoryRevealer: ProjectDirectoryRevealer;
  saver: PdfSaveTarget;
  screenCapture?: ScreenCapture;
  service: BlockNotePlanService;
}

type LoadState =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | Extract<BlockNotePlanLoadResult, { status: "incompatible" }>
  | { status: "ready"; plan: ProjectPlanV14 };

interface LightboxTarget {
  groupId: string;
  imageId: string;
  file: string;
}

interface ImageMutationContext {
  getLatestPlan(): ProjectPlanV14;
  getLatestRevision(): number;
}

type LongImageUiProgress =
  | LongImageExportProgress
  | { readonly phase: "save"; readonly partCount: number };

function longImageFailureMessage(
  error: unknown,
  settings: LongImageExportSettings,
): string {
  if (
    settings.allowSplit &&
    error instanceof LongImageContractError &&
    (
      error.code === "NO_EARLIER_BOUNDARY" ||
      error.code === "UNSAFE_CANVAS"
    )
  ) {
    const format = settings.preset === "lossless-png" ? "PNG" : "JPEG";
    const formatRecovery = settings.preset === "lossless-png"
      ? "如可接受 JPEG，也可选择体积更小的“微信兼容” JPEG 预设或降低图片细节；也可改用 PDF/DOCX。"
      : settings.preset === "high-quality"
      ? "也可改用体积更小的“微信兼容” JPEG 预设、降低图片细节，或改用 PDF/DOCX。"
      : "也可降低图片细节，或改用 PDF/DOCX。";
    return `自动分图无法继续：当前完整区块或图片组单行仍超过 ${format} 的高度或体积限制。请缩短或拆分这个区块/图片组，或将方案分段导出。${formatRecovery}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function longImageProgressLabel(progress: LongImageUiProgress): string {
  if (progress.phase === "prepare") return "正在准备长图文档…";
  if (progress.phase === "assets") return "正在检查长图资源…";
  if (progress.phase === "layout") return "正在计算长图排版…";
  if (progress.phase === "save") {
    return `正在保存 ${progress.partCount} 张长图…`;
  }
  const action = progress.phase === "render" ? "渲染" : "压缩";
  return `正在${action}第 ${progress.partNumber}/${progress.partCount} 张…`;
}

function applyImportedImagesToLatest(
  latest: ProjectPlanV14,
  result: Awaited<ReturnType<BlockNotePlanService["importImages"]>>,
  groupId: string,
): ProjectPlanV14 {
  const importedIds = new Set(
    result.images.map(({ image }) => image.id),
  );
  const resultGroup = result.plan.imageGroups.find((group) =>
    group.id === groupId
  );
  if (!resultGroup) return latest;
  const importedById = new Map(
    resultGroup.images
      .filter((image) => importedIds.has(image.id))
      .map((image) => [image.id, image]),
  );
  return {
    ...latest,
    imageGroups: latest.imageGroups.map((group) => {
      if (group.id !== groupId) return group;
      const existingIds = new Set(group.images.map((image) => image.id));
      const images = group.images.map((image) =>
        importedById.get(image.id) ?? image
      );
      for (const { image } of result.images) {
        const measured = importedById.get(image.id);
        if (measured && !existingIds.has(image.id)) {
          images.push(measured);
        }
      }
      return {
        ...group,
        images,
        height: Math.max(
          MIN_COMPONENT_HEIGHT,
          layoutDocumentImageGroupForWidth(images, group.width).height,
        ),
      };
    }),
  };
}

function applyCropToLatest(
  latest: ProjectPlanV14,
  result: Awaited<ReturnType<BlockNotePlanService["commitImageCrop"]>>,
): ProjectPlanV14 {
  const updatedById = new Map(
    result.plan.imageGroups.flatMap((group) =>
      group.images
        .filter((image) => image.file === result.image.file)
        .map((image) => [image.id, image] as const)
    ),
  );
  return {
    ...latest,
    imageGroups: latest.imageGroups.map((group) => {
      let changed = false;
      const images = group.images.map((image) => {
        const updated = updatedById.get(image.id);
        if (!updated || updated.file !== image.file) return image;
        changed = true;
        return updated;
      });
      if (!changed) return group;
      return {
        ...group,
        images,
        height: Math.max(
          MIN_COMPONENT_HEIGHT,
          layoutDocumentImageGroupForWidth(images, group.width).height,
        ),
      };
    }),
  };
}

function applyImageRemovalToLatest(
  latest: ProjectPlanV14,
  groupId: string,
  imageId: string,
): ProjectPlanV14 {
  return {
    ...latest,
    imageGroups: latest.imageGroups.map((group) =>
      group.id === groupId
        ? {
            ...group,
            images: group.images.filter((image) => image.id !== imageId),
          }
        : group
    ),
  };
}

export function BlockNoteProjectCanvasProvider({
  projectName,
  projectPath,
  docxExporter,
  docxSaver,
  exporter,
  longImageExporter,
  longImageSaver,
  logger,
  picker,
  projectDirectoryRevealer,
  saver,
  screenCapture,
  service,
}: BlockNoteProjectCanvasProviderProps) {
  const { resolved: resolvedTheme } = useTheme();
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [canvasError, setCanvasError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [migrationNotice, setMigrationNotice] = useState<string | null>(null);
  const [imageSrc, setImageSrc] = useState<Record<string, string>>({});
  const [mediaSrc, setMediaSrc] = useState<Record<string, string>>({});
  const [lightboxTarget, setLightboxTarget] = useState<LightboxTarget | null>(
    null,
  );
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [exportingDocx, setExportingDocx] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingLongImage, setExportingLongImage] = useState(false);
  const [longImageProgress, setLongImageProgress] =
    useState<LongImageUiProgress | null>(null);
  const [planRevision, setPlanRevision] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const scrollerRef = useRef<HTMLDivElement>(null);
  const autoFitRef = useRef(true);
  const initializedProjectRef = useRef("");
  const captureTokenRef = useRef<string | null>(null);
  const exportInFlightRef = useRef(false);
  const longImageAbortRef = useRef<AbortController | null>(null);
  const planRef = useRef<ProjectPlanV14 | null>(null);
  const planRevisionRef = useRef(0);
  const imageMutationTailRef = useRef<Promise<void>>(Promise.resolve());
  const mountedRef = useRef(true);
  const captureTaskRef = useRef<Promise<void> | null>(null);
  const mediaSrcRef = useRef<Record<string, string>>({});
  const metadataListenersRef = useRef(new Set<() => void>());
  const detachedGroupsRef = useRef(new Map<string, ProjectPlanV14["imageGroups"][number]>());
  const detachedMediaFilesRef = useRef(new Set<string>());
  const savedRef = useRef("");
  const imageMoveUndoRef = useRef<{
    readonly before: ProjectPlanV14;
    readonly after: ProjectPlanV14;
  } | null>(null);
  const retirementCoordinator = getProjectRetirementCoordinator(service);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      longImageAbortRef.current?.abort();
    };
  }, []);

  const save = useCallback(async () => {
    await imageMutationTailRef.current;
    const plan = planRef.current;
    if (!plan) return;
    const serialized = JSON.stringify(plan);
    if (serialized === savedRef.current) {
      setSaveState("saved");
      return;
    }
    setSaveState("saving");
    setSaveError(null);
    try {
      await retirementCoordinator.queue(
        projectPath,
        () => service.savePlan(projectPath, plan),
      );
    } catch (error) {
      setSaveState("unsaved");
      setSaveError(error instanceof Error ? error.message : String(error));
      throw error;
    }
    savedRef.current = serialized;
    if (
      planRef.current === plan &&
      JSON.stringify(planRef.current) === serialized
    ) {
      setSaveState("saved");
    } else {
      setSaveState("unsaved");
    }
  }, [projectPath, retirementCoordinator, service]);

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

  const applyPlan = useCallback((plan: ProjectPlanV14) => {
    if (imageMoveUndoRef.current?.after !== plan) {
      imageMoveUndoRef.current = null;
    }
    planRef.current = plan;
    planRevisionRef.current += 1;
    metadataListenersRef.current.forEach((listener) => listener());
    if (mountedRef.current) {
      setPlanRevision(planRevisionRef.current);
      setSaveState("unsaved");
      setLoadState({ status: "ready", plan });
    }
  }, []);

  const enqueueImageMutation = useCallback(<T,>(
    operation: (context: ImageMutationContext) => Promise<T> | T,
  ): Promise<T> => {
    const baseRevision = planRevisionRef.current;
    const run = imageMutationTailRef.current.then(() =>
      operation({
        getLatestPlan() {
          if (planRevisionRef.current < baseRevision) {
            throw new Error(
              "方案版本已失效，请重新执行图片操作",
            );
          }
          const plan = planRef.current;
          if (!plan) {
            throw new Error("当前方案不可用，请重新打开项目");
          }
          return plan;
        },
        getLatestRevision() {
          return planRevisionRef.current;
        },
      })
    );
    imageMutationTailRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }, []);

  const reportImageMutationFailure = useCallback((error: unknown) => {
    if (!mountedRef.current) return;
    setCanvasError(error instanceof Error ? error.message : String(error));
  }, []);

  const commitImageCrop = useCallback(async (
    groupId: string,
    imageId: string,
    crop: NormalizedImageCrop,
  ) => {
    await enqueueImageMutation(async (context) => {
      let serviceRevision = context.getLatestRevision();
      const result = await service.commitImageCrop(
        projectPath,
        () => {
          serviceRevision = context.getLatestRevision();
          return context.getLatestPlan();
        },
        groupId,
        imageId,
        crop,
      );
      if (mountedRef.current) {
        setImageSrc((existing) => ({
          ...existing,
          [result.image.file]: result.dataUrl,
        }));
      }
      applyPlan(
        serviceRevision === context.getLatestRevision()
          ? result.plan
          : applyCropToLatest(context.getLatestPlan(), result),
      );
    });
  }, [applyPlan, enqueueImageMutation, projectPath, service]);

  const confirmLightboxCrop = useCallback((crop: NormalizedImageCrop) => {
    if (!lightboxTarget) {
      return Promise.reject(
        new Error("当前裁剪目标不可用，请重新打开参考图"),
      );
    }
    return commitImageCrop(
      lightboxTarget.groupId,
      lightboxTarget.imageId,
      crop,
    );
  }, [commitImageCrop, lightboxTarget]);

  useEffect(() => {
    let cancelled = false;
    void retirementCoordinator.waitFor(projectPath)
      .then(() => service.loadPlan(projectPath, projectName))
      .then(
      (result) => {
        if (cancelled) return;
        if (result.status === "incompatible") {
          setLoadState(result);
          return;
        }
        const persistedPlan = result.plan;
        const migration = migrateLegacyDefaultImageFrames(persistedPlan);
        const plan = migration.plan;
        planRef.current = plan;
        planRevisionRef.current += 1;
        setPlanRevision(planRevisionRef.current);
        savedRef.current = result.status === "missing"
          ? ""
          : JSON.stringify(persistedPlan);
        setSaveState(
          JSON.stringify(plan) === savedRef.current ? "saved" : "unsaved",
        );
        setMigrationNotice(
          migration.migratedImageCount > 0
            ? `已升级 ${migration.migratedImageCount} 张旧版默认尺寸图片；自定义尺寸未更改。请确认排版，系统将自动保存。`
            : null,
        );
        const files = new Set(
          plan.imageGroups.flatMap((group) =>
            group.images.map((image) => image.file),
          ),
        );
        const imageEntriesPromise = Promise.all(
          [...files].map(async (file) => [
            file,
            await service.loadImage(projectPath, file),
          ] as const),
        );
        const mediaFiles = new Set(
          mediaFilesInBlockDocument(plan.document),
        );
        const mediaEntriesPromise = Promise.all(
          [...mediaFiles].map(async (file) => [
            file,
            await service.loadMedia(projectPath, file),
          ] as const),
        );
        void Promise.all([
          imageEntriesPromise,
          mediaEntriesPromise,
        ]).then(async ([imageEntries, mediaEntries]) => {
          if (cancelled) return;
          setImageSrc(Object.fromEntries(imageEntries));
          const nextMedia = Object.fromEntries(mediaEntries);
          mediaSrcRef.current = nextMedia;
          setMediaSrc(nextMedia);
          const measured = await applyMeasuredImages(plan, imageEntries);
          if (cancelled) return;
          planRef.current = measured;
          planRevisionRef.current += 1;
          setPlanRevision(planRevisionRef.current);
          setSaveState(
            JSON.stringify(measured) === savedRef.current
              ? "saved"
              : "unsaved",
          );
          setLoadState({ status: "ready", plan: measured });
        }).catch((error: unknown) => {
          if (cancelled) return;
          setLoadState({
            status: "failed",
            message: error instanceof Error ? error.message : String(error),
          });
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
  }, [
    applyPlan,
    projectName,
    projectPath,
    retirementCoordinator,
    service,
  ]);

  useEffect(() => () => {
    void retirementCoordinator
      .queue(projectPath, async () => {
        await captureTaskRef.current;
        await imageMutationTailRef.current;
        const activePlan = planRef.current;
        if (activePlan) {
          const detachedGroups = [...detachedGroupsRef.current.values()];
          const detachedMedia = [...detachedMediaFilesRef.current];
          const serialized = JSON.stringify(activePlan);
          if (serialized !== savedRef.current) {
            await service.savePlan(projectPath, activePlan);
            savedRef.current = serialized;
          }
          if (detachedGroups.length > 0) {
            await service.purgeDetachedGroups(
              projectPath,
              activePlan,
              detachedGroups,
            );
          }
          if (detachedMedia.length > 0) {
            await service.purgeDetachedMedia(
              projectPath,
              activePlan,
              detachedMedia,
            );
          }
        }
      })
      .catch((error: unknown) => {
        console.error("Unable to retire the BlockNote project:", error);
      });
    const captureToken = captureTokenRef.current;
    if (captureToken && screenCapture) {
      void screenCapture.cancel(captureToken);
    }
  }, [projectPath, retirementCoordinator, screenCapture, service]);

  useEffect(() => {
    if (loadState.status !== "ready" || saveState !== "unsaved") return;
    const timer = window.setTimeout(() => {
      void save().catch(() => undefined);
    }, 5_000);
    return () => window.clearTimeout(timer);
  }, [loadState.status, save, saveState]);

  useEffect(() => {
    const onUndoImageMove = (event: KeyboardEvent) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.shiftKey ||
        event.key.toLowerCase() !== "z"
      ) {
        return;
      }
      const undo = imageMoveUndoRef.current;
      if (!undo || planRef.current !== undo.after) return;
      event.preventDefault();
      event.stopPropagation();
      imageMoveUndoRef.current = null;
      applyPlan(undo.before);
    };
    window.addEventListener("keydown", onUndoImageMove, true);
    return () => window.removeEventListener("keydown", onUndoImageMove, true);
  }, [applyPlan]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "s"
      ) {
        event.preventDefault();
        void save().catch(() => undefined);
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
    const currentMediaFiles = new Set(
      mediaFilesInBlockDocument(current.document),
    );
    const nextMediaFiles = new Set(mediaFilesInBlockDocument(document));
    for (const file of currentMediaFiles) {
      if (!nextMediaFiles.has(file)) detachedMediaFilesRef.current.add(file);
    }
    for (const file of nextMediaFiles) {
      detachedMediaFilesRef.current.delete(file);
    }
    const referencedIds = new Set(imageGroupIdsInBlockDocument(document));
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
    selectedImageId,
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
      if (!planRef.current) return;
      void enqueueImageMutation(async (context) => {
        const files = await picker.pickImageFiles("选择参考图片");
        if (!files || files.length === 0) return;
        let serviceRevision = context.getLatestRevision();
        const result = await service.importImages(
          projectPath,
          () => {
            serviceRevision = context.getLatestRevision();
            return context.getLatestPlan();
          },
          groupId,
          files,
        );
        if (mountedRef.current) {
          setImageSrc((existing) => ({
            ...existing,
            ...Object.fromEntries(
              result.images.map((entry) => [entry.image.file, entry.dataUrl]),
            ),
          }));
        }
        const entries = result.images.map((entry) => [
          entry.image.file,
          entry.dataUrl,
        ] as const);
        const measured = await applyMeasuredImages(result.plan, entries);
        applyPlan(
          serviceRevision === context.getLatestRevision()
            ? measured
            : applyImportedImagesToLatest(
                context.getLatestPlan(),
                { ...result, plan: measured },
                groupId,
              ),
        );
      }).catch(reportImageMutationFailure);
    },
    captureImage: screenCapture
      ? (groupId) => {
          if (captureTokenRef.current || !planRef.current) return;
          setCanvasError(null);
          const task = enqueueImageMutation(async (context) => {
            let token: string | null = null;
            let capturedPath: string | null = null;
            try {
              token = await screenCapture.start();
              captureTokenRef.current = token;
              for (;;) {
                const result = await screenCapture.poll(token);
                if (result.status === "pending") {
                  await new Promise((resolve) => window.setTimeout(resolve, 250));
                  continue;
                }
                capturedPath = result.path;
                let serviceRevision = context.getLatestRevision();
                const imported = await service.importImages(
                  projectPath,
                  () => {
                    serviceRevision = context.getLatestRevision();
                    return context.getLatestPlan();
                  },
                  groupId,
                  [result.path],
                );
                if (mountedRef.current) {
                  setImageSrc((existing) => ({
                    ...existing,
                    ...Object.fromEntries(
                      imported.images.map((entry) => [
                        entry.image.file,
                        entry.dataUrl,
                      ]),
                    ),
                  }));
                }
                const entries = imported.images.map((entry) => [
                  entry.image.file,
                  entry.dataUrl,
                ] as const);
                const measured = await applyMeasuredImages(
                  imported.plan,
                  entries,
                );
                applyPlan(
                  serviceRevision === context.getLatestRevision()
                    ? measured
                    : applyImportedImagesToLatest(
                        context.getLatestPlan(),
                        { ...imported, plan: measured },
                        groupId,
                      ),
                );
                return;
              }
            } finally {
              captureTokenRef.current = null;
              if (capturedPath) {
                try {
                  await screenCapture.discard(capturedPath);
                } catch (error) {
                  reportImageMutationFailure(error);
                }
              }
            }
          });
          const trackedTask = task.then(
            () => undefined,
            () => undefined,
          );
          captureTaskRef.current = trackedTask;
          void task
            .catch(reportImageMutationFailure)
            .finally(() => {
              if (captureTaskRef.current === trackedTask) {
                captureTaskRef.current = null;
              }
            });
        }
      : undefined,
    removeImage(groupId, imageId) {
      if (!planRef.current) return;
      if (selectedImageId === imageId) setSelectedImageId(null);
      void enqueueImageMutation(async (context) => {
        let serviceRevision = context.getLatestRevision();
        const next = await service.removeImage(
          projectPath,
          () => {
            serviceRevision = context.getLatestRevision();
            return context.getLatestPlan();
          },
          groupId,
          imageId,
        );
        applyPlan(
          serviceRevision === context.getLatestRevision()
            ? next
            : applyImageRemovalToLatest(
                context.getLatestPlan(),
                groupId,
                imageId,
              ),
        );
      }).catch(reportImageMutationFailure);
    },
    selectImage(imageId) {
      setSelectedImageId(imageId);
    },
    openImage(groupId, imageId, file) {
      setLightboxTarget({ groupId, imageId, file });
    },
    setImageFrame(groupId, imageId, frame) {
      const current = planRef.current;
      if (!current) return;
      const {
        groupHeight,
        frameWidth,
        frameHeight,
        frameOffsetX,
        frameOffsetY,
      } = frame;
      const imageFrame = {
        frameWidth,
        frameHeight,
        frameOffsetX,
        frameOffsetY,
      };
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
                        ...imageFrame,
                        crop: cropForResizedFrame(image, imageFrame),
                      },
                ),
                ...(groupHeight === undefined
                  ? {}
                  : { height: Math.max(MIN_COMPONENT_HEIGHT, groupHeight) }),
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
                height: Math.max(
                  MIN_COMPONENT_HEIGHT,
                  frame.height,
                  layoutDocumentImageGroupForWidth(group.images, width).height,
                ),
                frameOffsetY: frame.frameOffsetY,
              },
        ),
      });
    },
    moveImage(fromGroupId, imageId, toGroupId, toIndex) {
      void enqueueImageMutation((context) => {
        const current = context.getLatestPlan();
        const source = current.imageGroups.find((group) =>
          group.id === fromGroupId
        );
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
        for (const group of imageGroups) {
          if (group.id !== fromGroupId && group.id !== toGroupId) continue;
          group.height = Math.max(
            group.height,
            MIN_COMPONENT_HEIGHT,
            layoutDocumentImageGroupForWidth(group.images, group.width).height,
          );
        }
        const next = { ...current, imageGroups };
        applyPlan(next);
        imageMoveUndoRef.current = { before: current, after: next };
      }).catch(reportImageMutationFailure);
    },
  };

  const uploadMedia = async (file: File): Promise<string> => {
    const imported = await service.importMedia(projectPath, {
      name: file.name,
      mimeType: file.type,
      bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
    });
    mediaSrcRef.current = {
      ...mediaSrcRef.current,
      [imported.file]: imported.dataUrl,
    };
    setMediaSrc(mediaSrcRef.current);
    return imported.dataUrl;
  };

  const resolveMediaUrl = (url: string): string =>
    mediaSrcRef.current[url] ?? url;

  const persistMediaUrl = (url: string): string => {
    for (const [file, dataUrl] of Object.entries(mediaSrcRef.current)) {
      if (dataUrl === url) return file;
    }
    return url;
  };

  const runExport = (
    format: "PDF" | "DOCX",
    exportDocument: (
      plan: ProjectPlanV14,
      assets: Record<string, string>,
    ) => Promise<Uint8Array>,
    saveDocument: PdfSaveTarget | DocxSaveTarget,
  ) => {
    if (exportInFlightRef.current) return;
    const plan = planRef.current;
    if (!plan) return;
    exportInFlightRef.current = true;
    flushSync(() => {
      setCanvasError(null);
      setExportNotice(null);
      if (format === "PDF") setExportingPdf(true);
      else setExportingDocx(true);
    });

    void exportDocument(plan, { ...imageSrc, ...mediaSrc })
      .then((bytes) => saveDocument.save(bytes, {
        suggestedName: format === "PDF" ? "output.pdf" : "output.docx",
        defaultDirectory: projectPath,
      }))
      .then(async (savedPath) => {
        if (
          savedPath === null ||
          saveDocument.revealProjectDirectoryAfterSave === false
        ) {
          return;
        }
        try {
          await projectDirectoryRevealer.revealProjectDirectory(projectPath);
        } catch (error) {
          logger.warn(
            `${format} saved but unable to open project directory`,
            { error, projectPath },
          );
          setExportNotice(
            `${format} 已保存，但无法打开项目文件夹：${
              error instanceof Error ? error.message : String(error)
            }。请从文件资源管理器手动打开项目文件夹。`,
          );
        }
      })
      .catch((error: unknown) => {
        setCanvasError(
          `无法导出 ${format}：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      })
      .finally(() => {
        exportInFlightRef.current = false;
        if (format === "PDF") setExportingPdf(false);
        else setExportingDocx(false);
      });
  };

  const runLongImageExport = (
    settings: LongImageExportSettings,
  ): boolean => {
    if (exportInFlightRef.current) return false;
    const plan = planRef.current;
    if (!plan) return false;

    const abortController = new AbortController();
    exportInFlightRef.current = true;
    longImageAbortRef.current = abortController;
    flushSync(() => {
      setCanvasError(null);
      setExportNotice(null);
      setExportingLongImage(true);
      setLongImageProgress({ phase: "prepare" });
    });

    void longImageExporter.export({
      plan,
      resolvedAssets: { ...imageSrc, ...mediaSrc },
      preset: settings.preset,
      options: {
        allowSplit: settings.allowSplit,
        theme: resolvedTheme,
        width: settings.width,
      },
      signal: abortController.signal,
      onProgress(progress) {
        if (longImageAbortRef.current === abortController) {
          setLongImageProgress(progress);
        }
      },
    })
      .then(async (result) => {
        setLongImageProgress({
          phase: "save",
          partCount: result.parts.length,
        });
        const savedPaths = await longImageSaver.save({
          format: result.manifest.format,
          baseName: result.manifest.baseName,
          defaultDirectory: projectPath,
          parts: result.parts.map((part) => ({
            fileName: part.fileName,
            bytes: part.bytes,
          })),
        });
        if (
          savedPaths === null ||
          longImageSaver.revealProjectDirectoryAfterSave === false
        ) {
          return;
        }
        try {
          await projectDirectoryRevealer.revealProjectDirectory(projectPath);
        } catch (error) {
          logger.warn(
            "Long image saved but unable to open project directory",
            { error, projectPath },
          );
          setExportNotice(
            `长图已保存，但无法打开项目文件夹：${
              error instanceof Error ? error.message : String(error)
            }。请从文件资源管理器手动打开项目文件夹。`,
          );
        }
      })
      .catch((error: unknown) => {
        if (
          error instanceof DOMException &&
          error.name === "AbortError"
        ) {
          return;
        }
        logger.error("Long image export failed", {
          error,
          preset: settings.preset,
          allowSplit: settings.allowSplit,
          width: settings.width,
        });
        setCanvasError(
          `无法导出长图：${longImageFailureMessage(error, settings)}`,
        );
      })
      .finally(() => {
        if (longImageAbortRef.current !== abortController) return;
        longImageAbortRef.current = null;
        exportInFlightRef.current = false;
        setExportingLongImage(false);
        setLongImageProgress(null);
      });
    return true;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BlockNoteCanvasToolbar
        exportingDocx={exportingDocx}
        exportingLongImage={exportingLongImage}
        exportingPdf={exportingPdf}
        onExportDocx={() =>
          runExport("DOCX", docxExporter.export, docxSaver)}
        onExportLongImage={runLongImageExport}
        onExportPdf={() => runExport("PDF", exporter.export, saver)}
        onFitWidth={() => {
          const next = fitBlockNoteDocumentZoom(viewportSize.width);
          autoFitRef.current = true;
          changeZoom(next);
        }}
        onResetZoom={() => {
          autoFitRef.current = false;
          changeZoom(1);
        }}
        onZoomIn={() => {
          autoFitRef.current = false;
          changeZoom(zoom + BLOCKNOTE_ZOOM_STEP);
        }}
        onZoomOut={() => {
          autoFitRef.current = false;
          changeZoom(zoom - BLOCKNOTE_ZOOM_STEP);
        }}
        saveState={saveState}
        zoom={zoom}
      />
      {exportingLongImage && longImageProgress ? (
        <div
          aria-label="长图导出进度"
          aria-live="polite"
          className="flex min-h-9 items-center justify-between gap-3 border-b border-sky-200 bg-sky-50 px-4 py-1.5 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100"
          role="status"
        >
          <span>{longImageProgressLabel(longImageProgress)}</span>
          {longImageProgress.phase !== "save" ? (
            <button
              className="rounded px-2 py-1 font-semibold hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional dark:hover:bg-sky-900"
              onClick={() => longImageAbortRef.current?.abort()}
              type="button"
            >
              取消长图导出
            </button>
          ) : null}
        </div>
      ) : null}
      {saveError ? (
        <div
          className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700"
          role="alert"
        >
          无法保存方案：{saveError}
        </div>
      ) : null}
      {canvasError ? (
        <div
          className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700"
          role="alert"
        >
          操作失败：{canvasError}
        </div>
      ) : null}
      {exportNotice ? (
        <div
          aria-live="polite"
          className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-800"
          role="status"
        >
          {exportNotice}
        </div>
      ) : null}
      {migrationNotice ? (
        <div
          aria-live="polite"
          className="border-b border-sky-200 bg-sky-50 px-4 py-2 text-xs text-sky-800"
          role="status"
        >
          {migrationNotice}
        </div>
      ) : null}
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
          <ImageDragPreviewProvider
            enabled
            imageGroupOrder={imageGroupIdsInBlockDocument(
              loadState.plan.document,
            )}
            imageGroups={loadState.plan.imageGroups}
            imageSources={imageSrc}
            onMoveImage={imageGroupController.moveImage}
            planRevision={planRevision}
            projectKey={projectPath}
            scrollContainerRef={scrollerRef}
          >
            <BlockNoteDocumentEditor
              ariaLabel="方案正文"
              document={loadState.plan.document}
              imageGroupController={imageGroupController}
              key={`${projectPath}:${loadState.plan.schemaVersion}`}
              onChange={updateDocument}
              persistMediaUrl={persistMediaUrl}
              resolveMediaUrl={resolveMediaUrl}
              uploadFile={uploadMedia}
            />
          </ImageDragPreviewProvider>
        </div>
      </div>
      {lightboxTarget && imageSrc[lightboxTarget.file] ? (
        <ReferenceImageLightbox
          alt="参考图"
          cropAction={(() => {
            const image = loadState.plan.imageGroups
              .find((group) => group.id === lightboxTarget.groupId)
              ?.images.find((entry) => entry.id === lightboxTarget.imageId);
            if (
              !image ||
              !Number.isFinite(image.sourceWidth) ||
              !Number.isFinite(image.sourceHeight) ||
              (image.sourceWidth ?? 0) <= 0 ||
              (image.sourceHeight ?? 0) <= 0
            ) {
              return undefined;
            }
            return {
              sourceWidth: image.sourceWidth!,
              sourceHeight: image.sourceHeight!,
              // Invoked by the crop dialog after user confirmation, not during render.
              // eslint-disable-next-line react-hooks/refs
              confirm: confirmLightboxCrop,
            };
          })()}
          onClose={() => setLightboxTarget(null)}
          src={imageSrc[lightboxTarget.file]}
        />
      ) : null}
    </div>
  );
}
