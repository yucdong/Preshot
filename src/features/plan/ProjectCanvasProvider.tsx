import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  EMPTY_PLAN,
  DEFAULT_IMAGE_HEIGHT,
  UNTITLED_PLAN_TITLE,
  type ProjectPlan,
} from "../../domain/plan/canvas/models";
import { A4 } from "../../domain/plan/canvas/geometry";
import type { PlanImagePicker, ScreenCapture } from "../../domain/plan/ports";
import type { CanvasPlanService } from "../../domain/plan/canvas/service";
import type { WorkspaceLogger } from "../../domain/workspace/ports";
import type {
  PdfSaveTarget,
  PdfRevealTarget,
} from "../../domain/plan/canvas/ports";
import {
  addComponent,
  addReferenceImage,
  addReferenceImages,
  moveComponent,
  moveImage,
  moveImages,
  removeComponent as removePlanComponent,
  removeReferenceImage,
  resizeComponent,
  updatePlanHtml,
  setReferenceDescription,
  toggleReferenceCaptions,
  setImageCaption,
  setImageAspectRatioForFile,
  setImageHeight,
  type MoveImageParams,
  type MoveImagesParams,
  type ComponentMoveTarget,
} from "../../domain/plan/canvas/plan";
import {
  nextComponentName,
  renameComponent,
  setPlanTitle,
} from "../../domain/plan/canvas/naming";
import {
  createHistory,
  record as recordHistory,
  undo as undoHistory,
  redo as redoHistory,
  mergeStructural,
  type PlanHistory,
} from "../../domain/plan/canvas/history";
import { PlanCanvas } from "./canvas/PlanCanvas";
import type { PlanMeasurement } from "./canvas/usePlanContentMeasurement";
import { ReferenceImageLightbox } from "./ReferenceImageLightbox";
import { CanvasToolbar } from "./canvas/CanvasToolbar";
import type { SaveState } from "./SaveStatus";
import { getProjectRetirementCoordinator } from "./projectRetirementCoordinator";
import type { ImageImportProgress } from "./imageImportProgress";

export interface CanvasPlanDependencies {
  service: CanvasPlanService;
  picker: PlanImagePicker;
  screenCapture?: ScreenCapture;
  logger: WorkspaceLogger;
  exporter: { export(plan: ProjectPlan, images: Record<string, string>): Promise<Uint8Array> };
  saver: PdfSaveTarget;
  reveal: PdfRevealTarget;
}

interface ProjectCanvasProviderProps {
  projectPath: string;
  projectName: string;
  dependencies: CanvasPlanDependencies;
}

interface MeasurementState<T> {
  projectPath: string;
  values: ReadonlyMap<string, T>;
}

type ProviderLifecycleStatus = "loading" | "ready" | "failed";

interface ProviderLifecycleState {
  projectPath: string;
  generation: number;
  status: ProviderLifecycleStatus;
}

interface ProjectToken {
  projectPath: string;
  generation: number;
}

interface ProjectPersistenceState {
  token: ProjectToken;
  plan: ProjectPlan;
  savedSnapshot: string;
  pending: Promise<void> | null;
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameToken(a: ProjectToken | null, b: ProjectToken): boolean {
  return a?.projectPath === b.projectPath && a.generation === b.generation;
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function plansEqual(a: ProjectPlan, b: ProjectPlan): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

function trackPersistence(
  state: ProjectPersistenceState,
  operation: Promise<void>,
): Promise<void> {
  const previous = state.pending ?? Promise.resolve();
  const settled = operation.then(
    () => undefined,
    () => undefined,
  );
  const pending = Promise.all([previous, settled]).then(() => undefined);
  state.pending = pending;
  void pending.then(() => {
    if (state.pending === pending) {
      state.pending = null;
    }
  });
  return operation;
}

function expectedReferenceImageFiles(plan: ProjectPlan): string[] {
  return Array.from(
    new Set(
      plan.components.flatMap((component) =>
        component.type === "reference"
          ? component.images.map((image) => image.file)
          : [],
      ),
    ),
  );
}

function isTextEditingTarget(node: EventTarget | null): boolean {
  if (!(node instanceof HTMLElement)) return false;
  if (node.isContentEditable) return true;
  if (node.tagName === "INPUT" || node.tagName === "TEXTAREA") return true;
  return node.closest('.bn-editor, .ProseMirror, [contenteditable="true"]') !== null;
}

async function measureAspectRatio(dataUrl: string): Promise<number> {
  const img = new Image();
  img.src = dataUrl;
  try {
    await img.decode();
    return img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
  } catch {
    return 1;
  }
}

const AUTO_SAVE_INTERVAL_MS = 5000;
const SCREEN_CAPTURE_POLL_INTERVAL_MS = 250;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

export function ProjectCanvasProvider({
  projectPath,
  projectName,
  dependencies,
}: ProjectCanvasProviderProps) {
  const { t } = useTranslation();
  const { service, picker, screenCapture, logger, exporter, saver, reveal } = dependencies;
  const retirementCoordinator = useMemo(
    () => getProjectRetirementCoordinator(service),
    [service],
  );
  const [plan, setPlan] = useState<ProjectPlan>(EMPTY_PLAN);
  const [imageSrc, setImageSrc] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [exporting, setExporting] = useState(false);
  const [imageImportProgress, setImageImportProgress] = useState<{
    componentId: string;
    progress: ImageImportProgress;
  } | null>(null);
  const [screenCaptureState, setScreenCaptureState] = useState<{
    componentId: string;
    status: "waiting" | "importing";
  } | null>(null);
  const [scale, setScale] = useState(0.5);
  const [lifecycle, setLifecycle] = useState<ProviderLifecycleState>({
    projectPath,
    generation: 0,
    status: "loading",
  });
  const [planMeasurements, setPlanMeasurements] = useState<MeasurementState<PlanMeasurement>>({
    projectPath,
    values: new Map(),
  });
  const [referenceDescriptionHeights, setReferenceDescriptionHeights] = useState<MeasurementState<number>>({
    projectPath,
    values: new Map(),
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const activeProjectPathRef = useRef(projectPath);
  const generationRef = useRef(0);
  const lifecycleRef = useRef(lifecycle);
  const busyRef = useRef<ProjectToken | null>(null);
  const planRef = useRef(plan);
  const imageSrcRef = useRef(imageSrc);
  const savingRef = useRef<ProjectToken | null>(null);
  const lastSavedRef = useRef(JSON.stringify(EMPTY_PLAN));
  const projectPersistenceRef = useRef<ProjectPersistenceState | null>(null);
  const retiredPersistencesRef = useRef(new WeakSet<ProjectPersistenceState>());
  const retireProjectRef = useRef(
    (
      _token: ProjectToken,
      _persistence: ProjectPersistenceState,
      _remainsRetired: () => boolean = () => true,
    ) => {},
  );
  const historyRef = useRef<PlanHistory>(createHistory());
  const captureGenerationRef = useRef(0);
  const captureTokenRef = useRef<string | null>(null);
  const captureProjectTokenRef = useRef<ProjectToken | null>(null);
  const lifecycleStatus =
    lifecycle.projectPath === projectPath ? lifecycle.status : "loading";

  const isTokenCurrent = useCallback(
    (token: ProjectToken) =>
      mountedRef.current &&
      activeProjectPathRef.current === token.projectPath &&
      generationRef.current === token.generation,
    [],
  );

  const isTokenReady = useCallback(
    (token: ProjectToken) => {
      const current = lifecycleRef.current;
      return (
        isTokenCurrent(token) &&
        current.projectPath === token.projectPath &&
        current.generation === token.generation &&
        current.status === "ready"
      );
    },
    [isTokenCurrent],
  );

  const readyTokenFor = useCallback((path: string): ProjectToken | null => {
    const current = lifecycleRef.current;
    if (
      activeProjectPathRef.current !== path ||
      current.projectPath !== path ||
      current.status !== "ready"
    ) {
      return null;
    }
    return { projectPath: path, generation: current.generation };
  }, []);

  const syncSaveState = useCallback(() => {
    const current = lifecycleRef.current;
    if (
      current.status !== "ready" ||
      current.projectPath !== activeProjectPathRef.current
    ) {
      setSaveState("saved");
      return;
    }
    const token = {
      projectPath: current.projectPath,
      generation: current.generation,
    };
    setSaveState(
      sameToken(savingRef.current, token)
        ? "saving"
        : JSON.stringify(planRef.current) === lastSavedRef.current
          ? "saved"
          : "unsaved",
    );
  }, []);

  const applyPlan = useCallback(
    (next: ProjectPlan) => {
      if (next === planRef.current) {
        return false;
      }
      planRef.current = next;
      const persistence = projectPersistenceRef.current;
      const current = lifecycleRef.current;
      if (
        persistence &&
        current.status === "ready" &&
        sameToken(persistence.token, current)
      ) {
        persistence.plan = next;
      }
      setPlan(next);
      syncSaveState();
      return true;
    },
    [syncSaveState],
  );

  const measurements = useMemo(
    () => ({
      planHeights: new Map(
        Array.from(
          (planMeasurements.projectPath === projectPath ? planMeasurements.values : new Map()).entries(),
          ([id, measurement]) => [id, measurement.heightPoints],
        ),
      ),
      referenceDescriptionHeights:
        referenceDescriptionHeights.projectPath === projectPath
          ? referenceDescriptionHeights.values
          : new Map<string, number>(),
    }),
    [planMeasurements, projectPath, referenceDescriptionHeights],
  );

  const recordHistoryEntry = useCallback(
    (previous: ProjectPlan, coalesceKey?: string) => {
      historyRef.current = recordHistory(historyRef.current, previous, { coalesceKey });
    },
    [],
  );

  const mutate = useCallback(
    (next: ProjectPlan, coalesceKey?: string) => {
      if (!readyTokenFor(projectPath) || next === planRef.current) {
        return;
      }
      recordHistoryEntry(planRef.current, coalesceKey);
      applyPlan(next);
    },
    [applyPlan, projectPath, readyTokenFor, recordHistoryEntry],
  );

  const undo = useCallback(() => {
    const token = readyTokenFor(projectPath);
    if (!token || sameToken(busyRef.current, token)) return;
    const outcome = undoHistory(historyRef.current, planRef.current);
    if (!outcome) return;
    historyRef.current = outcome.history;
    applyPlan(mergeStructural(outcome.next, planRef.current));
  }, [applyPlan, projectPath, readyTokenFor]);

  const redo = useCallback(() => {
    const token = readyTokenFor(projectPath);
    if (!token || sameToken(busyRef.current, token)) return;
    const outcome = redoHistory(historyRef.current, planRef.current);
    if (!outcome) return;
    historyRef.current = outcome.history;
    applyPlan(mergeStructural(outcome.next, planRef.current));
  }, [applyPlan, projectPath, readyTokenFor]);

  const markSaved = useCallback(
    (saved: ProjectPlan, token: ProjectToken) => {
      if (!isTokenReady(token)) {
        return;
      }
      lastSavedRef.current = JSON.stringify(saved);
      syncSaveState();
    },
    [isTokenReady, syncSaveState],
  );

  const rebaseServiceDelta = useCallback(
    async (
      token: ProjectToken,
      persistence: ProjectPersistenceState,
      operationPlan: ProjectPlan,
      rebase: (latest: ProjectPlan) => ProjectPlan,
    ) => {
      const previous = persistence.plan;
      const next = rebase(previous);
      const rebasedCurrentOperationPlan = plansEqual(previous, operationPlan);
      persistence.plan = next;
      if (rebasedCurrentOperationPlan) {
        persistence.savedSnapshot = JSON.stringify(next);
      }
      if (!isTokenReady(token)) {
        return;
      }
      if (!plansEqual(next, previous)) {
        recordHistoryEntry(previous);
        applyPlan(next);
      }
      if (!rebasedCurrentOperationPlan) {
        await service.savePlan(projectPath, next);
        persistence.savedSnapshot = JSON.stringify(next);
      }
      markSaved(next, token);
    },
    [
      applyPlan,
      isTokenReady,
      markSaved,
      projectPath,
      recordHistoryEntry,
      service,
    ],
  );

  const applyMeasuredAspectRatios = useCallback(
    (
      token: ProjectToken,
      persistence: ProjectPersistenceState,
      measurements: ReadonlyArray<{ file: string; aspectRatio: number }>,
    ) => {
      const next = measurements.reduce(
        (latest, { file, aspectRatio }) =>
          setImageAspectRatioForFile(latest, { file, aspectRatio }),
        persistence.plan,
      );
      persistence.plan = next;
      if (isTokenReady(token)) {
        applyPlan(next);
      }
    },
    [applyPlan, isTokenReady],
  );

  const persisting = useCallback(
    async (
      token: ProjectToken,
      action: (state: ProjectPersistenceState) => Promise<void>,
    ) => {
      if (!isTokenReady(token)) {
        return;
      }
      const persistence = projectPersistenceRef.current;
      if (!persistence || !sameToken(persistence.token, token)) {
        return;
      }
      savingRef.current = token;
      syncSaveState();
      try {
        await trackPersistence(persistence, action(persistence));
      } finally {
        if (sameToken(savingRef.current, token)) {
          savingRef.current = null;
        }
        if (isTokenCurrent(token)) {
          syncSaveState();
        }
      }
    },
    [isTokenCurrent, isTokenReady, syncSaveState],
  );

  const report = useCallback(
    (message: string, err: unknown, token?: ProjectToken) => {
      logger.error(message, { error: err });
      if (mountedRef.current && (!token || isTokenCurrent(token))) {
        setError(detail(err));
      }
    },
    [isTokenCurrent, logger],
  );

  const retireProject = useCallback(
    (
      retiringToken: ProjectToken,
      retiringPersistence: ProjectPersistenceState,
      remainsRetired: () => boolean = () => true,
    ) => {
      if (retiredPersistencesRef.current.has(retiringPersistence)) {
        return;
      }

      const saveLatest = async () => {
        const latestPlan = retiringPersistence.plan;
        if (JSON.stringify(latestPlan) === retiringPersistence.savedSnapshot) {
          return;
        }
        await service.savePlan(retiringToken.projectPath, latestPlan);
        retiringPersistence.savedSnapshot = JSON.stringify(latestPlan);
      };

      const retirement = retirementCoordinator.queue(
        retiringToken.projectPath,
        async () => {
          await Promise.resolve();
          if (
            !remainsRetired() ||
            retiredPersistencesRef.current.has(retiringPersistence)
          ) {
            return;
          }
          if (
            retiringPersistence.pending === null &&
            JSON.stringify(retiringPersistence.plan) === retiringPersistence.savedSnapshot
          ) {
            return;
          }

          retiredPersistencesRef.current.add(retiringPersistence);
          await retiringPersistence.pending;
          await saveLatest();
        },
      );
      void retirement.catch((err) => {
        report("Unable to auto-save the project plan", err, retiringToken);
      });
    },
    [report, retirementCoordinator, service],
  );

  useLayoutEffect(() => {
    retireProjectRef.current = retireProject;
  }, [retireProject]);

  const guard = useCallback(
    async (
      path: string,
      message: string,
      action: (token: ProjectToken) => Promise<void>,
    ) => {
      const token = readyTokenFor(path);
      if (!token || sameToken(busyRef.current, token)) {
        return;
      }
      busyRef.current = token;
      try {
        await action(token);
      } catch (err) {
        report(message, err, token);
      } finally {
        if (sameToken(busyRef.current, token)) {
          busyRef.current = null;
        }
      }
    },
    [readyTokenFor, report],
  );

  const flush = useCallback(async () => {
    const token = readyTokenFor(projectPath);
    if (
      !token ||
      sameToken(busyRef.current, token) ||
      sameToken(savingRef.current, token)
    ) {
      return;
    }
    const persistence = projectPersistenceRef.current;
    if (!persistence || !sameToken(persistence.token, token)) {
      return;
    }
    const planToSave = planRef.current;
    const snapshot = JSON.stringify(planToSave);
    if (snapshot === lastSavedRef.current) {
      return;
    }
    savingRef.current = token;
    syncSaveState();
    try {
      await trackPersistence(
        persistence,
        service.savePlan(projectPath, planToSave),
      );
      persistence.savedSnapshot = snapshot;
      if (!isTokenReady(token)) {
        return;
      }
      lastSavedRef.current = snapshot;
      setError(null);
    } catch (err) {
      if (isTokenCurrent(token)) {
        report("Unable to auto-save the project plan", err, token);
      }
    } finally {
      if (sameToken(savingRef.current, token)) {
        savingRef.current = null;
      }
      if (isTokenCurrent(token)) {
        syncSaveState();
      }
    }
  }, [
    isTokenCurrent,
    isTokenReady,
    projectPath,
    readyTokenFor,
    report,
    service,
    syncSaveState,
  ]);

  useLayoutEffect(() => {
    const retiringToken: ProjectToken = {
      projectPath: activeProjectPathRef.current,
      generation: generationRef.current,
    };
    if (retiringToken.projectPath === projectPath) {
      return;
    }
    const retiringLifecycle = lifecycleRef.current;
    const retiringPersistence = projectPersistenceRef.current;
    const shouldFlush =
      retiringLifecycle.projectPath === retiringToken.projectPath &&
      retiringLifecycle.generation === retiringToken.generation &&
      retiringLifecycle.status === "ready" &&
      retiringPersistence !== null &&
      sameToken(retiringPersistence.token, retiringToken);
    if (shouldFlush) {
      retireProject(
        retiringToken,
        retiringPersistence,
      );
    }

    generationRef.current = retiringToken.generation + 1;
    activeProjectPathRef.current = projectPath;
  }, [projectPath, retireProject]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const retiringToken: ProjectToken = {
        projectPath: activeProjectPathRef.current,
        generation: generationRef.current,
      };
      const retiringLifecycle = lifecycleRef.current;
      const retiringPersistence = projectPersistenceRef.current;
      if (
        retiringLifecycle.projectPath === retiringToken.projectPath &&
        retiringLifecycle.generation === retiringToken.generation &&
        retiringLifecycle.status === "ready" &&
        retiringPersistence !== null &&
        sameToken(retiringPersistence.token, retiringToken)
      ) {
        retireProjectRef.current(
          retiringToken,
          retiringPersistence,
          () => !mountedRef.current,
        );
      }
    };
  }, []);

  useEffect(
    () => () => {
      captureGenerationRef.current += 1;
      const nativeToken = captureTokenRef.current;
      const projectToken = captureProjectTokenRef.current;
      captureTokenRef.current = null;
      captureProjectTokenRef.current = null;
      if (projectToken && sameToken(busyRef.current, projectToken)) {
        busyRef.current = null;
      }
      if (screenCapture && nativeToken) {
        void screenCapture.cancel(nativeToken).catch((error) => {
          logger.error("Unable to clean up the screen capture", { error });
        });
      }
    },
    [logger, projectPath, screenCapture],
  );

  useEffect(() => {
    const token: ProjectToken = {
      projectPath,
      generation: generationRef.current + 1,
    };
    generationRef.current = token.generation;
    let cancelled = false;
    const isCurrent = () => !cancelled && isTokenCurrent(token);
    const setLifecycleStatus = (status: ProviderLifecycleStatus) => {
      if (!isCurrent()) {
        return;
      }
      const next = { ...token, status };
      lifecycleRef.current = next;
      setLifecycle(next);
    };

    lifecycleRef.current = { ...token, status: "loading" };
    setLifecycle({ ...token, status: "loading" });
    busyRef.current = null;
    savingRef.current = null;
    projectPersistenceRef.current = null;
    planRef.current = EMPTY_PLAN;
    imageSrcRef.current = {};
    lastSavedRef.current = JSON.stringify(EMPTY_PLAN);
    historyRef.current = createHistory();
    setPlan(EMPTY_PLAN);
    setImageSrc({});
    setLightbox(null);
    setExporting(false);
    setImageImportProgress(null);
    setScreenCaptureState(null);
    setSaveState("saved");
    setError(null);

    async function load() {
      try {
        await retirementCoordinator.waitFor(projectPath);
        await retirementCoordinator.waitForRetirements();
        const loadResult = await service.loadPlan(projectPath, projectName);
        if (!isCurrent()) return;

        let planToUse =
          loadResult.status === "loaded"
            ? loadResult.plan
            : { ...EMPTY_PLAN, title: projectName.trim() || UNTITLED_PLAN_TITLE };
        if (loadResult.status === "missing") {
          const planId = crypto.randomUUID();
          const planComponent = {
            id: planId,
            name: nextComponentName(planToUse, "plan"),
            type: "plan" as const,
            width: 1,
            contentScale: 1,
            html: t("content.planTemplate"),
          };
          const referenceId = crypto.randomUUID();
          const referenceComponent = {
            id: referenceId,
            name: nextComponentName(planToUse, "reference"),
            type: "reference" as const,
            width: 1,
            contentScale: 1,
            description: "",
            showDescription: true,
            showCaptions: true,
            imageHeight: DEFAULT_IMAGE_HEIGHT,
            images: [],
          };

          planToUse = addComponent(planToUse, referenceComponent);
          planToUse = addComponent(planToUse, planComponent);
        }

        const savedSnapshot = JSON.stringify(planToUse);
        projectPersistenceRef.current = {
          token,
          plan: planToUse,
          savedSnapshot,
          pending: null,
        };
        planRef.current = planToUse;
        lastSavedRef.current = savedSnapshot;
        historyRef.current = createHistory();
        setPlan(planToUse);
        setError(null);
        setSaveState("saved");
        setLifecycleStatus("ready");

        for (const file of expectedReferenceImageFiles(planToUse)) {
          try {
            const src = await service.loadImage(projectPath, file);
            if (!isCurrent()) return;
            const nextImageSrc = { ...imageSrcRef.current, [file]: src };
            imageSrcRef.current = nextImageSrc;
            setImageSrc(nextImageSrc);

            const aspectRatio = await measureAspectRatio(src);
            if (!isCurrent()) return;
            const next = setImageAspectRatioForFile(planRef.current, {
              file,
              aspectRatio,
            });
            applyPlan(next);
          } catch (err) {
            if (isCurrent()) {
              report("Unable to load a reference image", err, token);
            }
          }
        }
      } catch (err) {
        if (!isCurrent()) return;
        logger.error("Unable to load the project plan", { error: err });
        projectPersistenceRef.current = null;
        planRef.current = EMPTY_PLAN;
        imageSrcRef.current = {};
        lastSavedRef.current = JSON.stringify(EMPTY_PLAN);
        historyRef.current = createHistory();
        setPlan(EMPTY_PLAN);
        setImageSrc({});
        setSaveState("saved");
        setError(detail(err));
        setLifecycleStatus("failed");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [
    applyPlan,
    isTokenCurrent,
    logger,
    projectPath,
    projectName,
    report,
    retirementCoordinator,
    service,
    t,
  ]);

  useEffect(() => {
    imageSrcRef.current = imageSrc;
  }, [imageSrc]);

  const resolveExportImages = useCallback(
    async (
      planToExport: ProjectPlan,
      token: ProjectToken,
    ): Promise<Record<string, string>> => {
      const expectedFiles = expectedReferenceImageFiles(planToExport);
      const loadedEntries = await Promise.all(
        expectedFiles.map(async (file) => {
          const existing = imageSrcRef.current[file];
          if (existing) {
            return [file, existing] as const;
          }

          try {
            const src = await service.loadImage(projectPath, file);
            if (!src) {
              throw new Error("image loader returned empty data");
            }
            return [file, src] as const;
          } catch (error) {
            throw new Error(
              `Unable to export the PDF: failed to load reference image "${file}": ${detail(error)}`,
            );
          }
        }),
      );
      const resolvedImages = Object.fromEntries(loadedEntries);
      if (!isTokenReady(token)) {
        return resolvedImages;
      }
      const nextImageSrc = { ...imageSrcRef.current, ...resolvedImages };
      imageSrcRef.current = nextImageSrc;
      setImageSrc(nextImageSrc);
      return resolvedImages;
    },
    [isTokenReady, projectPath, service],
  );

  useEffect(() => {
    if (lifecycleStatus !== "ready") {
      return;
    }
    const timer = setInterval(() => {
      void flush();
    }, AUTO_SAVE_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      void flush();
    };
  }, [flush, lifecycleStatus]);

  useEffect(() => {
    if (lifecycleStatus !== "ready") {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && (event.key === "s" || event.key === "S")) {
        event.preventDefault();
        void flush();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [flush, lifecycleStatus]);

  useEffect(() => {
    if (lifecycleStatus !== "ready") {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      if (isTextEditingTarget(document.activeElement)) return; // BlockNote owns it
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [lifecycleStatus, undo, redo]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) {
        setScale(width / A4.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const handleInsert = useCallback(
    (type: "plan" | "reference") => {
      if (!readyTokenFor(projectPath)) {
        return;
      }
      if (type === "plan") {
        const id = crypto.randomUUID();
        const newComponent = {
          id,
          name: nextComponentName(planRef.current, "plan"),
          type: "plan" as const,
          width: 1,
          contentScale: 1,
          html: t("content.planTemplate"),
        };
        mutate(addComponent(planRef.current, newComponent));
      } else {
        const id = crypto.randomUUID();
        const newComponent = {
          id,
          name: nextComponentName(planRef.current, "reference"),
          type: "reference" as const,
          width: 1,
          contentScale: 1,
          description: "",
          showDescription: true,
          showCaptions: true,
          imageHeight: DEFAULT_IMAGE_HEIGHT,
          images: [],
        };
        mutate(addComponent(planRef.current, newComponent));
      }
    },
    [mutate, projectPath, readyTokenFor, t],
  );

  const handleRemoveComponent = useCallback(
    (id: string) => {
      void guard(projectPath, "Unable to remove the component", (token) =>
        persisting(token, async (persistence) => {
          const operationPlan = persistence.plan;
          const persisted = await service.removeComponent(
            projectPath,
            operationPlan,
            id,
          );
          if (plansEqual(persisted, operationPlan)) {
            return;
          }
          await rebaseServiceDelta(
            token,
            persistence,
            operationPlan,
            (latest) => removePlanComponent(latest, id),
          );
          if (!isTokenReady(token)) return;
          setError(null);
        }),
      );
    },
    [
      guard,
      isTokenReady,
      persisting,
      projectPath,
      rebaseServiceDelta,
      service,
    ],
  );

  const handleMoveComponent = useCallback(
    (id: string, target: ComponentMoveTarget) => {
      if (!readyTokenFor(projectPath)) return;
      const next = moveComponent(planRef.current, { id, ...target });
      mutate(next);
    },
    [mutate, projectPath, readyTokenFor],
  );

  const handleMoveImage = useCallback(
    (params: MoveImageParams) => {
      const token = readyTokenFor(projectPath);
      if (!token || sameToken(busyRef.current, token)) return;
      const next = moveImage(planRef.current, params);
      mutate(next);
    },
    [mutate, projectPath, readyTokenFor],
  );

  const handleMoveImages = useCallback(
    (params: MoveImagesParams) => {
      const token = readyTokenFor(projectPath);
      if (!token || sameToken(busyRef.current, token)) return;
      mutate(moveImages(planRef.current, params));
    },
    [mutate, projectPath, readyTokenFor],
  );

  const handleResize = useCallback(
    (id: string, params: { width: number }) => {
      if (!readyTokenFor(projectPath)) return;
      const next = resizeComponent(planRef.current, { id, width: params.width });
      mutate(next, `resize:${id}`);
    },
    [mutate, projectPath, readyTokenFor],
  );

  const handleChangeHtml = useCallback(
    (id: string, html: string) => {
      if (!readyTokenFor(projectPath)) return;
      const next = updatePlanHtml(planRef.current, { id, html });
      applyPlan(next);
    },
    [applyPlan, projectPath, readyTokenFor],
  );

  const handleSetTitle = useCallback(
    (title: string) => {
      const result = setPlanTitle(planRef.current, title);
      if (result.ok && !plansEqual(result.plan, planRef.current)) {
        mutate(result.plan);
      }
      return result;
    },
    [mutate],
  );

  const handleRenameComponent = useCallback(
    (id: string, name: string) => {
      const result = renameComponent(planRef.current, id, name);
      if (result.ok && !plansEqual(result.plan, planRef.current)) {
        mutate(result.plan);
      }
      return result;
    },
    [mutate],
  );

  const handleSetDescription = useCallback(
    (id: string, description: string) => {
      if (!readyTokenFor(projectPath)) return;
      const next = setReferenceDescription(planRef.current, id, description);
      applyPlan(next);
    },
    [applyPlan, projectPath, readyTokenFor],
  );

  const handleSetImageHeight = useCallback(
    (id: string, imageHeight: number) => {
      if (!readyTokenFor(projectPath)) return;
      const next = setImageHeight(planRef.current, id, imageHeight);
      mutate(next, `imageHeight:${id}`);
    },
    [mutate, projectPath, readyTokenFor],
  );

  const handleToggleCaptions = useCallback(
    (id: string) => {
      if (!readyTokenFor(projectPath)) return;
      const next = toggleReferenceCaptions(planRef.current, id);
      mutate(next);
    },
    [mutate, projectPath, readyTokenFor],
  );

  const handleSetImageCaption = useCallback(
    (componentId: string, imageId: string, caption: string) => {
      if (!readyTokenFor(projectPath)) return;
      const next = setImageCaption(planRef.current, { componentId, imageId, caption });
      mutate(next);
    },
    [mutate, projectPath, readyTokenFor],
  );

  const handleMeasurePlan = useCallback((id: string, next: PlanMeasurement) => {
    if (!readyTokenFor(projectPath)) {
      return;
    }
    if (!Number.isFinite(next.heightPoints) || next.heightPoints < 0) {
      return;
    }

    const pageBreakBeforeBlockIds = next.pageBreakBeforeBlockIds.filter(
      (blockId): blockId is string => typeof blockId === "string" && blockId.length > 0,
    );
    setPlanMeasurements((current) => {
      const values = current.projectPath === projectPath ? current.values : new Map<string, PlanMeasurement>();
      const previous = values.get(id);
      if (
        previous &&
        Math.abs(previous.heightPoints - next.heightPoints) < 1 &&
        arraysEqual(previous.pageBreakBeforeBlockIds, pageBreakBeforeBlockIds)
      ) {
        return current;
      }

      const updated = new Map(values);
      updated.set(id, { heightPoints: next.heightPoints, pageBreakBeforeBlockIds });
      return { projectPath, values: updated };
    });
  }, [projectPath, readyTokenFor]);

  const handleMeasureReferenceDescription = useCallback((id: string, heightPoints: number) => {
    if (!readyTokenFor(projectPath)) {
      return;
    }
    if (!Number.isFinite(heightPoints) || heightPoints < 0) {
      return;
    }

    setReferenceDescriptionHeights((current) => {
      const values = current.projectPath === projectPath ? current.values : new Map<string, number>();
      const previous = values.get(id);
      if (previous !== undefined && Math.abs(previous - heightPoints) < 1) {
        return current;
      }

      const updated = new Map(values);
      updated.set(id, heightPoints);
      return { projectPath, values: updated };
    });
  }, [projectPath, readyTokenFor]);

  const handleCancelScreenCapture = useCallback(() => {
    captureGenerationRef.current += 1;
    const nativeToken = captureTokenRef.current;
    const projectToken = captureProjectTokenRef.current;
    captureTokenRef.current = null;
    captureProjectTokenRef.current = null;
    setScreenCaptureState(null);
    if (projectToken && sameToken(busyRef.current, projectToken)) {
      busyRef.current = null;
    }
    if (screenCapture && nativeToken) {
      void screenCapture.cancel(nativeToken).catch((error) => {
        logger.error("Unable to cancel the screen capture", { error });
      });
    }
  }, [logger, screenCapture]);

  const handleCaptureImage = useCallback(
    (componentId: string) => {
      const token = readyTokenFor(projectPath);
      if (
        !screenCapture ||
        !token ||
        busyRef.current ||
        captureTokenRef.current
      ) {
        return;
      }

      const generation = captureGenerationRef.current + 1;
      captureGenerationRef.current = generation;
      captureProjectTokenRef.current = token;
      busyRef.current = token;

      void (async () => {
        let nativeToken: string | null = null;
        try {
          nativeToken = await screenCapture.start();
          if (
            captureGenerationRef.current !== generation ||
            !isTokenCurrent(token)
          ) {
            await screenCapture.cancel(nativeToken);
            return;
          }
          captureTokenRef.current = nativeToken;
          setScreenCaptureState({ componentId, status: "waiting" });

          for (;;) {
            if (
              captureGenerationRef.current !== generation ||
              !isTokenCurrent(token)
            ) {
              return;
            }
            const result = await screenCapture.poll(nativeToken);
            if (
              captureGenerationRef.current !== generation ||
              !isTokenCurrent(token)
            ) {
              return;
            }
            if (result.status === "pending") {
              await wait(SCREEN_CAPTURE_POLL_INTERVAL_MS);
              continue;
            }

            captureTokenRef.current = null;
            nativeToken = null;
            if (isTokenReady(token)) {
              setScreenCaptureState({ componentId, status: "importing" });
            }
            await persisting(token, async (persistence) => {
              const operationPlan = persistence.plan;
              const imported = await service.importImage(
                projectPath,
                operationPlan,
                componentId,
                result.path,
              );
              await rebaseServiceDelta(
                token,
                persistence,
                operationPlan,
                (latest) =>
                  addReferenceImage(latest, {
                    componentId,
                    image: imported.image,
                  }),
              );
              const aspectRatio = await measureAspectRatio(imported.dataUrl);
              applyMeasuredAspectRatios(token, persistence, [
                { file: imported.image.file, aspectRatio },
              ]);
              if (!isTokenReady(token)) {
                return;
              }
              const nextImageSrc = {
                ...imageSrcRef.current,
                [imported.image.file]: imported.dataUrl,
              };
              imageSrcRef.current = nextImageSrc;
              setImageSrc(nextImageSrc);
              setError(null);
            });
            return;
          }
        } catch (error) {
          if (captureGenerationRef.current === generation) {
            report("Unable to capture a reference image", error, token);
          }
        } finally {
          if (nativeToken) {
            void screenCapture.cancel(nativeToken).catch((error) => {
              logger.error("Unable to clean up the screen capture", { error });
            });
          }
          if (captureGenerationRef.current === generation) {
            captureTokenRef.current = null;
            captureProjectTokenRef.current = null;
            if (sameToken(busyRef.current, token)) {
              busyRef.current = null;
            }
            if (isTokenCurrent(token)) {
              setScreenCaptureState(null);
            }
          }
        }
      })();
    },
    [
      applyMeasuredAspectRatios,
      isTokenCurrent,
      isTokenReady,
      logger,
      persisting,
      projectPath,
      readyTokenFor,
      rebaseServiceDelta,
      report,
      screenCapture,
      service,
    ],
  );

  const handleAddImage = useCallback(
    (componentId: string) => {
      void guard(projectPath, "Unable to import the reference image", async (token) => {
        const sourcePath = await picker.pickImageFile("Select a JPG or PNG reference image");
        if (sourcePath === null || !isTokenReady(token)) return;
        await persisting(token, async (persistence) => {
          const operationPlan = persistence.plan;
          const result = await service.importImage(
            projectPath,
            operationPlan,
            componentId,
            sourcePath,
          );
          if (plansEqual(result.plan, operationPlan)) {
            return;
          }
          await rebaseServiceDelta(
            token,
            persistence,
            operationPlan,
            (latest) =>
              addReferenceImage(latest, {
                componentId,
                image: result.image,
              }),
          );
          const aspectRatio = await measureAspectRatio(result.dataUrl);
          applyMeasuredAspectRatios(token, persistence, [
            { file: result.image.file, aspectRatio },
          ]);
          if (!isTokenReady(token)) return;

          const nextImageSrc = {
            ...imageSrcRef.current,
            [result.image.file]: result.dataUrl,
          };
          imageSrcRef.current = nextImageSrc;
          setImageSrc(nextImageSrc);
          setError(null);
        });
      });
    },
    [
      applyMeasuredAspectRatios,
      guard,
      isTokenReady,
      persisting,
      picker,
      projectPath,
      rebaseServiceDelta,
      service,
    ],
  );

  const handleAddImages = useCallback(
    (componentId: string) => {
      void guard(projectPath, "Unable to import reference images", async (token) => {
        const sourcePaths = await picker.pickImageFiles("Select JPG or PNG reference images");
        if (sourcePaths.length === 0 || !isTokenReady(token)) return;

        setImageImportProgress({
          componentId,
          progress: { completed: 0, total: sourcePaths.length, failed: 0 },
        });
        try {
          await persisting(token, async (persistence) => {
            const operationPlan = persistence.plan;
            let persistedPlan = operationPlan;
            let failed = 0;
            const newImages: Array<{
              image: { id: string; file: string; aspectRatio: number };
              measuredAspectRatio: number;
              dataUrl: string;
            }> = [];

            for (const [index, sourcePath] of sourcePaths.entries()) {
              try {
                const result = await service.importImage(
                  projectPath,
                  persistedPlan,
                  componentId,
                  sourcePath,
                );
                persistedPlan = result.plan;
                const aspectRatio = await measureAspectRatio(result.dataUrl);
                newImages.push({
                  image: result.image,
                  measuredAspectRatio: aspectRatio,
                  dataUrl: result.dataUrl,
                });
              } catch (error) {
                failed += 1;
                logger.error("Unable to import an image from a selected batch", {
                  index,
                  error,
                });
              } finally {
                if (isTokenReady(token)) {
                  setImageImportProgress({
                    componentId,
                    progress: {
                      completed: index + 1,
                      total: sourcePaths.length,
                      failed,
                    },
                  });
                }
              }
            }

            if (newImages.length > 0) {
              await rebaseServiceDelta(
                token,
                persistence,
                operationPlan,
                (latest) =>
                  addReferenceImages(latest, {
                    componentId,
                    images: newImages.map(({ image }) => image),
                  }),
              );
              applyMeasuredAspectRatios(
                token,
                persistence,
                newImages.map(({ image, measuredAspectRatio }) => ({
                  file: image.file,
                  aspectRatio: measuredAspectRatio,
                })),
              );
            }
            if (!isTokenReady(token)) {
              return;
            }

            const newSrcMap: Record<string, string> = {};
            for (const { image, dataUrl } of newImages) {
              newSrcMap[image.file] = dataUrl;
            }
            const nextImageSrc = { ...imageSrcRef.current, ...newSrcMap };
            imageSrcRef.current = nextImageSrc;
            setImageSrc(nextImageSrc);
            setError(
              failed > 0
                ? t("reference.importSummary", {
                    succeeded: newImages.length,
                    failed,
                  })
                : null,
            );
          });
        } finally {
          if (isTokenCurrent(token)) {
            setImageImportProgress(null);
          }
        }
      });
    },
    [
      applyMeasuredAspectRatios,
      guard,
      isTokenCurrent,
      isTokenReady,
      logger,
      persisting,
      picker,
      projectPath,
      rebaseServiceDelta,
      service,
      t,
    ],
  );

  const handleRemoveImage = useCallback(
    (componentId: string, imageId: string) => {
      void guard(projectPath, "Unable to remove the reference image", (token) =>
        persisting(token, async (persistence) => {
          const operationPlan = persistence.plan;
          const persisted = await service.removeImage(
            projectPath,
            operationPlan,
            componentId,
            imageId,
          );
          if (plansEqual(persisted, operationPlan)) {
            return;
          }
          await rebaseServiceDelta(
            token,
            persistence,
            operationPlan,
            (latest) => removeReferenceImage(latest, { componentId, imageId }),
          );
          if (!isTokenReady(token)) return;
          setError(null);
        }),
      );
    },
    [
      guard,
      isTokenReady,
      persisting,
      projectPath,
      rebaseServiceDelta,
      service,
    ],
  );

  const exportPdf = useCallback(() => {
    void guard(projectPath, "Unable to export the PDF", async (token) => {
      setExporting(true);
      try {
        const planToExport = planRef.current;
        const images = await resolveExportImages(planToExport, token);
        if (!isTokenReady(token)) return;
        const bytes = await exporter.export(planToExport, images);
        if (!isTokenReady(token)) return;
        const separator = projectPath.includes("\\") ? "\\" : "/";
        const defaultPath = `${projectPath.replace(/[\\/]+$/, "")}${separator}output.pdf`;
        const savedPath = await saver.save(bytes, defaultPath);
        if (!isTokenReady(token)) return;
        if (savedPath) {
          try {
            await reveal.reveal(savedPath);
          } catch (error) {
            logger.error("reveal_failed", { detail: detail(error) });
          }
        }
        if (isTokenReady(token)) setError(null);
      } finally {
        if (isTokenCurrent(token)) setExporting(false);
      }
    });
  }, [
    exporter,
    guard,
    isTokenCurrent,
    isTokenReady,
    logger,
    projectPath,
    resolveExportImages,
    reveal,
    saver,
  ]);

  return (
    <div className="flex h-full flex-col">
      {error && (
        <div className="bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-900 dark:text-red-200">
          {error}
        </div>
      )}
      <CanvasToolbar
        disabled={lifecycleStatus !== "ready"}
        exporting={exporting}
        onExport={exportPdf}
        onInsert={handleInsert}
        saveState={saveState}
      />
      <div className="flex-1 overflow-auto bg-stone-100 p-6 dark:bg-stone-800" ref={containerRef}>
        {lifecycleStatus === "ready" ? (
          <PlanCanvas
            components={plan.components}
            imageSrc={(file) => imageSrc[file]}
            imageImportProgress={imageImportProgress ?? undefined}
            screenCaptureState={screenCaptureState ?? undefined}
            measurements={measurements}
            onAddImage={handleAddImage}
            onChangeHtml={handleChangeHtml}
            onMeasurePlan={handleMeasurePlan}
            onMeasureReferenceDescription={handleMeasureReferenceDescription}
            onMoveComponent={handleMoveComponent}
            onMoveImage={handleMoveImage}
            onMoveImages={handleMoveImages}
            onOpenImage={(file) => {
              if (readyTokenFor(projectPath)) {
                setLightbox(file);
              }
            }}
            onRemoveComponent={handleRemoveComponent}
            onRemoveImage={handleRemoveImage}
            onRenameComponent={handleRenameComponent}
            onResize={handleResize}
            onCommitTitle={handleSetTitle}
            onSetDescription={handleSetDescription}
            onToggleCaptions={handleToggleCaptions}
            onSetImageCaption={handleSetImageCaption}
            onSetImageHeight={handleSetImageHeight}
            onAddImages={handleAddImages}
            onCaptureImage={screenCapture ? handleCaptureImage : undefined}
            onCancelCapture={handleCancelScreenCapture}
            scale={scale}
            title={plan.title}
          />
        ) : (
          <div
            className="mx-auto max-w-xl rounded-lg border border-stone-300 bg-white p-6 text-center text-sm text-stone-700 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-200"
            role={lifecycleStatus === "failed" ? "alert" : "status"}
          >
            {lifecycleStatus === "failed" ? t("plan.loadFailed") : t("plan.loading")}
          </div>
        )}
      </div>
      {lifecycleStatus === "ready" && lightbox && imageSrc[lightbox] ? (
        <ReferenceImageLightbox
          alt={t("reference.imageAlt")}
          onClose={() => setLightbox(null)}
          src={imageSrc[lightbox]}
        />
      ) : null}
    </div>
  );
}
