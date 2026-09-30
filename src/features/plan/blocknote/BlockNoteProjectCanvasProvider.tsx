import { imageDerivativeRequests } from "../../../domain/plan/canvas/imageDerivativeRequests";
import { ArtifactDraftContext, createArtifactDraftRegistry } from "./ArtifactDraftContext";
import { prepareProjectCopy } from "./projectCopyPreparation";
import { ui, useUiLanguage } from "../../../shared/i18n/ui";
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
  ArtifactKind,
  ArtifactRecord,
  ImageCollection,
  PreshotBlockDocument,
  ProjectPlanV15,
  ProjectPlanV14,
} from "../../../domain/plan/canvas/blockDocument";
import {
  artifactIdsInBlockDocument,
  imageGroupIdsInBlockDocument,
  mediaFilesInBlockDocument,
} from "../../../domain/plan/canvas/blockDocument";
import { layoutDocumentImageGroupForWidth } from "../../../domain/plan/canvas/documentImageGroupLayout";
import { DEFAULT_REFERENCE_HEIGHT } from "../../../domain/plan/canvas/models";
import {
  MIN_COMPONENT_HEIGHT,
  type ReferenceComponent,
  type ReferenceImage,
} from "../../../domain/plan/canvas/models";
import {
  cropForResizedFrame,
  type NormalizedImageCrop,
} from "../../../domain/plan/canvas/imageView";
import type { PlanImagePicker, ScreenCapture } from "../../../domain/plan/ports";
import type { CaptureBlockImage } from "./ImageBlockCaptureContext";
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
import { materialGalleryHistory } from "./materialGalleryHistory";
import { imageFrameHistory } from "./imageFrameHistory";
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
import type { ImageImportProgressState } from "./ImageImportProgress";
import { useCaptureReview } from "../useCaptureReview";
import { applyMeasuredImages, measureImageDimensions } from "./imageHydration";
import { assetLoadPercent, type PlanLoadProgress } from "./planLoadProgress";
import type { LongImageExportSettings } from "./LongImageExportDialog";
import type { ArtifactBlockController } from "./ArtifactBlockContext";
import {
  artifactCollectionGroups,
  allCollectionIdsInDocumentOrder,
  findArtifactCollection,
  replaceArtifactCollection,
} from "./artifactCollections";
import { useOptionalMaterialLibrary } from "../../library/MaterialLibraryContext";
import { createImageMaterialSnapshot, createMaterialSnapshot } from "../../../domain/library";
import { findImageMaterialBlock } from "../../../domain/library/imageMaterial";
import {
  insertLibraryMaterial,
  MaterialInsertionRecoveryError,
} from "./materialInsertion";
import type { MaterialEditorBridge } from "./MaterialEditorBridge";
import type { ImageClipboardContents, ImageClipboardInput, ImageClipboardSelection, ImagePasteTarget } from "../../../domain/clipboard/imageClipboard";
import { imageClipboardFilename, unavailableImageClipboard } from "../../../domain/clipboard/imageClipboard";
import {
  changeClipboardGallery, findClipboardBlock, ImagePasteRecoveryError, pasteProjectImage,
  type ImagePasteRepository,
} from "../../../domain/clipboard/projectImagePaste";
import { useImageClipboardPort } from "../ImageClipboardContext";
import { ImageClipboardScope } from "./clipboard/ImageClipboardScope";
import { clipboardPasteAsset } from "./imagePasteAssets";

interface BlockNoteProjectCanvasProviderProps {
  active?: boolean;
  savePaused?: boolean;
  registerBeforeClose?(path: string, flush: (saveChanges?: boolean) => Promise<void>): () => void;
  registerBeforeCopy?(path: string, prepare: () => Promise<() => void>): () => void;
  imagePasteRepository?: ImagePasteRepository;
  onLoadProgress?(projectPath: string, progress: PlanLoadProgress): void;
  projectId?: string;
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
  | { status: "ready"; plan: ProjectPlanV15 };

interface LightboxTarget {
  groupId: string;
  imageId: string;
  file: string;
}

interface ImageMutationContext {
  getLatestPlan(): ProjectPlanV15;
  getLatestRevision(): number;
}

const collectionGroupCache = new WeakMap<
  ProjectPlanV15,
  ReferenceComponent[]
>();

function allCollectionGroups(plan: ProjectPlanV15): ReferenceComponent[] {
  const cached = collectionGroupCache.get(plan);
  if (cached) return cached;
  const groups = [...plan.imageGroups, ...artifactCollectionGroups(plan)];
  collectionGroupCache.set(plan, groups);
  return groups;
}

function createArtifactRecord(kind: ArtifactKind): ArtifactRecord {
  const id = crypto.randomUUID();
  const collection = () => ({
    id: crypto.randomUUID(),
    images: [],
  });
  const base = { id, kind, revision: 0 };
  if (kind === "shootingLocation") {
    return {
      ...base,
      kind,
      venueName: ui("未命名场地"),
      address: "",
      description: "",
      gallery: collection(),
    };
  }
  if (kind === "modelCard") {
    return {
      ...base,
      kind,
      modelId: ui("未命名模特"),
      heightCm: null,
      weightKg: null,
      shoeSize: "",
      notes: "",
      samples: collection(),
    };
  }
  if (kind === "clothing") {
    return {
      ...base,
      kind,
      title: ui("未命名服装"),
      mainGallery: collection(),
      tryOn: {
        expanded: false,
        gallery: collection(),
      },
      source: "",
    };
  }
  return {
    ...base,
    kind,
    title: ui("未命名道具"),
    gallery: collection(),
    source: "",
  };
}

function cloneArtifactRecord(artifact: ArtifactRecord): ArtifactRecord {
  const cloneCollection = <T extends { id: string; images: ReferenceImage[] }>(
    collection: T,
  ): T => ({
    ...structuredClone(collection),
    id: crypto.randomUUID(),
    images: collection.images.map((image) => ({
      ...structuredClone(image),
      id: crypto.randomUUID(),
    })),
  });
  const base = {
    ...structuredClone(artifact),
    id: crypto.randomUUID(),
    revision: 0,
  };
  if (base.kind === "shootingLocation") {
    return {
      ...base,
      venueName: ui("{{v0}} 副本", { v0: base.venueName }),
      gallery: cloneCollection(base.gallery),
    };
  }
  if (base.kind === "modelCard") {
    return {
      ...base,
      modelId: ui("{{v0}} 副本", { v0: base.modelId }),
      samples: cloneCollection(base.samples),
    };
  }
  if (base.kind === "clothing") {
    return {
      ...base,
      title: ui("{{v0}} 副本", { v0: base.title }),
      mainGallery: cloneCollection(base.mainGallery),
      tryOn: {
        ...base.tryOn,
        gallery: cloneCollection(base.tryOn.gallery),
      },
    };
  }
  return {
    ...base,
    title: ui("{{v0}} 副本", { v0: base.title }),
    gallery: cloneCollection(base.gallery),
  };
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
      ? ui("如可接受 JPEG，也可选择体积更小的“微信兼容” JPEG 预设或降低图片细节；也可改用 PDF/DOCX。")
      : settings.preset === "high-quality"
      ? ui("也可改用体积更小的“微信兼容” JPEG 预设、降低图片细节，或改用 PDF/DOCX。")
      : ui("也可降低图片细节，或改用 PDF/DOCX。");
    return ui("自动分图无法继续：当前完整区块或图片组单行仍超过 {{v0}} 的高度或体积限制。请缩短或拆分这个区块/图片组，或将方案分段导出。{{v1}}", { v0: format, v1: formatRecovery });
  }
  return error instanceof Error ? error.message : String(error);
}

function longImageProgressLabel(progress: LongImageUiProgress): string {
  if (progress.phase === "prepare") return ui("正在准备长图文档…");
  if (progress.phase === "assets") return ui("正在检查长图资源…");
  if (progress.phase === "layout") return ui("正在计算长图排版…");
  if (progress.phase === "save") {
    return ui("正在保存 {{v0}} 张长图…", { v0: progress.partCount });
  }
  const action = progress.phase === "render" ? ui("渲染") : ui("压缩");
  return ui("正在{{v0}}第 {{v1}}/{{v2}} 张…", { v0: action, v1: progress.partNumber, v2: progress.partCount });
}

function applyImportedImagesToLatest(
  latest: ProjectPlanV15,
  result: Awaited<ReturnType<BlockNotePlanService["importImages"]>>,
  groupId: string,
): ProjectPlanV15 {
  const importedIds = new Set(
    result.images.map(({ image }) => image.id),
  );
  const resultGroup = result.plan.imageGroups.find((group) =>
    group.id === groupId
  ) ?? artifactCollectionGroups(result.plan).find((group) =>
    group.id === groupId
  );
  if (!resultGroup) return latest;
  const importedById = new Map(
    resultGroup.images
      .filter((image) => importedIds.has(image.id))
      .map((image) => [image.id, image]),
  );
  const next = {
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
  if (next.imageGroups.some((group) => group.id === groupId)) return next;
  return replaceArtifactCollection(next, groupId, (collection) => {
    const existingIds = new Set(collection.images.map((image) => image.id));
    const images = collection.images.map((image) =>
      importedById.get(image.id) ?? image
    );
    for (const { image } of result.images) {
      const measured = importedById.get(image.id);
      if (measured && !existingIds.has(image.id)) images.push(measured);
    }
    return { ...collection, images };
  });
}

function applyCropToLatest(
  latest: ProjectPlanV15,
  result: Awaited<ReturnType<BlockNotePlanService["commitImageCrop"]>>,
  expectedSourceFile?: string,
): ProjectPlanV15 {
  const updatedById = new Map(
    allCollectionGroups(result.plan).flatMap((group) =>
      group.images
        .filter((image) => image.file === result.image.file)
        .map((image) => [image.id, image] as const)
    ),
  );
  const next = {
    ...latest,
    imageGroups: latest.imageGroups.map((group) => {
      let changed = false;
      const images = group.images.map((image) => {
        const updated = updatedById.get(image.id);
        if (
          !updated ||
          (expectedSourceFile !== undefined &&
            image.file !== expectedSourceFile)
        ) {
          return image;
        }
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
  return {
    ...next,
    artifacts: next.artifacts.map((artifact) => {
      const replace = (collection: ImageCollection): ImageCollection => ({
          ...collection,
          images: collection.images.map((image) => {
            const updated = updatedById.get(image.id);
            return updated &&
                (
                  expectedSourceFile === undefined ||
                  image.file === expectedSourceFile
                )
              ? updated
              : image;
          }),
        });
      if (artifact.kind === "shootingLocation") {
        return { ...artifact, gallery: replace(artifact.gallery) };
      }
      if (artifact.kind === "modelCard") {
        return { ...artifact, samples: replace(artifact.samples) };
      }
      if (artifact.kind === "clothing") {
        return {
          ...artifact,
          mainGallery: replace(artifact.mainGallery),
          tryOn: {
            ...artifact.tryOn,
            gallery: replace(artifact.tryOn.gallery),
          },
        };
      }
      return { ...artifact, gallery: replace(artifact.gallery) };
    }),
  };
}

function applyImageRemovalToLatest(
  latest: ProjectPlanV15,
  groupId: string,
  imageId: string,
): ProjectPlanV15 {
  const next = {
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
  return replaceArtifactCollection(next, groupId, (collection) => ({
    ...collection,
    images: collection.images.filter((image) => image.id !== imageId),
  }));
}

export function BlockNoteProjectCanvasProvider({
  active = true,
  savePaused = false,
  registerBeforeClose,
  registerBeforeCopy,
  onLoadProgress,
  projectId,
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
  imagePasteRepository,
}: BlockNoteProjectCanvasProviderProps) {
  useUiLanguage();
  const { resolved: resolvedTheme } = useTheme();
  const materialLibrary = useOptionalMaterialLibrary();
  const imageClipboard = useImageClipboardPort();
  const clipboardInputVersionRef = useRef(0);
  const clipboardFocusVersionRef = useRef(0);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [libraryRecoveryBlocked, setLibraryRecoveryBlocked] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [editorMounted, setEditorMounted] = useState(false);
  const reportEditorMounted = useCallback(() => setEditorMounted(true), []);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [previewWarning, setPreviewWarning] = useState(false);
  const { reviewCapture, captureReviewDialog } = useCaptureReview(active);
  const [copyDrafts] = useState(createArtifactDraftRegistry);
  const copyLockedRef = useRef(false);
  const mediaUploadsRef = useRef(new Set<Promise<unknown>>());
  const [canvasError, setCanvasError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [migrationNotice, setMigrationNotice] = useState<string | null>(null);
  const [imageSrc, setImageSrc] = useState<Record<string, string>>({});
  const [imageImports, setImageImports] = useState<Record<string, ImageImportProgressState>>({});
  const imageImportsRef = useRef(new Set<string>());
  const [, setMediaSrc] = useState<Record<string, string>>({});
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
  const planRef = useRef<ProjectPlanV15 | null>(null);
  const planRevisionRef = useRef(0);
  const materialEditorRef = useRef<MaterialEditorBridge | null>(null);
  const libraryBusyRef = useRef(false);
  const libraryRecoveryBlockedRef = useRef(false);
  const libraryComposingRef = useRef(false);
  const libraryOwnsDialogRef = useRef(false);
  const materialLibraryRef = useRef(materialLibrary);
  const selectedImageIdRef = useRef<string | null>(null);
  const imageMutationTailRef = useRef<Promise<void>>(Promise.resolve());
  const mountedRef = useRef(true);
  const captureTaskRef = useRef<Promise<void> | null>(null);
  const cancelBlockCaptureRef = useRef<(() => void) | null>(null);
  const [capturingBlockImage, setCapturingBlockImage] = useState(false);
  useLayoutEffect(() => {
    if (!active || savePaused) cancelBlockCaptureRef.current?.();
    return () => { cancelBlockCaptureRef.current?.(); };
  }, [active, savePaused]);
  const mediaSrcRef = useRef<Record<string, string>>({});
  const imageSrcRef = useRef<Record<string, string>>({});
  const metadataListenersRef = useRef(new Set<() => void>());
  const detachedGroupsRef = useRef(new Map<string, ProjectPlanV14["imageGroups"][number]>());
  const detachedArtifactsRef = useRef(new Map<string, ArtifactRecord>());
  const pendingArtifactsRef = useRef(new Map<string, ArtifactRecord>());
  const detachedMediaFilesRef = useRef(new Set<string>());
  const savedRef = useRef("");
  const discardOnCloseRef = useRef(false);
  const savePausedRef = useRef(savePaused);
  useLayoutEffect(() => { savePausedRef.current = savePaused; }, [savePaused]);
  const imageMoveUndoRef = useRef<{
    readonly before: ProjectPlanV15;
    readonly after: ProjectPlanV15;
  } | null>(null);
  const retirementCoordinator = getProjectRetirementCoordinator(service);

  useEffect(() => {
    imageSrcRef.current = imageSrc;
  }, [imageSrc]);

  useEffect(() => {
    materialLibraryRef.current = materialLibrary;
  }, [materialLibrary]);

  useLayoutEffect(() => {
    if (active) return;
    if (libraryOwnsDialogRef.current) {
      materialLibraryRef.current?.close();
      libraryOwnsDialogRef.current = false;
    }
    scrollerRef.current?.querySelectorAll<HTMLMediaElement>("audio, video")
      .forEach((media) => media.pause());
  }, [active]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      longImageAbortRef.current?.abort();
      if (libraryOwnsDialogRef.current) materialLibraryRef.current?.close();
    };
  }, []);

  const updateLoadState = useCallback((next: LoadState) => {
    if (mountedRef.current) setLoadState(next);
  }, []);

  const updateSaveState = useCallback((next: SaveState) => {
    if (mountedRef.current) setSaveState(next);
  }, []);

  const updateSaveError = useCallback((next: string | null) => {
    if (mountedRef.current) setSaveError(next);
  }, []);

  const save = useCallback(async (explicitClose = false) => {
    await imageMutationTailRef.current;
    if (discardOnCloseRef.current || (savePausedRef.current && !explicitClose)) return;
    if (libraryRecoveryBlockedRef.current) {
      throw new Error(ui("素材插入恢复状态尚未确认，已暂停自动保存。请重新打开项目。"));
    }
    const plan = planRef.current;
    if (!plan) return;
    const serialized = JSON.stringify(plan);
    if (serialized === savedRef.current) {
      updateSaveState("saved");
      return;
    }
    updateSaveState("saving");
    updateSaveError(null);
    try {
      await retirementCoordinator.queue(
        projectPath,
        () => service.savePlan(projectPath, plan),
      );
    } catch (error) {
      updateSaveState("unsaved");
      updateSaveError(error instanceof Error ? error.message : String(error));
      throw error;
    }
    savedRef.current = serialized;
    if (
      planRef.current === plan &&
      JSON.stringify(planRef.current) === serialized
    ) {
      updateSaveState("saved");
    } else {
      updateSaveState("unsaved");
    }
  }, [
    projectPath,
    retirementCoordinator,
    service,
    updateSaveError,
    updateSaveState,
  ]);

  useLayoutEffect(() => registerBeforeClose?.(projectPath, async (saveChanges = true) => {
    if (libraryBusyRef.current || exportInFlightRef.current) {
      throw new Error(ui("项目仍在处理素材或导出，请完成后再关闭。"));
    }
    await captureTaskRef.current;
    await imageMutationTailRef.current;
    if (saveChanges) {
      await save(true);
    } else {
      await retirementCoordinator.waitFor(projectPath);
      discardOnCloseRef.current = true;
    }
  }), [projectPath, registerBeforeClose, retirementCoordinator, save]);

  useLayoutEffect(() => registerBeforeCopy?.(projectPath, () => prepareProjectCopy({
    freeze() {
      if (copyLockedRef.current || libraryBusyRef.current || exportInFlightRef.current || !planRef.current) {
        throw new Error(ui("项目仍在加载、处理素材或导出，请完成后再复制。"));
      }
      copyLockedRef.current = true;
      materialEditorRef.current?.setEditable?.(false);
      return () => { copyLockedRef.current = false; materialEditorRef.current?.setEditable?.(true); };
    },
    flushFields() { flushSync(() => copyDrafts.flush()); },
    async drain() {
      await captureTaskRef.current;
      await Promise.all([...mediaUploadsRef.current]);
      await imageMutationTailRef.current;
    },
    flushDocument() { flushSync(() => materialEditorRef.current?.flushDocument?.()); },
    save: () => save(true),
  })), [copyDrafts, projectPath, registerBeforeCopy, save]);

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

  const applyPlan = useCallback((plan: ProjectPlanV15) => {
    if (imageMoveUndoRef.current?.after !== plan) {
      imageMoveUndoRef.current = null;
    }
    planRef.current = plan;
    planRevisionRef.current += 1;

    metadataListenersRef.current.forEach((listener) => listener());
    if (mountedRef.current) {
      setPlanRevision(planRevisionRef.current);
      updateSaveState("unsaved");
      updateLoadState({ status: "ready", plan });
    }
  }, [updateLoadState, updateSaveState]);

  const enqueueImageMutation = useCallback(<T,>(
    operation: (context: ImageMutationContext) => Promise<T> | T,
  ): Promise<T> => {
    if (copyLockedRef.current) return Promise.reject(new Error(ui("项目正在复制，请完成后再编辑。")));
    const baseRevision = planRevisionRef.current;
    const run = imageMutationTailRef.current.then(() =>
      operation({
        getLatestPlan() {
          if (planRevisionRef.current < baseRevision) {
            throw new Error(
              ui("方案版本已失效，请重新执行图片操作"),
            );
          }
          const plan = planRef.current;
          if (!plan) {
            throw new Error(ui("当前方案不可用，请重新打开项目"));
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

  const registerMaterialEditor = useCallback((bridge: MaterialEditorBridge) => {
    materialEditorRef.current = bridge;
    return () => {
      if (materialEditorRef.current === bridge) materialEditorRef.current = null;
    };
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
      const before = context.getLatestPlan();
      const beforeImage = allCollectionGroups(before)
        .find((group) => group.id === groupId)
        ?.images.find((image) => image.id === imageId);
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
      const copyOnWrite =
        beforeImage !== undefined && result.image.file !== beforeImage.file;
      if (mountedRef.current) {
        setImageSrc((existing) => ({
          ...existing,
          [result.image.file]: result.dataUrl,
        }));
        if (copyOnWrite) {
          setLightboxTarget((current) =>
            current?.groupId === groupId && current.imageId === imageId
              ? { ...current, file: result.image.file }
              : current
          );
        }
      }
      const next =
        serviceRevision === context.getLatestRevision()
          ? result.plan
          : applyCropToLatest(
              context.getLatestPlan(),
              result,
              beforeImage?.file,
            );
      applyPlan(next);
      if (copyOnWrite) {
        imageMoveUndoRef.current = { before, after: next };
      }
    });
  }, [
    applyPlan,
    enqueueImageMutation,
    projectPath,
    service,
  ]);

  const confirmLightboxCrop = useCallback((crop: NormalizedImageCrop) => {
    if (!lightboxTarget) {
      return Promise.reject(
        new Error(ui("当前裁剪目标不可用，请重新打开参考图")),
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
    let failed = false;
    const report = (progress: PlanLoadProgress) => {
      if (!cancelled && !failed) onLoadProgress?.(projectPath, progress);
    };
    const load = async () => {
      try {
        await retirementCoordinator.waitFor(projectPath);
        if (cancelled) return;
        report({ status: "loading", percent: 12 });
        const result = await service.loadPlan(projectPath, projectName);
        if (cancelled) return;
        if (result.status === "incompatible") {
          updateLoadState(result);
          report({
            status: "failed",
            message: ui("方案版本不兼容：当前项目版本为 {{v0}}，需要版本 {{v1}}。项目文件未被修改。", { v0: result.foundSchemaVersion ?? ui("未知"), v1: result.requiredSchemaVersion }),
          });
          failed = true;
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
        const initialSaveState = JSON.stringify(plan) === savedRef.current
          ? "saved"
          : "unsaved";
        updateSaveState(initialSaveState);

        setMigrationNotice(
          migration.migratedImageCount > 0
            ? ui("已升级 {{v0}} 张旧版默认尺寸图片；自定义尺寸未更改。请确认排版，系统将自动保存。", { v0: migration.migratedImageCount })
            : result.status === "migrated"
              ? ui("项目已安全升级为素材组件格式；原有内容和图片组未更改。")
              : null,
        );
        const files = new Set(
          allCollectionGroups(plan).flatMap((group) =>
            group.images.map((image) => image.file),
          ),
        );
        const mediaFiles = new Set(mediaFilesInBlockDocument(plan.document));
        const total = files.size * 2 + mediaFiles.size;
        let completed = 0;
        const assetFinished = () => {
          if (cancelled || failed) return;
          completed += 1;
          report({ status: "loading", percent: assetLoadPercent(completed, total) });
        };
        report({ status: "loading", percent: assetLoadPercent(0, total) });
        const imageEntriesPromise = Promise.all(
          [...files].map(async (file) => {
            const source = await service.loadImage(projectPath, file);
            assetFinished();
            return [file, source] as const;
          }),
        );
        const mediaEntriesPromise = Promise.all(
          [...mediaFiles].map(async (file) => {
            const source = await service.loadMedia(projectPath, file);
            assetFinished();
            return [file, source] as const;
          }),
        );
        const [imageEntries, mediaEntries] = await Promise.all([
          imageEntriesPromise,
          mediaEntriesPromise,
        ]);
        if (cancelled) return;
        setImageSrc(Object.fromEntries(imageEntries));
        const nextMedia = Object.fromEntries(mediaEntries);
        mediaSrcRef.current = nextMedia;
        setMediaSrc(nextMedia);
        const measured = await applyMeasuredImages(plan, imageEntries, async (source, file) => {
          const dimensions = await service.imageDimensions?.(projectPath, file) ?? await measureImageDimensions(source);
          assetFinished();
          return dimensions;
        });
        if (cancelled) return;
        planRef.current = measured;
        planRevisionRef.current += 1;
        const measuredSaveState = JSON.stringify(measured) === savedRef.current
          ? "saved"
          : "unsaved";

        setPlanRevision(planRevisionRef.current);
        updateSaveState(measuredSaveState);
        report({ status: "loading", percent: 94 });
        updateLoadState({ status: "ready", plan: measured });
      } catch (error: unknown) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        report({ status: "failed", message });
        failed = true;
        updateLoadState({
          status: "failed",
          message,
        });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [
    applyPlan,
    onLoadProgress,
    projectName,
    projectPath,
    retirementCoordinator,
    service,
    updateLoadState,
    updateSaveState,
  ]);

  useEffect(() => () => {
    void retirementCoordinator
      .queue(projectPath, async () => {
        await captureTaskRef.current;
        await imageMutationTailRef.current;
        // The in-memory plan may remove files still referenced by the saved manifest.
        // Discard must neither publish it nor purge assets using that draft.
        if (discardOnCloseRef.current) return;
        if (libraryRecoveryBlockedRef.current) {
          throw new Error("Material insertion recovery is unresolved; retirement will not overwrite the project or purge its files.");
        }
        const activePlan = planRef.current;
        if (activePlan) {
          const detachedGroups = [...detachedGroupsRef.current.values()];
          const detachedArtifactGroups = [
            ...detachedArtifactsRef.current.values(),
          ].flatMap((artifact) =>
            artifactCollectionGroups({ artifacts: [artifact] })
          );
          const detachedMedia = [...detachedMediaFilesRef.current];
          const serialized = JSON.stringify(activePlan);
          if (serialized !== savedRef.current) {
            await service.savePlan(projectPath, activePlan);
            savedRef.current = serialized;
          }
          await service.purgeDetachedGroups(
            projectPath,
            activePlan,
            [...detachedGroups, ...detachedArtifactGroups],
          );
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
    if (savePaused || loadState.status !== "ready" || saveState !== "unsaved") return;
    const timer = window.setTimeout(() => {
      void save().catch(() => undefined);
    }, 5_000);
    return () => window.clearTimeout(timer);
  }, [loadState.status, save, savePaused, saveState]);

  useEffect(() => {
    const onUndoImageMove = (event: KeyboardEvent) => {
      if (!active || scrollerRef.current?.closest("[inert]")) return;
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
      setLightboxTarget((current) => {
        if (!current) return current;
        const restored = allCollectionGroups(undo.before)
          .find((group) => group.id === current.groupId)
          ?.images.find((image) => image.id === current.imageId);
        return restored ? { ...current, file: restored.file } : null;
      });
    };
    window.addEventListener("keydown", onUndoImageMove, true);
    return () => window.removeEventListener("keydown", onUndoImageMove, true);
  }, [active, applyPlan]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!active || event.defaultPrevented || scrollerRef.current?.closest("[inert]")) return;
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
  }, [active, save]);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const rect = scroller.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
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

  const resolveMediaUrl = useCallback(
    (url: string): string => mediaSrcRef.current[url] ?? url,
    [],
  );

  const persistMediaUrl = useCallback((url: string, blockId?: string): string => {
    const current = planRef.current;
    const block = current && blockId ? findClipboardBlock(current.document.blocks, blockId) : undefined;
    const ownedFile = block?.props.url;
    if (typeof ownedFile === "string" && mediaSrcRef.current[ownedFile] === url) return ownedFile;
    for (const [file, dataUrl] of Object.entries(mediaSrcRef.current)) {
      if (dataUrl === url) return file;
    }
    return url;
  }, []);

  useLayoutEffect(() => {
    if (!active || loadState.status !== "ready" || !materialLibrary) return;
    return materialLibrary.registerDocumentBrowser(() => requestMaterialInsert());
  });

  useEffect(() => {
    if (!onLoadProgress || !editorMounted || loadState.status !== "ready") return;
    let finalFrame = 0;
    const frame = requestAnimationFrame(() => {
      onLoadProgress(projectPath, { status: "loading", percent: 97 });
      finalFrame = requestAnimationFrame(() => {
        onLoadProgress(projectPath, { status: "ready" });
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(finalFrame);
    };
  }, [editorMounted, loadState.status, onLoadProgress, projectPath]);

  if (loadState.status === "loading") {
    return <div className="p-6 text-sm text-app-muted">{ui("正在加载方案…")}</div>;
  }
  if (loadState.status === "failed") {
    return <div className="m-6 rounded border border-app-danger bg-app-danger-soft p-4 text-sm" role="alert">{loadState.message}</div>;
  }
  if (loadState.status === "incompatible") {
    return (
      <div className="m-6 rounded-lg border border-app-danger bg-app-danger-soft p-5 text-app-ink" role="alert">
        <h2 className="mb-2 text-lg font-semibold">{ui("方案版本不兼容")}</h2>
        <p className="text-sm">
          {ui("当前项目使用 schema")} {loadState.foundSchemaVersion ?? ui("未知")}{ui("，\r\n          此版本仅支持新建 schema")} {loadState.requiredSchemaVersion} {ui("的 BlockNote 项目。")}
        </p>
        <p className="mt-2 text-xs text-app-muted">{ui("项目文件未被修改。")}</p>
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
    const referencedArtifactIds = new Set(
      artifactIdsInBlockDocument(document),
    );
    for (const artifact of current.artifacts) {
      if (!referencedArtifactIds.has(artifact.id)) {
        detachedArtifactsRef.current.set(artifact.id, artifact);
      }
    }
    const activeArtifactsById = new Map(
      current.artifacts
        .filter((artifact) => referencedArtifactIds.has(artifact.id))
        .map((artifact) => [artifact.id, artifact]),
    );
    for (const artifactId of referencedArtifactIds) {
      const pending = pendingArtifactsRef.current.get(artifactId);
      const detached = detachedArtifactsRef.current.get(artifactId);
      const artifact = pending ?? detached;
      if (!activeArtifactsById.has(artifactId) && artifact) {
        activeArtifactsById.set(artifactId, artifact);
      }
      if (pending) pendingArtifactsRef.current.delete(artifactId);
      if (detached) detachedArtifactsRef.current.delete(artifactId);
    }
    applyPlan({
      ...current,
      document,
      imageGroups: [...activeById.values()],
      artifacts: [...activeArtifactsById.values()],
    });
  };

  const requireLibraryReady = () => {
    if (!mountedRef.current || !planRef.current || !projectId) {
      throw new Error(ui("当前项目不可用，请重新打开项目后再操作素材库。"));
    }
    if (libraryRecoveryBlockedRef.current) {
      throw new Error(ui("素材插入存在未解决的恢复记录，请先重新打开项目。"));
    }
    if (libraryComposingRef.current) {
      throw new Error(ui("请先完成当前文字输入，再操作素材库。"));
    }
  };

  const setLibraryOperationBusy = (busy: boolean) => {
    libraryBusyRef.current = busy;
    if (mountedRef.current) setLibraryBusy(busy);
  };

  const requestMaterialSave = (blockId: string, imageId?: string) => {
    if (!materialLibrary) return;
    void (async () => {
      requireLibraryReady();
      await captureTaskRef.current;
      await imageMutationTailRef.current;
      requireLibraryReady();
      const current = planRef.current!;
      const revision = planRevisionRef.current;
      const block = findImageMaterialBlock(current, blockId);
      const dimensions = block?.type === "image" && typeof block.props.url === "string" && block.props.url.startsWith("media/")
        ? await service.imageDimensions?.(projectPath, block.props.url) ?? await measureImageDimensions(resolveMediaUrl(block.props.url)) : undefined;
      requireLibraryReady();
      if (planRevisionRef.current !== revision) throw new Error(ui("图片已变化，请重新保存到素材库。"));
      const snapshot = imageId || block?.type === "image"
        ? createImageMaterialSnapshot(current, blockId, imageId, dimensions)
        : createMaterialSnapshot(current, blockId);
      const expectedPlan = structuredClone(current);
      const operationId = crypto.randomUUID();
      libraryOwnsDialogRef.current = true;
      materialLibrary.openSave({
        snapshot,
        projectName,
        async onSave(metadata) {
          requireLibraryReady();
          if (libraryBusyRef.current || planRevisionRef.current !== revision) {
            throw new Error(ui("组件已变化，请关闭窗口后重新保存到素材库。"));
          }
          setLibraryOperationBusy(true);
          try {
            await save();
            return await enqueueImageMutation(async () => {
              requireLibraryReady();
              if (planRevisionRef.current !== revision) {
                throw new Error(ui("组件已变化，请关闭窗口后重新保存到素材库。"));
              }
              return materialLibrary.repository.save({
                operationId,
                projectId: projectId!,
                projectPath,
                expectedPlan,
                snapshot,
                metadata,
              });
            });
          } finally {
            setLibraryOperationBusy(false);
          }
        },
      });
    })().catch(reportImageMutationFailure);
  };

  function requestMaterialInsert(targetGroupId?: string) {
    if (!materialLibrary) return;
    try {
      requireLibraryReady();
      const editor = materialEditorRef.current;
      if (!editor) throw new Error(ui("编辑器尚未就绪，请稍后再试。"));
      const afterBlockId = editor.getAnchor();
      const revision = planRevisionRef.current;
      const expectedPlan = structuredClone(planRef.current!);
      const targetGroup = expectedPlan.imageGroups.find((group) => group.id === targetGroupId);
      if (targetGroupId !== undefined && (!targetGroup || !editor.recordExternalHistory)) {
        throw new Error(ui("目标图片组或编辑器尚未就绪，请重新选择。"));
      }
      libraryOwnsDialogRef.current = true;
      materialLibrary.openBrowser({
        targetLabel: `「${projectName}」· ${targetGroup ? ui("图片组「{{v0}}」", { v0: targetGroup.name || ui("未命名") }) : afterBlockId ? ui("当前光标所在内容之后") : ui("文档开头")}`,
        ...(targetGroup ? { imagesOnly: true } : {}),
        async onInsert(material, selection) {
          requireLibraryReady();
          if (libraryBusyRef.current || planRevisionRef.current !== revision) {
            throw new Error(ui("方案或插入位置已变化，请重新打开素材库。"));
          }
          setLibraryOperationBusy(true);
          const importedSources: Record<string, string> = {};
          const importedMedia: Record<string, string> = {};
          try {
            await save();
            await enqueueImageMutation(() => insertLibraryMaterial({
              repository: materialLibrary.repository,
              input: {
                operationId: crypto.randomUUID(),
                materialId: material.id,
                revision: material.revision,
                projectId: projectId!,
                projectPath,
                expectedPlan,
                ...(selection ? { selection } : {}),
                ...(targetGroupId !== undefined ? { targetGroupId } : {}),
              },
              afterBlockId,
              makeId: () => crypto.randomUUID(),
              isCurrent: () =>
                mountedRef.current && !libraryRecoveryBlockedRef.current &&
                planRevisionRef.current === revision &&
                materialEditorRef.current === editor,
              async preparePublication(nextPlan) {
                const currentFiles = new Set(
                  allCollectionGroups(expectedPlan).flatMap((group) =>
                    group.images.map((image) => image.file),
                  ),
                );
                const addedFiles = new Set(
                  allCollectionGroups(nextPlan).flatMap((group) =>
                    group.images.map((image) => image.file),
                  ).filter((file) => !currentFiles.has(file)),
                );
                for (const file of addedFiles) {
                  importedSources[file] = await service.loadImage(projectPath, file);
                }
                const currentMedia = new Set(mediaFilesInBlockDocument(expectedPlan.document));
                for (const file of mediaFilesInBlockDocument(nextPlan.document)) {
                  if (!currentMedia.has(file)) importedMedia[file] = await service.loadMedia(projectPath, file);
                }
              },
              publish(nextPlan, insertedBlockId) {
                // Native commit is authoritative even if this provider retired.
                planRef.current = nextPlan;
                savedRef.current = JSON.stringify(nextPlan);
                planRevisionRef.current = revision + 1;
                imageMoveUndoRef.current = null;
                if (!mountedRef.current) return;
                mediaSrcRef.current = { ...mediaSrcRef.current, ...importedMedia };
                flushSync(() => {
                  setImageSrc((existing) => ({ ...existing, ...importedSources }));
                  setMediaSrc(mediaSrcRef.current);
                });
                updateSaveState("saved");
                updateSaveError(null);

                metadataListenersRef.current.forEach((listener) => listener());
                if (targetGroup) {
                  const added = nextPlan.imageGroups.find((group) => group.id === targetGroup.id)!.images.slice(targetGroup.images.length);
                  editor.recordExternalHistory!(materialGalleryHistory(targetGroup.id, added,
                    () => mountedRef.current ? planRef.current : null, applyPlan));
                } else editor.applyDocument(nextPlan.document);
                updateLoadState({ status: "ready", plan: nextPlan });
                setPlanRevision(revision + 1);
                window.requestAnimationFrame(() => {
                  if (mountedRef.current) editor.focusBlock(insertedBlockId);
                });
              },
            }));
          } catch (error) {
            if (error instanceof MaterialInsertionRecoveryError) {
              libraryRecoveryBlockedRef.current = true;
              if (mountedRef.current) {
                setLibraryRecoveryBlocked(true);
                setCanvasError(error.message);
              }
            }
            throw error;
          } finally {
            setLibraryOperationBusy(false);
          }
        },
      });
    } catch (error) {
      reportImageMutationFailure(error);
    }
  }

  const resolveClipboardImage = async (selection: ImageClipboardSelection): Promise<ImageClipboardInput> => {
    requireLibraryReady();
    if (libraryBusyRef.current || captureTaskRef.current || captureTokenRef.current) throw new Error(ui("正在处理图片，请完成后再复制。"));
    await imageMutationTailRef.current;
    requireLibraryReady();
    const current = planRef.current!;
    const revision = planRevisionRef.current;
    if (selection.kind === "gallery") {
      const image = allCollectionGroups(current).find(group => group.id === selection.groupId)
        ?.images.find(entry => entry.id === selection.imageId);
      if (!image) throw new Error(ui("选中的图片已不存在，请重新选择。"));
      const dataUrl = await service.loadImage(projectPath, image.file);
      if (!mountedRef.current || planRevisionRef.current !== revision) throw new Error(ui("图片或项目已变化，请重新复制。"));
      const { id: _id, file: _file, ...presentation } = image;
      return { dataUrl, name: image.file.split(/[\\/]/).at(-1) ?? "image.png", presentation };
    }
    const block = findClipboardBlock(current.document.blocks, selection.blockId);
    if (block?.type !== "image" || typeof block.props.url !== "string" || !block.props.url.startsWith("media/")) {
      throw new Error(ui("正文图片尚未完成导入，请稍候再复制。"));
    }
    const dataUrl = await service.loadMedia(projectPath, block.props.url);
    if (!mountedRef.current || planRevisionRef.current !== revision) throw new Error(ui("图片或项目已变化，请重新复制。"));
    const alignment = block.props.textAlignment;
    return {
      dataUrl, name: imageClipboardFilename(typeof block.props.name === "string" ? block.props.name : "image.png"),
      nativeProps: {
        caption: typeof block.props.caption === "string" ? block.props.caption : "",
        ...(alignment === "left" || alignment === "center" || alignment === "right" ? { textAlignment: alignment } : {}),
        ...(typeof block.props.previewWidth === "number" ? { previewWidth: block.props.previewWidth } : {}),
      },
    };
  };

  const pasteClipboardImage = async (contents: ImageClipboardContents, target: ImagePasteTarget) => {
    requireLibraryReady();
    const editor = materialEditorRef.current;
    if (!imagePasteRepository || !editor || !editor.undo ||
        (target.kind === "gallery" && !editor.recordExternalHistory)) {
      throw new Error(ui("图片粘贴服务或编辑器尚未就绪，请重新打开项目。"));
    }
    if (libraryBusyRef.current || captureTaskRef.current || captureTokenRef.current) throw new Error(ui("正在处理图片，请稍候再粘贴。"));
    setLibraryOperationBusy(true);
    try {
      await save();
      requireLibraryReady();
      const expectedPlan = structuredClone(planRef.current!);
      const revision = planRevisionRef.current;
      const asset = await clipboardPasteAsset(contents, target);
      await enqueueImageMutation(() => pasteProjectImage({
        repository: imagePasteRepository, projectPath, operationId: crypto.randomUUID(),
        expectedPlan, target, image: asset.image, dimensions: asset.dimensions,
        presentation: asset.presentation,
        nativeProps: target.kind === "document" && !contents.original.presentation ? contents.original.nativeProps : undefined,
        makeId: () => crypto.randomUUID(),
        isCurrent: () => mountedRef.current && !libraryRecoveryBlockedRef.current &&
          planRevisionRef.current === revision && materialEditorRef.current === editor,
        publish(result, file) {
          const next = result.plan;
          planRef.current = next;
          savedRef.current = JSON.stringify(next);
          planRevisionRef.current = revision + 1;
          imageMoveUndoRef.current = null;
          if (!mountedRef.current) return;
          flushSync(() => {
            if (target.kind === "document") {
              mediaSrcRef.current = { ...mediaSrcRef.current, [file.file]: asset.dataUrl };
              setMediaSrc(mediaSrcRef.current);
            } else {
              imageSrcRef.current = { ...imageSrcRef.current, [file.file]: asset.dataUrl };
              setImageSrc(imageSrcRef.current);
              setSelectedImageId(result.imageId);
              selectedImageIdRef.current = result.imageId;
            }
          });
          if (result.blockId) editor.applyDocument(next.document);
          else if (target.kind === "gallery" && result.image) {
            const pasted = result.image;
            let restoredIndex = next.imageGroups.find(group => group.id === target.groupId)?.images.findIndex(image => image.id === pasted.id) ??
              findArtifactCollection(next, target.groupId)?.collection.images.findIndex(image => image.id === pasted.id) ?? -1;
            editor.recordExternalHistory!({
              undo() {
                const current = planRef.current;
                if (!current || !mountedRef.current) throw new Error(ui("当前图片粘贴历史已结束。"));
                applyPlan(changeClipboardGallery(current, target.groupId, images => {
                  const index = images.findIndex(image => image.id === pasted.id);
                  if (index < 0) throw new Error(ui("粘贴图片已变化，无法撤销。"));
                  restoredIndex = index;
                  return images.filter(image => image.id !== pasted.id);
                }));
                const undoRevision = planRevisionRef.current;
                const inputVersion = clipboardInputVersionRef.current;
                return {
                  undo() {
                    if (!mountedRef.current || libraryRecoveryBlockedRef.current || libraryBusyRef.current ||
                        materialEditorRef.current !== editor || planRevisionRef.current !== undoRevision ||
                        clipboardInputVersionRef.current !== inputVersion || !editor.undo) {
                      throw new Error(ui("粘贴之后已有其他编辑，请使用编辑器的撤销功能。"));
                    }
                    editor.undo();
                  },
                };
              },
              redo() {
                const current = planRef.current;
                if (!current || !mountedRef.current) throw new Error(ui("当前图片粘贴历史已结束。"));
                applyPlan(changeClipboardGallery(current, target.groupId, images => {
                  if (images.some(image => image.id === pasted.id)) throw new Error(ui("粘贴图片已存在，不能重复重做。"));
                  const index = Math.min(Math.max(0, restoredIndex), images.length);
                  return [...images.slice(0, index), pasted, ...images.slice(index)];
                }));
              },
            });
          }
          updateSaveState("saved");
          updateSaveError(null);

          metadataListenersRef.current.forEach(listener => listener());
          updateLoadState({ status: "ready", plan: next });
          setPlanRevision(revision + 1);
          const focusVersion = clipboardFocusVersionRef.current;
          window.requestAnimationFrame(() => {
            const active = document.activeElement;
            if (!mountedRef.current || clipboardFocusVersionRef.current !== focusVersion ||
                (active && active !== document.body && !scrollerRef.current?.contains(active))) return;
            if (result.blockId) editor.focusBlock(result.blockId);
            else scrollerRef.current?.querySelector<HTMLElement>(`[data-image-clipboard-id="${result.imageId}"]`)?.focus({ preventScroll: true });
          });
        },
      }));
    } catch (error) {
      if (error instanceof ImagePasteRecoveryError) {
        libraryRecoveryBlockedRef.current = true;
        if (mountedRef.current) { setLibraryRecoveryBlocked(true); setCanvasError(error.message); }
      }
      throw error;
    } finally { setLibraryOperationBusy(false); }
  };

  const artifactController: ArtifactBlockController = {
    ...(materialLibrary ? { saveArtifactBlock: requestMaterialSave } : {}),
    subscribe(listener) {
      metadataListenersRef.current.add(listener);
      return () => metadataListenersRef.current.delete(listener);
    },
    createArtifact(kind) {
      const artifact = createArtifactRecord(kind);
      pendingArtifactsRef.current.set(artifact.id, artifact);
      metadataListenersRef.current.forEach((listener) => listener());
      return artifact.id;
    },
    discardPendingArtifact(artifactId) {
      pendingArtifactsRef.current.delete(artifactId);
      metadataListenersRef.current.forEach((listener) => listener());
    },
    cloneArtifact(artifactId) {
      const source = planRef.current?.artifacts.find(
        (artifact) => artifact.id === artifactId,
      ) ?? pendingArtifactsRef.current.get(artifactId) ??
        detachedArtifactsRef.current.get(artifactId);
      if (!source) return null;
      const clone = cloneArtifactRecord(source);
      pendingArtifactsRef.current.set(clone.id, clone);
      metadataListenersRef.current.forEach((listener) => listener());
      return clone.id;
    },
    getArtifact(artifactId) {
      return planRef.current?.artifacts.find(
        (artifact) => artifact.id === artifactId,
      ) ?? pendingArtifactsRef.current.get(artifactId) ??
        detachedArtifactsRef.current.get(artifactId);
    },
    updateArtifact(artifactId, update) {
      const pending = pendingArtifactsRef.current.get(artifactId);
      if (pending) {
        const next = update(structuredClone(pending));
        if (next.id !== pending.id || next.kind !== pending.kind) {
          throw new Error(ui("素材更新不能改变 artifactId 或类型"));
        }
        pendingArtifactsRef.current.set(artifactId, {
          ...next,
          revision: pending.revision + 1,
        });
        metadataListenersRef.current.forEach((listener) => listener());
        return;
      }
      const current = planRef.current;
      if (!current) return;
      let changed = false;
      const artifacts = current.artifacts.map((artifact) => {
        if (artifact.id !== artifactId) return artifact;
        const next = update(structuredClone(artifact));
        if (next.id !== artifact.id || next.kind !== artifact.kind) {
          throw new Error(ui("素材更新不能改变 artifactId 或类型"));
        }
        changed = JSON.stringify(next) !== JSON.stringify(artifact);
        return changed
          ? { ...next, revision: artifact.revision + 1 }
          : artifact;
      });
      if (changed) applyPlan({ ...current, artifacts });
    },
  };
  const imageGroupController: ImageGroupBlockController = {
    ...(materialLibrary ? { insertImagesFromLibrary: requestMaterialInsert } : {}),
    ...(materialLibrary ? { saveBlock: requestMaterialSave, saveImage(groupId: string, imageId: string) {
      const current = planRef.current;
      const artifact = current?.artifacts.find((entry) =>
        artifactCollectionGroups({ artifacts: [entry] }).some(({ id }) => id === groupId));
      const owner = current?.document.blocks.find((block) =>
        block.type === "imageGroup" ? block.props.groupId === groupId : artifact && block.props.artifactId === artifact.id);
      if (owner) requestMaterialSave(owner.id, imageId);
      else reportImageMutationFailure(new Error(ui("图片所在组件已变化，请重新选择。")));
    } } : {}),
    selectedImageId,
    getImportProgress: (groupId) => imageImports[groupId],
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
          name: ui("图片组 {{v0}}", { v0: current.imageGroups.length + 1 }),
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
          name: ui("{{v0}} 副本", { v0: source.name }),
          images: source.images.map((image) => ({
            ...structuredClone(image),
            id: crypto.randomUUID(),
          })),
        }],
      });
      return groupId;
    },
    getGroup(groupId) {
      const current = planRef.current;
      if (!current) return undefined;
      return allCollectionGroups(current).find((group) => group.id === groupId);
    },
    getImageSrc(file) {
      return imageSrc[file];
    },
    addImages(groupId, maxFrameWidth) {
      if (!planRef.current || imageImportsRef.current.has(groupId)) return;
      imageImportsRef.current.add(groupId);
      setCanvasError(null);
      const progress = (value: ImageImportProgressState) => {
        if (mountedRef.current) setImageImports((previous) => ({ ...previous, [groupId]: value }));
      };
      progress({ phase: "waiting" });
      void enqueueImageMutation(async (context) => {
        const files = await picker.pickImageFiles(ui("选择参考图片"));
        if (!files || files.length === 0) return;
        progress({ phase: "loading", completed: 0, total: files.length });
        let serviceRevision = context.getLatestRevision();
        const result = await service.importImages(
          projectPath,
          () => {
            serviceRevision = context.getLatestRevision();
            return context.getLatestPlan();
          },
          groupId,
          files,
          (completed, total) => progress({
            phase: completed === total ? "preparing" : "loading", completed, total,
          }),
          maxFrameWidth,
        );
        progress({ phase: "preparing", completed: files.length, total: files.length });
        if (mountedRef.current) {
          setImageSrc((existing) => ({
            ...existing,
            ...Object.fromEntries(
              result.images.map((entry) => [entry.image.file, entry.dataUrl]),
            ),
          }));
        }
        if (result.images.some(entry => !entry.dataUrl)) setPreviewWarning(true);
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
      }).catch(reportImageMutationFailure).finally(() => {
        imageImportsRef.current.delete(groupId);
        if (mountedRef.current) setImageImports((previous) => {
          const next = { ...previous };
          delete next[groupId];
          return next;
        });
      });
    },
    captureImage: screenCapture
      ? (groupId, maxFrameWidth) => {
          if (captureTaskRef.current || captureTokenRef.current || !planRef.current) return;
          setCanvasError(null);
          const task = enqueueImageMutation(async (context) => {
            let token: string | null = null;
            let capturedPath: string | null = null;
            try {
              token = await screenCapture.start();
              captureTokenRef.current = token;
              for (;;) {
                const result = await screenCapture.poll(token);
                if (result.status === "cancelled") {
                  token = null;
                  return;
                }
                if (result.status === "pending") {
                  await new Promise((resolve) => window.setTimeout(resolve, 250));
                  continue;
                }
                capturedPath = result.path;
                if (result.review) {
                  const decision = await reviewCapture(result.review, new Promise<void>(() => {}));
                  if (decision === "cancel" || !mountedRef.current) return;
                  if (decision === "retry") {
                    await screenCapture.discard(capturedPath);
                    capturedPath = null;
                    token = null;
                    captureTokenRef.current = null;
                    token = await screenCapture.start();
                    captureTokenRef.current = token;
                    continue;
                  }
                }
                let serviceRevision = context.getLatestRevision();
                const imported = await service.importImages(
                  projectPath,
                  () => {
                    serviceRevision = context.getLatestRevision();
                    return context.getLatestPlan();
                  },
                  groupId,
                  [result.path],
                  undefined,
                  maxFrameWidth,
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
              } else if (token) {
                try {
                  await screenCapture.cancel(token);
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
      if (selectedImageId === imageId) {
        selectedImageIdRef.current = null;
        setSelectedImageId(null);
      }
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
      const current = planRef.current;
      const group = current && allCollectionGroups(current).find((entry) =>
        entry.images.some((image) => image.id === imageId)
      );
      if (group) {
        selectedImageIdRef.current = imageId;
        setSelectedImageId(imageId);
      }
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
      const next = {
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
                        crop: image.fitMode === "stretch"
                          ? image.crop
                          : cropForResizedFrame(image, imageFrame),
                      },
                ),
                ...(groupHeight === undefined
                  ? {}
                  : { height: Math.max(MIN_COMPONENT_HEIGHT, groupHeight) }),
              },
        ),
      };
      const resizedPlan = replaceArtifactCollection(
        next,
        groupId,
        (collection) => ({
          ...collection,
          images: collection.images.map((image) =>
            image.id !== imageId
              ? image
              : {
                  ...image,
                  ...imageFrame,
                  crop: image.fitMode === "stretch"
                    ? image.crop
                    : cropForResizedFrame(image, imageFrame),
                }
          ),
        }),
      );
      const history = imageFrameHistory(groupId, imageId, current, resizedPlan,
        () => mountedRef.current ? planRef.current : null, applyPlan);
      if (!history) return;
      materialEditorRef.current?.recordExternalHistory?.(history);
      applyPlan(resizedPlan);
    },
    setImageFitMode(groupId, imageId, fitMode) {
      const current = planRef.current;
      if (!current) return;
      const imageGroups = current.imageGroups.map((group) =>
        group.id !== groupId
          ? group
          : {
              ...group,
              images: group.images.map((image) =>
                image.id === imageId
                  ? { ...image, fitMode }
                  : image
              ),
            }
      );
      applyPlan(replaceArtifactCollection(
        { ...current, imageGroups },
        groupId,
        (collection) => ({
          ...collection,
          images: collection.images.map((image) =>
            image.id === imageId
              ? { ...image, fitMode }
              : image
          ),
        }),
      ));
    },
    moveImage(fromGroupId, imageId, toGroupId, toIndex) {
      void enqueueImageMutation((context) => {
        const current = context.getLatestPlan();
        const source = allCollectionGroups(current).find((group) =>
          group.id === fromGroupId
        );
        const image = source?.images.find((entry) => entry.id === imageId);
        if (!source || !image) return;
        let next: ProjectPlanV15 = {
          ...current,
          imageGroups: current.imageGroups.map((group) => ({
            ...group,
            images: group.images.filter((entry) => entry.id !== imageId),
          })),
        };
        next = replaceArtifactCollection(next, fromGroupId, (collection) => ({
          ...collection,
          images: collection.images.filter((entry) => entry.id !== imageId),
        }));
        const legacyTarget = next.imageGroups.find((group) =>
          group.id === toGroupId
        );
        if (legacyTarget) {
          const index = Math.max(
            0,
            Math.min(toIndex, legacyTarget.images.length),
          );
          legacyTarget.images = [
            ...legacyTarget.images.slice(0, index),
            image,
            ...legacyTarget.images.slice(index),
          ];
        } else if (findArtifactCollection(next, toGroupId)) {
          next = replaceArtifactCollection(next, toGroupId, (collection) => {
            const index = Math.max(
              0,
              Math.min(toIndex, collection.images.length),
            );
            return {
              ...collection,
              images: [
                ...collection.images.slice(0, index),
                image,
                ...collection.images.slice(index),
              ],
            };
          });
        } else {
          return;
        }
        next = {
          ...next,
          imageGroups: next.imageGroups.map((group) => ({
          ...group,
            height:
              group.id === fromGroupId || group.id === toGroupId
                ? Math.max(
                    group.height,
                    MIN_COMPONENT_HEIGHT,
                    layoutDocumentImageGroupForWidth(
                      group.images,
                      group.width,
                    ).height,
                  )
                : group.height,
          })),
        };
        applyPlan(next);
        imageMoveUndoRef.current = { before: current, after: next };
      }).catch(reportImageMutationFailure);
    },
  };

  const captureBlockImage: CaptureBlockImage = async (target) => {
    if (!screenCapture?.captureMedia || !active || !mountedRef.current || !target.isCurrent()) return;
    if (captureTaskRef.current || libraryBusyRef.current || savePausedRef.current) {
      setCanvasError(ui("正在处理图片或关闭项目，请完成后再截图。"));
      return;
    }
    let cancelled = false;
    const cancellation = new Promise<void>((resolve) => {
      cancelBlockCaptureRef.current = () => { cancelled = true; resolve(); };
    });
    setCapturingBlockImage(true);
    setCanvasError(null);
    const task = enqueueImageMutation(async () => {
      if (cancelled || !mountedRef.current || !target.isCurrent()) return;
      const imported = await screenCapture.captureMedia!(projectPath, cancellation, reviewCapture);
      if (!imported || cancelled || !mountedRef.current || !target.isCurrent()) return;
      mediaSrcRef.current = { ...mediaSrcRef.current, [imported.file]: imported.dataUrl };
      setMediaSrc(mediaSrcRef.current);
      target.publish(imported);
    }).catch(reportImageMutationFailure);
    captureTaskRef.current = task;
    try {
      await task;
    } finally {
      if (captureTaskRef.current === task) captureTaskRef.current = null;
      cancelBlockCaptureRef.current = null;
      if (mountedRef.current) setCapturingBlockImage(false);
    }
  };

  const performMediaUpload = async (file: File): Promise<string> => {
    async function* chunks() {
      for (let offset = 0; offset < file.size; offset += 1024 * 1024) {
        if (!mountedRef.current) throw new Error("Image import cancelled because the project was closed");
        yield new Uint8Array(await file.slice(offset, offset + 1024 * 1024).arrayBuffer());
      }
    }
    const imported = service.importImageStream && /\.(jpe?g|png)$/i.test(file.name)
      ? await service.importImageStream(projectPath, file.name, file.size, chunks())
      : await service.importMedia(projectPath, {
      name: file.name,
      mimeType: file.type,
      bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
    });
    mediaSrcRef.current = {
      ...mediaSrcRef.current,
      [imported.file]: imported.dataUrl,
    };
    setMediaSrc(mediaSrcRef.current);
    if (imported.previewError) setPreviewWarning(true);
    return imported.dataUrl || imported.file;
  };

  const uploadMedia = (file: File): Promise<string> => {
    if (copyLockedRef.current) return Promise.reject(new Error(ui("项目正在复制，请完成后再编辑。")));
    const task = performMediaUpload(file);
    mediaUploadsRef.current.add(task);
    return task.finally(() => { mediaUploadsRef.current.delete(task); });
  };

  const exportAssets = async (plan: ProjectPlanV15, width = 1008, signal?: AbortSignal) => {
    const assets = { ...imageSrcRef.current, ...mediaSrcRef.current };
    if (service.imageDisplay) {
      for (const [file, edge] of imageDerivativeRequests(plan, width)) {
        signal?.throwIfAborted();
        let cancel!: () => void;
        const cancellation = signal ? new Promise<void>(resolve => { cancel = resolve; signal.addEventListener("abort", cancel, { once: true }); }) : undefined;
        try { assets[file] = await service.imageDisplay(projectPath, file, edge, cancellation); }
        finally { if (cancel) signal?.removeEventListener("abort", cancel); }
      }
    }
    signal?.throwIfAborted();
    return assets;
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

    void exportAssets(plan).then(assets => exportDocument(plan, assets))
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
            ui("{{v0}} 已保存，但无法打开项目文件夹：{{v1}}。请从文件资源管理器手动打开项目文件夹。", { v0: format, v1: error instanceof Error ? error.message : String(error) }),
          );
        }
      })
      .catch((error: unknown) => {
        setCanvasError(
          ui("无法导出 {{v0}}：{{v1}}", { v0: format, v1: error instanceof Error ? error.message : String(error) }),
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

    void exportAssets(plan, settings.width, abortController.signal).then(resolvedAssets => longImageExporter.export({
      plan,
      resolvedAssets,
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
    }))
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
            ui("长图已保存，但无法打开项目文件夹：{{v0}}。请从文件资源管理器手动打开项目文件夹。", { v0: error instanceof Error ? error.message : String(error) }),
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
          ui("无法导出长图：{{v0}}", { v0: longImageFailureMessage(error, settings) }),
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
    <ArtifactDraftContext.Provider value={copyDrafts}><div className="flex min-h-0 flex-1 flex-col">
      <BlockNoteCanvasToolbar
        active={active}
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
          aria-label={ui("长图导出进度")}
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
              {ui("取消长图导出")}
            </button>
          ) : null}
        </div>
      ) : null}
      {saveError ? (
        <div
          className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700"
          role="alert"
        >
          {ui("无法保存方案：")}{saveError}
        </div>
      ) : null}
      {captureReviewDialog}
      {active && capturingBlockImage ? (
        <div className="border-b border-sky-200 bg-sky-50 px-4 py-2 text-xs text-sky-800" role="status">
          {ui("请在屏幕上框选截图区域，完成后会自动插入当前图片块。")}
          <button className="ml-3 underline" type="button" onClick={() => cancelBlockCaptureRef.current?.()}>{ui("取消截图")}</button>
        </div>
      ) : null}
      {previewWarning && <div role="status" className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-800">
        {ui("原图已导入，预览生成失败。请点击重试预览。")}
        <button type="button" className="ml-3 underline" onClick={() => {
          void (async () => {
            const current = planRef.current;
            if (!current) return;
            const references = [...current.imageGroups, ...artifactCollectionGroups(current)].flatMap(group => group.images);
            for (const { file } of references) if (!imageSrcRef.current[file]) {
              const url = await service.loadImage(projectPath, file);
              setImageSrc(previous => ({ ...previous, [file]: url }));
            }
            for (const [file, url] of Object.entries(mediaSrcRef.current)) if (!url) {
              mediaSrcRef.current[file] = await service.loadMedia(projectPath, file);
            }
            setMediaSrc({ ...mediaSrcRef.current });
            setPreviewWarning(false);
          })().catch(error => setCanvasError(String(error)));
        }}>{ui("重试预览")}</button>
      </div>}
      {canvasError ? (
        <div
          className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700"
          role="alert"
        >
          {ui("操作失败：")}{canvasError}
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
        inert={libraryBusy || libraryRecoveryBlocked}
        onCompositionStartCapture={() => { libraryComposingRef.current = true; }}
        onCompositionEndCapture={() => { libraryComposingRef.current = false; }}
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
        onInputCapture={() => { clipboardInputVersionRef.current += 1; }}
        onPointerDownCapture={() => { clipboardFocusVersionRef.current += 1; }}
        onKeyDownCapture={() => { clipboardFocusVersionRef.current += 1; }}
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
            enabled={active}
            imageGroupOrder={allCollectionIdsInDocumentOrder(loadState.plan)}
            imageGroups={allCollectionGroups(loadState.plan)}
            imageSources={imageSrc}
            onMoveImage={imageGroupController.moveImage}
            planRevision={planRevision}
            projectKey={projectPath}
            scrollContainerRef={scrollerRef}
          >
            <ImageClipboardScope
              port={imageClipboard ?? unavailableImageClipboard}
              resolveImage={resolveClipboardImage}
              pasteImage={imagePasteRepository ? pasteClipboardImage : undefined}
              getDocumentAnchor={() => materialEditorRef.current?.getAnchor() ?? null}
              disabled={!active || libraryRecoveryBlocked}
              onUndo={() => materialEditorRef.current?.undo?.()}
            >
            <BlockNoteDocumentEditor
              active={active}
              ariaLabel={ui("方案正文")}
              artifactController={artifactController}
              document={loadState.plan.document}
              imageGroupController={imageGroupController}
              key={`${projectPath}:${loadState.plan.schemaVersion}`}
              onChange={updateDocument}
              onEditorReady={reportEditorMounted}
              onMaterialEditorReady={registerMaterialEditor}
              onInsertMaterial={materialLibrary ? requestMaterialInsert : undefined}
              persistMediaUrl={persistMediaUrl}
              resolveMediaUrl={resolveMediaUrl}
              uploadFile={uploadMedia}
              captureImage={active && screenCapture?.captureMedia ? captureBlockImage : undefined}
            />
            </ImageClipboardScope>
          </ImageDragPreviewProvider>
        </div>
      </div>
      {active && lightboxTarget && imageSrc[lightboxTarget.file] ? (
        <ReferenceImageLightbox
          alt={ui("参考图")}
          cropAction={(() => {
            const image = allCollectionGroups(loadState.plan)
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
              confirm: confirmLightboxCrop,
            };
          })()}
          onClose={() => setLightboxTarget(null)}
          src={imageSrc[lightboxTarget.file]}
        />
      ) : null}
    </div></ArtifactDraftContext.Provider>
  );
}
