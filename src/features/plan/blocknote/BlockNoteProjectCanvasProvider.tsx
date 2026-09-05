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
import type {
  AgentProposalApplicationRegistration,
  AgentWorkspacePublisher,
} from "../../../domain/agent/workspaceBridge";
import {
  AgentDomainError,
  AgentProposalTemporaryError,
  hashPreshotDocument,
  type AgentProposalMutationPort,
} from "../../../domain/agent";
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
import type { ArtifactBlockController } from "./ArtifactBlockContext";
import {
  artifactCollectionGroups,
  allCollectionIdsInDocumentOrder,
  findArtifactCollection,
  replaceArtifactCollection,
} from "./artifactCollections";

interface BlockNoteProjectCanvasProviderProps {
  agentWorkspace?: AgentWorkspacePublisher;
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

const AGENT_THUMBNAIL_EDGE = 256;

async function createAgentThumbnail(dataUrl: string): Promise<string> {
  if (dataUrl.length <= 128_000) return dataUrl;
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const scale = Math.min(
    1,
    AGENT_THUMBNAIL_EDGE / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建助手图片缩略图");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.76);
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
      venueName: "未命名场地",
      address: "",
      description: "",
      gallery: collection(),
    };
  }
  if (kind === "modelCard") {
    return {
      ...base,
      kind,
      modelId: "未命名模特",
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
      title: "未命名服装",
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
    title: "未命名道具",
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
      venueName: `${base.venueName} 副本`,
      gallery: cloneCollection(base.gallery),
    };
  }
  if (base.kind === "modelCard") {
    return {
      ...base,
      modelId: `${base.modelId} 副本`,
      samples: cloneCollection(base.samples),
    };
  }
  if (base.kind === "clothing") {
    return {
      ...base,
      title: `${base.title} 副本`,
      mainGallery: cloneCollection(base.mainGallery),
      tryOn: {
        ...base.tryOn,
        gallery: cloneCollection(base.tryOn.gallery),
      },
    };
  }
  return {
    ...base,
    title: `${base.title} 副本`,
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
  agentWorkspace,
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
}: BlockNoteProjectCanvasProviderProps) {
  const proposalProjectId = projectId ?? projectPath;
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
  const planRef = useRef<ProjectPlanV15 | null>(null);
  const planRevisionRef = useRef(0);
  const loadStateRef = useRef<LoadState>({ status: "loading" });
  const saveStateRef = useRef<SaveState>("saved");
  const saveErrorRef = useRef<string | null>(null);
  const selectedImageIdRef = useRef<string | null>(null);
  const imageMutationTailRef = useRef<Promise<void>>(Promise.resolve());
  const mountedRef = useRef(true);
  const captureTaskRef = useRef<Promise<void> | null>(null);
  const mediaSrcRef = useRef<Record<string, string>>({});
  const imageSrcRef = useRef<Record<string, string>>({});
  const metadataListenersRef = useRef(new Set<() => void>());
  const detachedGroupsRef = useRef(new Map<string, ProjectPlanV14["imageGroups"][number]>());
  const detachedArtifactsRef = useRef(new Map<string, ArtifactRecord>());
  const pendingArtifactsRef = useRef(new Map<string, ArtifactRecord>());
  const detachedMediaFilesRef = useRef(new Set<string>());
  const savedRef = useRef("");
  const imageMoveUndoRef = useRef<{
    readonly before: ProjectPlanV15;
    readonly after: ProjectPlanV15;
  } | null>(null);
  const proposalDocumentTransactionRef = useRef<
    ((document: PreshotBlockDocument) => void) | null
  >(null);
  const proposalApplicationRegistrationRef =
    useRef<AgentProposalApplicationRegistration | null>(null);
  const retirementCoordinator = getProjectRetirementCoordinator(service);

  useEffect(() => {
    imageSrcRef.current = imageSrc;
  }, [imageSrc]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      longImageAbortRef.current?.abort();
    };
  }, []);

  const updateLoadState = useCallback((next: LoadState) => {
    loadStateRef.current = next;
    if (mountedRef.current) setLoadState(next);
  }, []);

  const updateSaveState = useCallback((next: SaveState) => {
    saveStateRef.current = next;
    if (mountedRef.current) setSaveState(next);
  }, []);

  const updateSaveError = useCallback((next: string | null) => {
    saveErrorRef.current = next;
    if (mountedRef.current) setSaveError(next);
  }, []);

  const save = useCallback(async () => {
    await imageMutationTailRef.current;
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

  const publishAgentPlan = useCallback((
    plan: ProjectPlanV15,
    revision: number,
    nextSaveState: SaveState,
  ) => {
    if (!agentWorkspace) return;
    agentWorkspace.publishImageIndex(
      allCollectionGroups(plan).flatMap((group) =>
        group.images.map((image) => ({
          groupId: group.id,
          imageId: image.id,
          displayName: image.file.split(/[\\/]/).at(-1) ?? "image",
          groupLabel: group.name,
          relativeFile: image.file,
          width: image.sourceWidth ?? null,
          height: image.sourceHeight ?? null,
        }))
      ),
    );
    agentWorkspace.publishDocument({
      document: plan.document,
      revision,
      saveState: nextSaveState,
    });
  }, [agentWorkspace]);

  const applyPlan = useCallback((plan: ProjectPlanV15) => {
    if (imageMoveUndoRef.current?.after !== plan) {
      imageMoveUndoRef.current = null;
    }
    planRef.current = plan;
    planRevisionRef.current += 1;
    publishAgentPlan(plan, planRevisionRef.current, "unsaved");
    metadataListenersRef.current.forEach((listener) => listener());
    if (mountedRef.current) {
      setPlanRevision(planRevisionRef.current);
      updateSaveState("unsaved");
      updateLoadState({ status: "ready", plan });
    }
  }, [publishAgentPlan, updateLoadState, updateSaveState]);

  useEffect(() => {
    agentWorkspace?.publishSaveState(saveState);
  }, [agentWorkspace, saveState]);

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

  const runAgentPlanTransaction = useCallback(async (input: {
    readonly projectId: string;
    readonly expectedRevision: number;
    readonly expectedDocumentHash: string;
    readonly targetPlan: ProjectPlanV14;
    readonly committedRevision: number;
    readonly conflictCode: "proposal_stale" | "proposal_apply_conflict";
    readonly conflictMessage: string;
  }) => {
    await enqueueImageMutation(async (context) => {
      const current = context.getLatestPlan();
      if (
        input.projectId !== proposalProjectId ||
        context.getLatestRevision() !== input.expectedRevision ||
        hashPreshotDocument(current.document) !== input.expectedDocumentHash
      ) {
        throw new AgentDomainError(
          input.conflictCode,
          "proposal",
          input.conflictMessage,
        );
      }
      const transact = proposalDocumentTransactionRef.current;
      if (!transact || !mountedRef.current) {
        throw new AgentProposalTemporaryError(
          "PLAN_BRIDGE_NOT_READY",
          "The BlockNote editor proposal bridge is not ready",
        );
      }

      const snapshot = {
        plan: structuredClone(current),
        revision: input.expectedRevision,
        saved: savedRef.current,
        saveState: saveStateRef.current,
        saveError: saveErrorRef.current,
        loadState: loadStateRef.current,
      };
      let targetPersisted = false;
      let manifestReconciled = false;
      let editorPublishAttempted = false;

      const restoreSnapshot = (): unknown => {
        let editorError: unknown;
        if (editorPublishAttempted) {
          try {
            proposalDocumentTransactionRef.current?.(snapshot.plan.document);
          } catch (error) {
            editorError = error;
          }
        }
        planRef.current = snapshot.plan;
        planRevisionRef.current = snapshot.revision;
        savedRef.current = snapshot.saved;
        publishAgentPlan(
          snapshot.plan,
          snapshot.revision,
          snapshot.saveState,
        );
        metadataListenersRef.current.forEach((listener) => listener());
        updateSaveState(snapshot.saveState);
        updateSaveError(snapshot.saveError);
        const restoredLoadState = snapshot.loadState.status === "ready"
          ? { status: "ready" as const, plan: snapshot.plan }
          : snapshot.loadState;
        updateLoadState(restoredLoadState);
        if (mountedRef.current) setPlanRevision(snapshot.revision);
        return editorError;
      };

      updateSaveState("saving");
      updateSaveError(null);
      try {
        await retirementCoordinator.queue(projectPath, async () => {
          const latestBeforeSave = planRef.current;
          if (
            !mountedRef.current ||
            !latestBeforeSave ||
            planRevisionRef.current !== snapshot.revision ||
            hashPreshotDocument(latestBeforeSave.document) !==
              input.expectedDocumentHash
          ) {
            throw new AgentDomainError(
              "proposal_stale",
              "proposal",
              "The document changed before proposal persistence started",
            );
          }
          await service.savePlan(projectPath, input.targetPlan);
          targetPersisted = true;

          const latestAfterSave = planRef.current;
          if (!mountedRef.current) {
            await service.savePlan(projectPath, snapshot.plan);
            manifestReconciled = true;
            throw new AgentDomainError(
              "project_deleted",
              "workspace",
              "The project retired while the proposal was being saved",
            );
          }
          if (
            !latestAfterSave ||
            planRevisionRef.current !== snapshot.revision ||
            hashPreshotDocument(latestAfterSave.document) !==
              input.expectedDocumentHash
          ) {
            if (!latestAfterSave) {
              await service.savePlan(projectPath, snapshot.plan);
            } else {
              await service.savePlan(projectPath, latestAfterSave);
              savedRef.current = JSON.stringify(latestAfterSave);
              updateSaveState("saved");
              updateSaveError(null);
              publishAgentPlan(
                latestAfterSave,
                planRevisionRef.current,
                "saved",
              );
            }
            manifestReconciled = true;
            throw new AgentDomainError(
              "proposal_stale",
              "proposal",
              "The document changed while the proposal was being saved",
            );
          }
        });

        editorPublishAttempted = true;
        transact(input.targetPlan.document);
        planRef.current = input.targetPlan;
        planRevisionRef.current = input.committedRevision;
        savedRef.current = JSON.stringify(input.targetPlan);
        publishAgentPlan(
          input.targetPlan,
          input.committedRevision,
          "saved",
        );
        metadataListenersRef.current.forEach((listener) => listener());
        updateSaveState("saved");
        updateSaveError(null);
        updateLoadState({ status: "ready", plan: input.targetPlan });
        if (mountedRef.current) setPlanRevision(input.committedRevision);
      } catch (error) {
        if (manifestReconciled && !editorPublishAttempted) throw error;

        const editorRollbackError = restoreSnapshot();
        let persistenceRollbackError: unknown;
        if (targetPersisted && !manifestReconciled) {
          try {
            await retirementCoordinator.queue(
              projectPath,
              () => service.savePlan(projectPath, snapshot.plan),
            );
          } catch (rollbackError) {
            persistenceRollbackError = rollbackError;
          }
        }
        if (editorRollbackError || persistenceRollbackError) {
          const rollbackMessages = [
            editorRollbackError instanceof Error
              ? editorRollbackError.message
              : editorRollbackError
                ? String(editorRollbackError)
                : "",
            persistenceRollbackError instanceof Error
              ? persistenceRollbackError.message
              : persistenceRollbackError
                ? String(persistenceRollbackError)
                : "",
          ].filter(Boolean).join("; ");
          throw new AgentDomainError(
            "proposal_apply_conflict",
            "proposal",
            `Proposal transaction failed and rollback was incomplete: ${rollbackMessages}`,
            { cause: error },
          );
        }
        throw error;
      }
    });
  }, [
    enqueueImageMutation,
    projectPath,
    proposalProjectId,
    publishAgentPlan,
    retirementCoordinator,
    service,
    updateLoadState,
    updateSaveError,
    updateSaveState,
  ]);

  useEffect(() => {
    if (!agentWorkspace) return;
    const application: AgentProposalMutationPort = {
      async getCurrentPlan(requestedProjectId) {
        await imageMutationTailRef.current;
        const plan = planRef.current;
        if (requestedProjectId !== proposalProjectId) {
          throw new AgentDomainError(
            "project_deleted",
            "workspace",
            "The requested proposal project is not active",
          );
        }
        if (!plan || loadStateRef.current.status === "loading") {
          throw new AgentProposalTemporaryError(
            "PLAN_LOADING",
            "The requested proposal plan is still loading",
          );
        }
        if (!proposalDocumentTransactionRef.current) {
          throw new AgentProposalTemporaryError(
            "PLAN_BRIDGE_NOT_READY",
            "The BlockNote editor proposal bridge is not ready",
          );
        }
        return {
          plan: structuredClone(plan),
          revision: planRevisionRef.current,
        };
      },
      async applyAtomically(input) {
        await runAgentPlanTransaction({
          ...input,
          targetPlan: input.projectedPlan,
          committedRevision: input.expectedRevision + 1,
          conflictCode: "proposal_stale",
          conflictMessage:
            "The document changed before the proposal could be applied",
        });
      },
      async restoreCheckpointAtomically(input) {
        await runAgentPlanTransaction({
          ...input,
          targetPlan: input.restoredPlan,
          committedRevision: input.expectedRevision + 1,
          conflictCode: "proposal_apply_conflict",
          conflictMessage: "Affected blocks changed before Undo this apply",
        });
      },
      async rollbackAtomically(input) {
        await runAgentPlanTransaction({
          ...input,
          targetPlan: input.snapshotPlan,
          committedRevision: input.snapshotRevision,
          conflictCode: "proposal_apply_conflict",
          conflictMessage:
            "The document changed before proposal reconciliation",
        });
      },
    };
    const registration = agentWorkspace.registerProposalApplication(
      proposalProjectId,
      application,
    );
    proposalApplicationRegistrationRef.current = registration;
    registration.setReady(
      loadStateRef.current.status === "ready" &&
        proposalDocumentTransactionRef.current !== null,
    );
    return () => {
      if (proposalApplicationRegistrationRef.current === registration) {
        proposalApplicationRegistrationRef.current = null;
      }
      registration.unregister();
    };
  }, [
    agentWorkspace,
    proposalProjectId,
    runAgentPlanTransaction,
  ]);

  const registerProposalDocumentTransaction = useCallback(
    (applyDocument: (document: PreshotBlockDocument) => void) => {
      proposalDocumentTransactionRef.current = applyDocument;
      proposalApplicationRegistrationRef.current?.setReady(true);
      return () => {
        if (proposalDocumentTransactionRef.current === applyDocument) {
          proposalDocumentTransactionRef.current = null;
          proposalApplicationRegistrationRef.current?.setReady(false);
        }
      };
    },
    [],
  );

  const reportImageMutationFailure = useCallback((error: unknown) => {
    if (!mountedRef.current) return;
    setCanvasError(error instanceof Error ? error.message : String(error));
  }, []);

  const selectImageForAgent = useCallback((
    groupId: string,
    imageId: string,
    open: boolean,
  ): boolean => {
    const current = planRef.current;
    const group = current && allCollectionGroups(current).find((entry) =>
      entry.id === groupId
    );
    const image = group?.images.find((entry) => entry.id === imageId);
    const source = image ? imageSrcRef.current[image.file] : undefined;
    if (!group || !image || !source) return false;
    selectedImageIdRef.current = imageId;
    setSelectedImageId(imageId);
    if (open) {
      setLightboxTarget({ groupId, imageId, file: image.file });
    }
    if (agentWorkspace) {
      void createAgentThumbnail(source)
        .then((thumbnailDataUrl) => {
          if (selectedImageIdRef.current !== imageId) return;
          agentWorkspace.publishSelectedImage({
            groupId,
            imageId,
            displayName: image.file.split(/[\\/]/).at(-1) ?? "image",
            relativeFile: image.file,
            thumbnailDataUrl,
          });
        })
        .catch(reportImageMutationFailure);
    }
    window.requestAnimationFrame(() => {
      const escapedId = typeof CSS !== "undefined" && CSS.escape
        ? CSS.escape(imageId)
        : imageId.replaceAll('"', '\\"');
      const target = document.querySelector<HTMLElement>(
        `[data-image-id="${escapedId}"]`,
      );
      target?.scrollIntoView?.({ block: "center", behavior: "smooth" });
      target?.setAttribute("data-agent-citation-highlight", "true");
      if (target) {
        window.setTimeout(() => {
          target.removeAttribute("data-agent-citation-highlight");
        }, 2_000);
      }
    });
    return true;
  }, [agentWorkspace, reportImageMutationFailure]);

  useEffect(() => agentWorkspace?.registerImageNavigator({
    selectImage: selectImageForAgent,
  }), [agentWorkspace, selectImageForAgent]);

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
      if (agentWorkspace && selectedImageIdRef.current === imageId) {
        const thumbnailDataUrl = await createAgentThumbnail(result.dataUrl);
        if (selectedImageIdRef.current === imageId) {
          agentWorkspace.publishSelectedImage({
            groupId,
            imageId,
            displayName:
              result.image.file.split(/[\\/]/).at(-1) ?? "image",
            relativeFile: result.image.file,
            thumbnailDataUrl,
          });
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
    agentWorkspace,
    applyPlan,
    enqueueImageMutation,
    projectPath,
    service,
  ]);

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
          updateLoadState(result);
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
        publishAgentPlan(plan, planRevisionRef.current, initialSaveState);
        setMigrationNotice(
          migration.migratedImageCount > 0
            ? `已升级 ${migration.migratedImageCount} 张旧版默认尺寸图片；自定义尺寸未更改。请确认排版，系统将自动保存。`
            : result.status === "migrated"
              ? "项目已安全升级为素材组件格式；原有内容和图片组未更改。"
              : null,
        );
        const files = new Set(
          allCollectionGroups(plan).flatMap((group) =>
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
          const measuredSaveState = JSON.stringify(measured) === savedRef.current
            ? "saved"
            : "unsaved";
          publishAgentPlan(
            measured,
            planRevisionRef.current,
            measuredSaveState,
          );
          setPlanRevision(planRevisionRef.current);
          updateSaveState(measuredSaveState);
          updateLoadState({ status: "ready", plan: measured });
        }).catch((error: unknown) => {
          if (cancelled) return;
          updateLoadState({
            status: "failed",
            message: error instanceof Error ? error.message : String(error),
          });
        });
      },
      (error: unknown) => {
        if (cancelled) return;
        updateLoadState({
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
    publishAgentPlan,
    updateLoadState,
    updateSaveState,
  ]);

  useEffect(() => () => {
    void retirementCoordinator
      .queue(projectPath, async () => {
        await captureTaskRef.current;
        await imageMutationTailRef.current;
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

  const resolveMediaUrl = useCallback(
    (url: string): string => mediaSrcRef.current[url] ?? url,
    [],
  );

  const persistMediaUrl = useCallback((url: string): string => {
    for (const [file, dataUrl] of Object.entries(mediaSrcRef.current)) {
      if (dataUrl === url) return file;
    }
    return url;
  }, []);

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
  const artifactController: ArtifactBlockController = {
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
          throw new Error("素材更新不能改变 artifactId 或类型");
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
          throw new Error("素材更新不能改变 artifactId 或类型");
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
      const current = planRef.current;
      if (!current) return undefined;
      return allCollectionGroups(current).find((group) => group.id === groupId);
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
      if (selectedImageId === imageId) {
        selectedImageIdRef.current = null;
        setSelectedImageId(null);
        agentWorkspace?.publishSelectedImage(null);
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
      if (group) selectImageForAgent(group.id, imageId, false);
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
      applyPlan(replaceArtifactCollection(
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
      ));
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
            imageGroupOrder={allCollectionIdsInDocumentOrder(loadState.plan)}
            imageGroups={allCollectionGroups(loadState.plan)}
            imageSources={imageSrc}
            onMoveImage={imageGroupController.moveImage}
            planRevision={planRevision}
            projectKey={projectPath}
            scrollContainerRef={scrollerRef}
          >
            <BlockNoteDocumentEditor
              agentWorkspace={agentWorkspace}
              ariaLabel="方案正文"
              artifactController={artifactController}
              document={loadState.plan.document}
              imageGroupController={imageGroupController}
              key={`${projectPath}:${loadState.plan.schemaVersion}`}
              onChange={updateDocument}
              onDocumentTransactionReady={registerProposalDocumentTransaction}
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
