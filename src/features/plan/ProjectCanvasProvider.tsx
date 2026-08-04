import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  EMPTY_PLAN,
  DEFAULT_PLAN_HEIGHT,
  DEFAULT_REFERENCE_HEIGHT,
  DEFAULT_IMAGE_HEIGHT,
  type ProjectPlan,
} from "../../domain/plan/canvas/models";
import { A4 } from "../../domain/plan/canvas/geometry";
import type { PlanImagePicker } from "../../domain/plan/ports";
import type { CanvasPlanService } from "../../domain/plan/canvas/service";
import type { WorkspaceLogger } from "../../domain/workspace/ports";
import type {
  PdfSaveTarget,
  PdfRevealTarget,
} from "../../domain/plan/canvas/ports";
import {
  addComponent,
  moveComponent,
  moveImage,
  resizeComponent,
  updatePlanHtml,
  setReferenceTitle,
  setReferenceDescription,
  toggleReferenceCaptions,
  setImageCaption,
  setImageAspectRatio,
  setImageHeight,
  addReferenceImages,
  type MoveImageParams,
} from "../../domain/plan/canvas/plan";
import { PlanCanvas } from "./canvas/PlanCanvas";
import { ReferenceImageLightbox } from "./ReferenceImageLightbox";
import { InsertComponentMenu } from "./canvas/InsertComponentMenu";
import { SaveStatus, type SaveState } from "./SaveStatus";

export interface CanvasPlanDependencies {
  service: CanvasPlanService;
  picker: PlanImagePicker;
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

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

export function ProjectCanvasProvider({
  projectPath,
  projectName: _projectName,
  dependencies,
}: ProjectCanvasProviderProps) {
  const { t } = useTranslation();
  const { service, picker, logger, exporter, saver, reveal } = dependencies;
  const [plan, setPlan] = useState<ProjectPlan>(EMPTY_PLAN);
  const [imageSrc, setImageSrc] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [exporting, setExporting] = useState(false);
  const [scale, setScale] = useState(0.5);
  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const busyRef = useRef(false);
  const planRef = useRef(plan);
  const imageSrcRef = useRef(imageSrc);
  const savingRef = useRef(false);
  const lastSavedRef = useRef(JSON.stringify(EMPTY_PLAN));

  const syncSaveState = useCallback(() => {
    setSaveState(
      savingRef.current
        ? "saving"
        : JSON.stringify(planRef.current) === lastSavedRef.current
          ? "saved"
          : "unsaved",
    );
  }, []);

  const applyPlan = useCallback(
    (next: ProjectPlan) => {
      planRef.current = next;
      setPlan(next);
      syncSaveState();
    },
    [syncSaveState],
  );

  const markSaved = useCallback(
    (saved: ProjectPlan) => {
      lastSavedRef.current = JSON.stringify(saved);
      syncSaveState();
    },
    [syncSaveState],
  );

  const persisting = useCallback(
    async (action: () => Promise<void>) => {
      savingRef.current = true;
      syncSaveState();
      try {
        await action();
      } finally {
        savingRef.current = false;
        if (mountedRef.current) {
          syncSaveState();
        }
      }
    },
    [syncSaveState],
  );

  const report = useCallback(
    (message: string, err: unknown) => {
      logger.error(message, { error: err });
      if (mountedRef.current) {
        setError(detail(err));
      }
    },
    [logger],
  );

  const guard = useCallback(
    async (message: string, action: () => Promise<void>) => {
      if (busyRef.current || !mountedRef.current) {
        return;
      }
      busyRef.current = true;
      try {
        await action();
      } catch (err) {
        report(message, err);
      } finally {
        busyRef.current = false;
      }
    },
    [report],
  );

  const flush = useCallback(async () => {
    if (busyRef.current || savingRef.current) {
      return;
    }
    const planToSave = planRef.current;
    const snapshot = JSON.stringify(planToSave);
    if (snapshot === lastSavedRef.current) {
      return;
    }
    savingRef.current = true;
    syncSaveState();
    try {
      await service.savePlan(projectPath, planToSave);
      lastSavedRef.current = snapshot;
      if (mountedRef.current) {
        setError(null);
      }
    } catch (err) {
      report("Unable to auto-save the project plan", err);
    } finally {
      savingRef.current = false;
      if (mountedRef.current) {
        syncSaveState();
      }
    }
  }, [projectPath, report, service, syncSaveState]);

  useEffect(() => {
    mountedRef.current = true;
    async function load() {
      try {
        const loaded = await service.loadPlan(projectPath);
        if (!mountedRef.current) return;
        
        // Seed empty projects with [plan, reference] components
        let planToUse = loaded;
        if (loaded.components.length === 0) {
          // Create plan component (same shape as handleInsert)
          const planComponent = {
            id: crypto.randomUUID(),
            type: "plan" as const,
            width: 1,
            height: DEFAULT_PLAN_HEIGHT,
            html: t("content.planTemplate"),
          };
          
          // Create reference component (same shape as handleInsert)
          const referenceComponent = {
            id: crypto.randomUUID(),
            type: "reference" as const,
            width: 1,
            height: DEFAULT_REFERENCE_HEIGHT,
            title: t("content.newGroupTitle"),
            description: "",
            showCaptions: false,
            imageHeight: DEFAULT_IMAGE_HEIGHT,
            images: [],
          };
          
          // Add plan first (prepends to top), then reference
          planToUse = addComponent(loaded, referenceComponent);
          planToUse = addComponent(planToUse, planComponent);
        }
        
        applyPlan(planToUse);
        markSaved(planToUse);
        setError(null);
        const imageMap = new Map<string, { componentId: string; imageId: string }>();
        planToUse.components
          .filter((c): c is Extract<typeof c, { type: "reference" }> => c.type === "reference")
          .forEach((c) => {
            c.images.forEach((img) => {
              imageMap.set(img.file, { componentId: c.id, imageId: img.id });
            });
          });
        const imageFiles = Array.from(imageMap.keys());
        let backfillPlan = planRef.current;
        for (const file of imageFiles) {
          try {
            const src = await service.loadImage(projectPath, file);
            if (!mountedRef.current) return;
            setImageSrc((current) => ({ ...current, [file]: src }));
            
            // Measure and backfill aspect ratio unconditionally to correct migrated v2 images
            const imageInfo = imageMap.get(file);
            if (imageInfo) {
              const aspectRatio = await measureAspectRatio(src);
              backfillPlan = setImageAspectRatio(backfillPlan, {
                componentId: imageInfo.componentId,
                imageId: imageInfo.imageId,
                aspectRatio,
              });
            }
          } catch (err) {
            report("Unable to load a reference image", err);
          }
        }
        // If aspect ratios were backfilled, update the plan and mark it as the current saved state
        if (backfillPlan !== planRef.current) {
          applyPlan(backfillPlan);
          markSaved(backfillPlan);
        }
      } catch (err) {
        report("Unable to load the project plan", err);
      }
    }
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [applyPlan, markSaved, projectPath, service, report, t]);

  useEffect(() => {
    imageSrcRef.current = imageSrc;
  }, [imageSrc]);

  useEffect(() => {
    const timer = setInterval(() => {
      void flush();
    }, AUTO_SAVE_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      void flush();
    };
  }, [flush]);

  useEffect(() => {
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
  }, [flush]);

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
      if (type === "plan") {
        const newComponent = {
          id: crypto.randomUUID(),
          type: "plan" as const,
          width: 1,
          height: DEFAULT_PLAN_HEIGHT,
          html: t("content.planTemplate"),
        };
        applyPlan(addComponent(planRef.current, newComponent));
      } else {
        const newComponent = {
          id: crypto.randomUUID(),
          type: "reference" as const,
          width: 1,
          height: DEFAULT_REFERENCE_HEIGHT,
          title: t("content.newGroupTitle"),
          description: "",
          showCaptions: false,
          imageHeight: DEFAULT_IMAGE_HEIGHT,
          images: [],
        };
        applyPlan(addComponent(planRef.current, newComponent));
      }
    },
    [applyPlan, t],
  );

  const handleRemoveComponent = useCallback(
    (id: string) => {
      void guard("Unable to remove the component", () =>
        persisting(async () => {
          const next = await service.removeComponent(projectPath, planRef.current, id);
          if (mountedRef.current) {
            applyPlan(next);
            markSaved(next);
            setError(null);
          }
        }),
      );
    },
    [applyPlan, guard, markSaved, persisting, projectPath, service],
  );

  const handleMoveComponent = useCallback(
    (id: string, toIndex: number) => {
      const next = moveComponent(planRef.current, { id, toIndex });
      applyPlan(next);
    },
    [applyPlan],
  );

  const handleMoveImage = useCallback(
    (params: MoveImageParams) => {
      const next = moveImage(planRef.current, params);
      applyPlan(next);
    },
    [applyPlan],
  );

  const handleResize = useCallback(
    (id: string, params: { width?: number; height?: number }) => {
      const next = resizeComponent(planRef.current, { id, ...params });
      applyPlan(next);
    },
    [applyPlan],
  );

  const handleChangeHtml = useCallback(
    (id: string, html: string) => {
      const next = updatePlanHtml(planRef.current, { id, html });
      applyPlan(next);
    },
    [applyPlan],
  );

  const handleSetTitle = useCallback(
    (id: string, title: string) => {
      const next = setReferenceTitle(planRef.current, id, title);
      applyPlan(next);
    },
    [applyPlan],
  );

  const handleSetDescription = useCallback(
    (id: string, description: string) => {
      const next = setReferenceDescription(planRef.current, id, description);
      applyPlan(next);
    },
    [applyPlan],
  );

  const handleSetImageHeight = useCallback(
    (id: string, imageHeight: number) => {
      const next = setImageHeight(planRef.current, id, imageHeight);
      applyPlan(next);
    },
    [applyPlan],
  );

  const handleToggleCaptions = useCallback(
    (id: string) => {
      const next = toggleReferenceCaptions(planRef.current, id);
      applyPlan(next);
    },
    [applyPlan],
  );

  const handleSetImageCaption = useCallback(
    (componentId: string, imageId: string, caption: string) => {
      const next = setImageCaption(planRef.current, { componentId, imageId, caption });
      applyPlan(next);
    },
    [applyPlan],
  );

  const handleAddImage = useCallback(
    (componentId: string) => {
      void guard("Unable to import the reference image", async () => {
        const sourcePath = await picker.pickImageFile("Select a JPG or PNG reference image");
        if (sourcePath === null) return;
        await persisting(async () => {
          const result = await service.importImage(
            projectPath,
            planRef.current,
            componentId,
            sourcePath,
          );
          if (!mountedRef.current) return;
          setImageSrc((current) => ({ ...current, [result.image.file]: result.dataUrl }));
          applyPlan(result.plan);
          markSaved(result.plan);
          setError(null);
          
          // Measure and store aspect ratio
          const aspectRatio = await measureAspectRatio(result.dataUrl);
          const withRatio = setImageAspectRatio(planRef.current, {
            componentId,
            imageId: result.image.id,
            aspectRatio,
          });
          applyPlan(withRatio);
        });
      });
    },
    [applyPlan, guard, markSaved, persisting, picker, projectPath, service],
  );

  const handleAddImages = useCallback(
    (componentId: string) => {
      void guard("Unable to import reference images", async () => {
        const sourcePaths = await picker.pickImageFiles("Select JPG or PNG reference images");
        if (sourcePaths.length === 0) return;
        
        await persisting(async () => {
          const newImages: Array<{ id: string; file: string; aspectRatio: number; dataUrl: string }> = [];
          
          for (const sourcePath of sourcePaths) {
            const result = await service.importImage(
              projectPath,
              planRef.current,
              componentId,
              sourcePath,
            );
            
            // Measure aspect ratio
            const aspectRatio = await measureAspectRatio(result.dataUrl);
            
            newImages.push({
              id: result.image.id,
              file: result.image.file,
              aspectRatio,
              dataUrl: result.dataUrl,
            });
          }
          
          if (!mountedRef.current) return;
          
          // Add all new images to state
          const newSrcMap: Record<string, string> = {};
          for (const img of newImages) {
            newSrcMap[img.file] = img.dataUrl;
          }
          setImageSrc((current) => ({ ...current, ...newSrcMap }));
          
          // Update plan with all images and their aspect ratios
          const updatedPlan = addReferenceImages(planRef.current, {
            componentId,
            images: newImages.map(img => ({ id: img.id, file: img.file, aspectRatio: img.aspectRatio })),
          });
          
          applyPlan(updatedPlan);
          markSaved(updatedPlan);
          setError(null);
        });
      });
    },
    [applyPlan, guard, markSaved, persisting, picker, projectPath, service],
  );

  const handleRemoveImage = useCallback(
    (componentId: string, imageId: string) => {
      void guard("Unable to remove the reference image", () =>
        persisting(async () => {
          const next = await service.removeImage(projectPath, planRef.current, componentId, imageId);
          if (mountedRef.current) {
            applyPlan(next);
            markSaved(next);
            setError(null);
          }
        }),
      );
    },
    [applyPlan, guard, markSaved, persisting, projectPath, service],
  );

  const exportPdf = useCallback(() => {
    void guard("Unable to export the PDF", async () => {
      setExporting(true);
      try {
        const bytes = await exporter.export(planRef.current, imageSrcRef.current);
        const separator = projectPath.includes("\\") ? "\\" : "/";
        const defaultPath = `${projectPath.replace(/[\\/]+$/, "")}${separator}output.pdf`;
        const savedPath = await saver.save(bytes, defaultPath);
        if (savedPath) {
          try {
            await reveal.reveal(savedPath);
          } catch (error) {
            logger.error("reveal_failed", { detail: detail(error) });
          }
        }
        if (mountedRef.current) setError(null);
      } finally {
        if (mountedRef.current) setExporting(false);
      }
    });
  }, [exporter, guard, logger, projectPath, reveal, saver]);

  return (
    <div className="flex h-full flex-col">
      {error && (
        <div className="bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-900 dark:text-red-200">
          {error}
        </div>
      )}
      <div className="flex items-center gap-4 border-b border-stone-200 bg-white px-6 py-3 dark:border-stone-700 dark:bg-stone-900">
        <button
          className="rounded-md bg-stone-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-stone-700 dark:hover:bg-stone-600"
          disabled={exporting}
          onClick={exportPdf}
          type="button"
        >
          {exporting ? t("plan.exporting") : t("plan.exportPdf")}
        </button>
        <InsertComponentMenu onInsert={handleInsert} />
        <SaveStatus state={saveState} />
      </div>
      <div className="flex-1 overflow-auto bg-stone-100 p-6 dark:bg-stone-800" ref={containerRef}>
        <PlanCanvas
          components={plan.components}
          imageSrc={(file) => imageSrc[file]}
          onAddImage={handleAddImage}
          onChangeHtml={handleChangeHtml}
          onMoveComponent={handleMoveComponent}
          onMoveImage={handleMoveImage}
          onOpenImage={(file) => setLightbox(file)}
          onRemoveComponent={handleRemoveComponent}
          onRemoveImage={handleRemoveImage}
          onResize={handleResize}
          onSetDescription={handleSetDescription}
          onSetTitle={handleSetTitle}
          onToggleCaptions={handleToggleCaptions}
          onSetImageCaption={handleSetImageCaption}
          onSetImageHeight={handleSetImageHeight}
          onAddImages={handleAddImages}
          scale={scale}
        />
      </div>
      {lightbox && imageSrc[lightbox] ? (
        <ReferenceImageLightbox
          alt={t("reference.imageAlt")}
          onClose={() => setLightbox(null)}
          src={imageSrc[lightbox]}
        />
      ) : null}
    </div>
  );
}
