import { useCallback, useEffect, useRef, useState } from "react";
import { EMPTY_PLAN, type MoveImageParams, type ProjectPlan } from "../../domain/plan/models";
import type { PlanImagePicker } from "../../domain/plan/ports";
import type { PlanService } from "../../domain/plan/service";
import { exportPlanToPdf } from "../../domain/plan/pdf/export";
import type { PdfExporter, PdfSaveTarget } from "../../domain/plan/pdf/ports";
import type { WorkspaceLogger } from "../../domain/workspace/ports";
import { PlanPanel } from "./PlanPanel";
import { ReferenceImageLightbox } from "./ReferenceImageLightbox";
import type { SaveState } from "./SaveStatus";

export interface PlanDependencies {
  service: PlanService;
  picker: PlanImagePicker;
  logger: WorkspaceLogger;
  exporter: PdfExporter;
  saver: PdfSaveTarget;
}

interface ProjectPlanProviderProps {
  projectPath: string;
  projectName: string;
  dependencies: PlanDependencies;
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const AUTO_SAVE_INTERVAL_MS = 5000;

export function ProjectPlanProvider({ projectPath, projectName, dependencies }: ProjectPlanProviderProps) {
  const { service, picker, logger, exporter, saver } = dependencies;
  const [plan, setPlan] = useState<ProjectPlan>(EMPTY_PLAN);
  const [imageSrc, setImageSrc] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [exporting, setExporting] = useState(false);
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
        applyPlan(loaded);
        markSaved(loaded);
        setError(null);
        for (const group of loaded.referenceGroups) {
          for (const image of group.images) {
            try {
              const src = await service.loadImage(projectPath, image.file);
              if (!mountedRef.current) return;
              setImageSrc((current) => ({ ...current, [image.file]: src }));
            } catch (err) {
              report("Unable to load a reference image", err);
            }
          }
        }
      } catch (err) {
        report("Unable to load the project plan", err);
      }
    }
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [applyPlan, markSaved, projectPath, service, report]);

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

  const addGroup = useCallback(() => {
    void guard("Unable to add a reference group", async () => {
      const next = await service.addGroup(planRef.current, "New group");
      if (mountedRef.current) {
        applyPlan(next);
        setError(null);
      }
    });
  }, [applyPlan, guard, service]);

  const renameGroup = useCallback(
    (groupId: string, title: string) => {
      void guard("Unable to rename the reference group", async () => {
        const next = await service.renameGroup(planRef.current, groupId, title);
        if (mountedRef.current) {
          applyPlan(next);
          setError(null);
        }
      });
    },
    [applyPlan, guard, service],
  );

  const setDescription = useCallback(
    (groupId: string, description: string) => {
      void guard("Unable to update the reference group description", async () => {
        const next = await service.setDescription(planRef.current, groupId, description);
        if (mountedRef.current) {
          applyPlan(next);
          setError(null);
        }
      });
    },
    [applyPlan, guard, service],
  );

  const setPhotographyPlan = useCallback(
    (html: string) => {
      void guard("Unable to update the photography plan", async () => {
        const next = await service.setPhotographyPlan(planRef.current, html);
        if (mountedRef.current) {
          applyPlan(next);
          setError(null);
        }
      });
    },
    [applyPlan, guard, service],
  );

  const deleteGroup = useCallback(
    (groupId: string) => {
      void guard("Unable to delete the reference group", () =>
        persisting(async () => {
          const next = await service.deleteGroup(projectPath, planRef.current, groupId);
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

  const setColumns = useCallback(
    (groupId: string, columns: number) => {
      void guard("Unable to change the layout", async () => {
        const next = await service.setColumns(planRef.current, groupId, columns);
        if (mountedRef.current) {
          applyPlan(next);
          setError(null);
        }
      });
    },
    [applyPlan, guard, service],
  );

  const addImage = useCallback(
    (groupId: string) => {
      void guard("Unable to import the reference image", async () => {
        const sourcePath = await picker.pickImageFile("Select a JPG or PNG reference image");
        if (sourcePath === null) return;
        await persisting(async () => {
          const result = await service.importImage(projectPath, planRef.current, groupId, sourcePath);
          if (!mountedRef.current) return;
          setImageSrc((current) => ({ ...current, [result.image.file]: result.dataUrl }));
          applyPlan(result.plan);
          markSaved(result.plan);
          setError(null);
        });
      });
    },
    [applyPlan, guard, markSaved, persisting, picker, projectPath, service],
  );

  const removeImage = useCallback(
    (groupId: string, imageId: string) => {
      void guard("Unable to remove the reference image", () =>
        persisting(async () => {
          const next = await service.removeImage(projectPath, planRef.current, groupId, imageId);
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

  const moveImage = useCallback(
    (params: MoveImageParams) => {
      void guard("Unable to reorder the reference image", async () => {
        const next = await service.moveImage(planRef.current, params);
        if (mountedRef.current) {
          applyPlan(next);
          setError(null);
        }
      });
    },
    [applyPlan, guard, service],
  );

  const exportPdf = useCallback(() => {
    void guard("Unable to export the PDF", async () => {
      setExporting(true);
      try {
        const bytes = await exportPlanToPdf(exporter, planRef.current, projectName, imageSrcRef.current);
        const separator = projectPath.includes("\\") ? "\\" : "/";
        const defaultPath = `${projectPath.replace(/[\\/]+$/, "")}${separator}output.pdf`;
        await saver.save(bytes, defaultPath);
        if (mountedRef.current) setError(null);
      } finally {
        if (mountedRef.current) setExporting(false);
      }
    });
  }, [exporter, guard, projectName, projectPath, saver]);

  return (
    <>
      <PlanPanel
        error={error}
        exporting={exporting}
        groups={plan.referenceGroups}
        imageSrc={(file) => imageSrc[file]}
        onAddGroup={addGroup}
        onAddImage={addImage}
        onDeleteGroup={deleteGroup}
        onExport={exportPdf}
        onMoveImage={moveImage}
        onOpenImage={(file) => setLightbox(file)}
        onRemoveImage={removeImage}
        onRenameGroup={renameGroup}
        onSetPhotographyPlan={setPhotographyPlan}
        onSetColumns={setColumns}
        onSetDescription={setDescription}
        photographyPlan={plan.photographyPlan}
        saveState={saveState}
      />
      {lightbox && imageSrc[lightbox] ? (
        <ReferenceImageLightbox
          alt="Reference image"
          onClose={() => setLightbox(null)}
          src={imageSrc[lightbox]}
        />
      ) : null}
    </>
  );
}
