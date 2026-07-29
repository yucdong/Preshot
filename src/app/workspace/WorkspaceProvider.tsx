import { useCallback, useEffect, useRef, useState } from "react";
import type {
  WorkspaceProjectRecord,
  WorkspaceProjectView,
} from "../../domain/workspace/models";
import { upsertProject } from "../../domain/workspace/registry";
import type { WorkspaceMenuAction } from "../../domain/workspace/ports";
import type { PlanDependencies } from "../../features/plan/ProjectPlanProvider";
import { WorkspaceLauncher } from "../../features/workspace/WorkspaceLauncher";
import { AppShell } from "../layout/AppShell";
import { Workspace } from "../layout/Workspace";
import { createPlanDependencies } from "../plan/planDependencies";
import type { WorkspaceDependencies } from "./dependencies";

type AppView =
  | { kind: "launcher" }
  | { kind: "project"; project: WorkspaceProjectView };

interface WorkspaceProviderProps {
  dependencies: WorkspaceDependencies;
  planDependencies?: PlanDependencies;
}

const defaultPlanDependencies = createPlanDependencies();

const CREATE_PARENT_DIRECTORY_TITLE =
  "Select parent folder for the new Preshot project";
const OPEN_PROJECT_DIRECTORY_TITLE = "Select an existing Preshot project";

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toRecord(project: WorkspaceProjectView): WorkspaceProjectRecord {
  return {
    projectId: project.projectId,
    path: project.path,
    name: project.name,
    coverImage: project.coverImage,
    status: project.status,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    lastOpenedAt: project.lastOpenedAt,
  };
}

export function WorkspaceProvider({
  dependencies,
  planDependencies = defaultPlanDependencies,
}: WorkspaceProviderProps) {
  const [view, setView] = useState<AppView>({ kind: "launcher" });
  const [projects, setProjects] = useState<WorkspaceProjectView[]>([]);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState<string | null>(null);
  const [createParentPath, setCreateParentPath] = useState<string | null>(null);
  const isMountedRef = useRef(false);
  const isBusyRef = useRef(false);
  const unlistenRef = useRef<(() => void) | null>(null);

  const setMountedState = useCallback((update: () => void) => {
    if (isMountedRef.current) {
      update();
    }
  }, []);

  const reportActionError = useCallback(
    (message: string, error: unknown) => {
      dependencies.logger.error(message, {
        error,
      });
      setMountedState(() => {
        setAlert(detail(error));
      });
    },
    [dependencies, setMountedState],
  );

  const runGuardedAction = useCallback(
    async (
      actionName: string,
      action: () => Promise<void>,
    ): Promise<boolean> => {
      if (isBusyRef.current || !isMountedRef.current) {
        return false;
      }

      isBusyRef.current = true;

      try {
        await action();
        return true;
      } catch (error) {
        reportActionError(actionName, error);
        throw error;
      } finally {
        isBusyRef.current = false;
      }
    },
    [reportActionError],
  );

  const showProject = useCallback(
    (project: WorkspaceProjectView) => {
      setMountedState(() => {
        setProjects((currentProjects) => upsertProject(currentProjects, project));
        setAlert(null);
        setView({ kind: "project", project });
      });
    },
    [setMountedState],
  );

  const requestCreate = useCallback(async () => {
    await runGuardedAction("Unable to prepare project creation", async () => {
      const parentPath = await dependencies.directoryPicker.pickDirectory(
        CREATE_PARENT_DIRECTORY_TITLE,
      );

      if (parentPath === null) {
        return;
      }

      setMountedState(() => {
        setAlert(null);
        setView({ kind: "launcher" });
        setCreateParentPath(parentPath);
      });
    });
  }, [dependencies, runGuardedAction, setMountedState]);

  const cancelCreate = useCallback(() => {
    setMountedState(() => {
      setCreateParentPath(null);
    });
  }, [setMountedState]);

  const createProject = useCallback(
    async (name: string) => {
      if (createParentPath === null) {
        const error = new Error(
          "Select a parent folder before naming the project",
        );
        reportActionError("Unable to create workspace project", error);
        throw error;
      }

      const created = await runGuardedAction(
        "Unable to create workspace project",
        async () => {
          const project = await dependencies.service.createProject(
            createParentPath,
            name,
          );

          setMountedState(() => {
            setCreateParentPath(null);
          });
          showProject(project);
        },
      );

      if (!created) {
        throw new Error(
          "Another workspace action is in progress. Try creating the project again.",
        );
      }
    },
    [
      createParentPath,
      dependencies,
      reportActionError,
      runGuardedAction,
      setMountedState,
      showProject,
    ],
  );

  const openProject = useCallback(
    async (path: string) => {
      await runGuardedAction("Unable to open workspace project", async () => {
        const project = await dependencies.service.openProject(path);
        showProject(project);
      });
    },
    [dependencies, runGuardedAction, showProject],
  );

  const openAvailableProject = useCallback(
    async (project: WorkspaceProjectView) => {
      return openProject(project.path);
    },
    [openProject],
  );

  const openExistingProject = useCallback(async () => {
    await runGuardedAction("Unable to open workspace project", async () => {
      const projectPath = await dependencies.directoryPicker.pickDirectory(
        OPEN_PROJECT_DIRECTORY_TITLE,
      );

      if (projectPath === null) {
        return;
      }

      const project = await dependencies.service.openProject(projectPath);
      showProject(project);
    });
  }, [dependencies, runGuardedAction, showProject]);

  const relocateProject = useCallback(
    async (project: WorkspaceProjectView) => {
      await runGuardedAction(
        "Unable to relocate workspace project",
        async () => {
          const projectPath = await dependencies.directoryPicker.pickDirectory(
            `Select the relocated folder for ${project.name}`,
          );

          if (projectPath === null) {
            return;
          }

          const relocatedProject = await dependencies.service.relocateProject(
            toRecord(project),
            projectPath,
          );

          setMountedState(() => {
            setAlert(null);
            setProjects((currentProjects) =>
              upsertProject(currentProjects, relocatedProject),
            );
          });
        },
      );
    },
    [dependencies, runGuardedAction, setMountedState],
  );

  const removeProject = useCallback(
    async (project: WorkspaceProjectView) => {
      await runGuardedAction(
        "Unable to remove workspace project from recents",
        async () => {
          const nextProjects = await dependencies.service.removeRecord(
            project.projectId,
          );

          setMountedState(() => {
            setAlert(null);
            setProjects(nextProjects);
          });
        },
      );
    },
    [dependencies, runGuardedAction, setMountedState],
  );

  useEffect(() => {
    isMountedRef.current = true;

    function reportStartupError(message: string, error: unknown) {
      dependencies.logger.error(message, {
        error,
      });

      if (!isMountedRef.current) {
        return;
      }

      setAlert(detail(error));
    }

    async function loadInitialProjects() {
      try {
        const loadedProjects = await dependencies.service.loadProjects();
        if (!isMountedRef.current) {
          return;
        }

        setProjects(loadedProjects);
        setAlert(null);
      } catch (error) {
        reportStartupError("Unable to load workspace projects", error);
        if (!isMountedRef.current) {
          return;
        }

        setProjects([]);
        setView({ kind: "launcher" });
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    }

    async function handleMountedMenuAction(action: WorkspaceMenuAction) {
      if (!isMountedRef.current) {
        return;
      }

      if (action === "new-project") {
        await requestCreate();
        return;
      }

      await openExistingProject();
    }

    void loadInitialProjects();

    dependencies.native
      .onMenuAction((action) => {
        void handleMountedMenuAction(action).catch(() => {
          // Guarded actions already log and surface their own failures; swallow
          // here so a native menu action never becomes an unhandled rejection.
        });
      })
      .then((unlisten) => {
        if (!isMountedRef.current) {
          unlisten();
          return;
        }

        unlistenRef.current = unlisten;
      })
      .catch((error) => {
        reportStartupError("Unable to listen for workspace menu actions", error);
      });

    return () => {
      isMountedRef.current = false;
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, [dependencies, openExistingProject, requestCreate]);

  if (view.kind === "project") {
    return (
      <AppShell projectName={view.project.name}>
        <Workspace dependencies={planDependencies} projectPath={view.project.path} />
      </AppShell>
    );
  }

  return (
    <WorkspaceLauncher
      error={alert}
      isCreateDialogOpen={createParentPath !== null}
      loading={loading}
      onCancelCreate={cancelCreate}
      onCreate={createProject}
      onOpen={openAvailableProject}
      onOpenExisting={openExistingProject}
      onRelocate={relocateProject}
      onRemove={removeProject}
      onRequestCreate={requestCreate}
      projects={projects}
    />
  );
}
