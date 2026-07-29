import { useCallback, useEffect, useRef, useState } from "react";
import { EMPTY_PLAN, type ProjectPlan } from "../../domain/plan/models";
import type { PlanImagePicker } from "../../domain/plan/ports";
import type { PlanService } from "../../domain/plan/service";
import type { WorkspaceLogger } from "../../domain/workspace/ports";
import { PlanPanel } from "./PlanPanel";
import { ReferenceImageLightbox } from "./ReferenceImageLightbox";

export interface PlanDependencies {
  service: PlanService;
  picker: PlanImagePicker;
  logger: WorkspaceLogger;
}

interface ProjectPlanProviderProps {
  projectPath: string;
  dependencies: PlanDependencies;
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ProjectPlanProvider({ projectPath, dependencies }: ProjectPlanProviderProps) {
  const { service, picker, logger } = dependencies;
  const [plan, setPlan] = useState<ProjectPlan>(EMPTY_PLAN);
  const [imageSrc, setImageSrc] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const mountedRef = useRef(false);
  const busyRef = useRef(false);
  const planRef = useRef(plan);

  useEffect(() => {
    planRef.current = plan;
  }, [plan]);

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

  useEffect(() => {
    mountedRef.current = true;
    async function load() {
      try {
        const loaded = await service.loadPlan(projectPath);
        if (!mountedRef.current) return;
        setPlan(loaded);
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
  }, [projectPath, service, report]);

  const addGroup = useCallback(() => {
    void guard("Unable to add a reference group", async () => {
      const next = await service.addGroup(projectPath, planRef.current, "New group");
      if (mountedRef.current) {
        setPlan(next);
        setError(null);
      }
    });
  }, [guard, projectPath, service]);

  const renameGroup = useCallback(
    (groupId: string, title: string) => {
      void guard("Unable to rename the reference group", async () => {
        const next = await service.renameGroup(projectPath, planRef.current, groupId, title);
        if (mountedRef.current) setPlan(next);
      });
    },
    [guard, projectPath, service],
  );

  const deleteGroup = useCallback(
    (groupId: string) => {
      void guard("Unable to delete the reference group", async () => {
        const next = await service.deleteGroup(projectPath, planRef.current, groupId);
        if (mountedRef.current) setPlan(next);
      });
    },
    [guard, projectPath, service],
  );

  const setColumns = useCallback(
    (groupId: string, columns: number) => {
      void guard("Unable to change the layout", async () => {
        const next = await service.setColumns(projectPath, planRef.current, groupId, columns);
        if (mountedRef.current) setPlan(next);
      });
    },
    [guard, projectPath, service],
  );

  const addImage = useCallback(
    (groupId: string) => {
      void guard("Unable to import the reference image", async () => {
        const sourcePath = await picker.pickImageFile("Select a JPG or PNG reference image");
        if (sourcePath === null) return;
        const result = await service.importImage(projectPath, planRef.current, groupId, sourcePath);
        if (!mountedRef.current) return;
        setImageSrc((current) => ({ ...current, [result.image.file]: result.dataUrl }));
        setPlan(result.plan);
        setError(null);
      });
    },
    [guard, picker, projectPath, service],
  );

  const removeImage = useCallback(
    (groupId: string, imageId: string) => {
      void guard("Unable to remove the reference image", async () => {
        const next = await service.removeImage(projectPath, planRef.current, groupId, imageId);
        if (mountedRef.current) setPlan(next);
      });
    },
    [guard, projectPath, service],
  );

  return (
    <>
      <PlanPanel
        error={error}
        groups={plan.referenceGroups}
        imageSrc={(file) => imageSrc[file]}
        onAddGroup={addGroup}
        onAddImage={addImage}
        onDeleteGroup={deleteGroup}
        onOpenImage={(file) => setLightbox(file)}
        onRemoveImage={removeImage}
        onRenameGroup={renameGroup}
        onSetColumns={setColumns}
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
