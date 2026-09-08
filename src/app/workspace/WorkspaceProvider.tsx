import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";
import type {
  WorkspaceProjectRecord,
  WorkspaceProjectView,
} from "../../domain/workspace/models";
import { sortProjectsByRecentEdit, upsertProject } from "../../domain/workspace/registry";
import type { WorkspaceMenuAction } from "../../domain/workspace/ports";
import type { PlanDependencies } from "../../features/plan/blocknote/dependencies";
import { AgentWorkspaceProvider } from "../../features/agent/AgentWorkspaceContext";
import { AgentProjectSwitchDialog } from "../../features/agent/AgentProjectSwitchDialog";
import { useOptionalAgentController } from "../../features/agent/AgentContext";
import { createAgentWorkspaceStore } from "../../domain/agent/workspaceBridge";
import type { AgentWorkspaceStore } from "../../domain/agent/workspaceBridge";
import { MemoryAttachmentTokenResolver } from "../../infrastructure/agent/memoryAttachmentTokenResolver";
import { WorkspaceLauncher } from "../../features/workspace/WorkspaceLauncher";
import { AppShell } from "../layout/AppShell";
import { Workspace } from "../layout/Workspace";
import { createPlanDependencies } from "../plan/planDependencies";
import type { WorkspaceDependencies } from "./dependencies";
import { useProjectLoading } from "./useProjectLoading";
import { ProjectLoadingScreen } from "../../features/workspace/ProjectLoadingScreen";

type AppView =
  | { kind: "launcher" }
  | { kind: "project"; project: WorkspaceProjectView; loadId: number };

interface WorkspaceProviderProps {
  dependencies: WorkspaceDependencies;
  planDependencies?: PlanDependencies;
  agentWorkspace?: AgentWorkspaceStore;
}

const defaultPlanDependencies = createPlanDependencies();

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
  agentWorkspace: providedAgentWorkspace,
}: WorkspaceProviderProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<AppView>({ kind: "launcher" });
  const [projects, setProjects] = useState<WorkspaceProjectView[]>([]);
  const [loading, setLoading] = useState(true);
  const {
    attempt: loadAttempt, begin: beginLoad, activate: activateLoad,
    report: reportLoad, finish: finishLoad, cancel: cancelLoad, isPending: isLoadPending,
  } = useProjectLoading();
  const [alert, setAlert] = useState<string | null>(null);
  const [createParentPath, setCreateParentPath] = useState<string | null>(null);
  const isMountedRef = useRef(false);
  const isBusyRef = useRef(false);
  const unlistenRef = useRef<(() => void) | null>(null);
  const activeProjectRef = useRef<WorkspaceProjectView | null>(null);
  const activeLoadIdRef = useRef(0);
  const fallbackAgentWorkspace = useMemo(
    () => createAgentWorkspaceStore(new MemoryAttachmentTokenResolver()),
    [],
  );
  const agentWorkspace = providedAgentWorkspace ?? fallbackAgentWorkspace;
  const agentController = useOptionalAgentController();
  const agentControllerState = useSyncExternalStore(
    agentController?.subscribe ?? (() => () => {}),
    agentController?.getSnapshot ?? (() => null),
    agentController?.getSnapshot ?? (() => null),
  );

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
      if (isBusyRef.current || !isMountedRef.current || isLoadPending()) {
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
    [isLoadPending, reportActionError],
  );

  const showProject = useCallback(
    async (project: WorkspaceProjectView, requestedLoadId?: number) => {
      if (!isMountedRef.current) return;
      const loadId = requestedLoadId ?? beginLoad(project.path, project.name);
      const activate = () => {
        if (!isMountedRef.current || !activateLoad(loadId, project.name, project.path)) return;
        void dependencies.native.maximizeWindow().catch((error) => {
          dependencies.logger.warn("Unable to maximize the project window", {
            error,
          });
        });
        setMountedState(() => {
          agentWorkspace.activateProject({
            projectId: project.projectId,
            projectName: project.name,
            projectPath: project.path,
          });
          activeProjectRef.current = project;
          activeLoadIdRef.current = loadId;
          setProjects((currentProjects) =>
            upsertProject(currentProjects, project)
          );
          setAlert(null);
          setView({ kind: "project", project, loadId });
        });
      };
      try {
        if (agentController) {
          const result = await agentController.activateProject({
            projectId: project.projectId,
            projectName: project.name,
            projectPath: project.path,
          }, activate);
          if (result === "already_queued") throw new Error("另一个项目正在切换，请稍后重试。");
        } else {
          activate();
        }
      } catch (error) {
        reportLoad(loadId, project.path, { status: "failed", message: detail(error) });
        throw error;
      }
    },
    [activateLoad, agentController, agentWorkspace, beginLoad, dependencies, reportLoad, setMountedState],
  );

  const requestCreate = useCallback(async () => {
    await runGuardedAction("Unable to prepare project creation", async () => {
      const parentPath = await dependencies.directoryPicker.pickDirectory(
        t("picker.createParent"),
        { defaultToProjectsDir: true },
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
  }, [dependencies, runGuardedAction, setMountedState, t]);

  const cancelCreate = useCallback(() => {
    setMountedState(() => {
      setCreateParentPath(null);
      if (activeProjectRef.current) {
        const project = activeProjectRef.current;
        const loadId = beginLoad(project.path, project.name);
        activateLoad(loadId, project.name);
        activeLoadIdRef.current = loadId;
        setView({ kind: "project", project, loadId });
      }
    });
  }, [activateLoad, beginLoad, setMountedState]);

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
            if (activeProjectRef.current) {
              setView({
                kind: "project",
                project: activeProjectRef.current,
                loadId: activeLoadIdRef.current,
              });
            }
          });
          await showProject(project);
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
    async (path: string, name: string) => {
      await runGuardedAction("Unable to open workspace project", async () => {
        const loadId = beginLoad(path, name);
        try {
          const project = await dependencies.service.openProject(path);
          await showProject(project, loadId);
        } catch (error) {
          reportLoad(loadId, path, { status: "failed", message: detail(error) });
          throw error;
        }
      });
    },
    [beginLoad, dependencies, reportLoad, runGuardedAction, showProject],
  );

  const openAvailableProject = useCallback(
    async (project: WorkspaceProjectView) => {
      return openProject(project.path, project.name);
    },
    [openProject],
  );

  const selectProject = useCallback(
    (project: WorkspaceProjectView) => {
      if (project.status === "unavailable") {
        if (isLoadPending()) return;
        cancelLoad();
        setMountedState(() => {
          agentWorkspace.clearProject();
          setAlert(null);
          setView({ kind: "launcher" });
        });
        return;
      }

      if (activeProjectRef.current?.projectId === project.projectId) {
        return;
      }

      void openProject(project.path, project.name).catch(() => {
        // The guarded action already logs and displays the opening failure.
      });
    },
    [agentWorkspace, cancelLoad, isLoadPending, openProject, setMountedState],
  );

  const openExistingProject = useCallback(async () => {
    await runGuardedAction("Unable to open workspace project", async () => {
      const projectPath = await dependencies.directoryPicker.pickDirectory(
        t("picker.openProject"),
      );

      if (projectPath === null) {
        return;
      }

      const loadId = beginLoad(projectPath, t("shell.openProject"));
      try {
        const project = await dependencies.service.openProject(projectPath);
        await showProject(project, loadId);
      } catch (error) {
        reportLoad(loadId, projectPath, { status: "failed", message: detail(error) });
        throw error;
      }
    });
  }, [beginLoad, dependencies, reportLoad, runGuardedAction, showProject, t]);

  const relocateProject = useCallback(
    async (project: WorkspaceProjectView) => {
      await runGuardedAction(
        "Unable to relocate workspace project",
        async () => {
          const projectPath = await dependencies.directoryPicker.pickDirectory(
            t("picker.relocate", { name: project.name }),
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
    [dependencies, runGuardedAction, setMountedState, t],
  );

  const removeProject = useCallback(
    async (project: WorkspaceProjectView) => {
      await runGuardedAction(
        "Unable to remove workspace project from recents",
        async () => {
          if (agentController) {
            await agentController.deleteProject(project.projectId);
          }
          const nextProjects = await dependencies.service.removeRecord(
            project.projectId,
          );
          const removedActiveProject =
            activeProjectRef.current?.projectId === project.projectId;
          const [nextProject] = removedActiveProject
            ? sortProjectsByRecentEdit(
              nextProjects.filter(
                (candidate) => candidate.status === "available",
              ),
            )
            : [];

          setMountedState(() => {
            setAlert(null);
            setProjects(nextProjects);
          });
          if (removedActiveProject && nextProject) {
            await showProject(nextProject);
          } else if (removedActiveProject) {
            setMountedState(() => {
              activeProjectRef.current = null;
              agentWorkspace.clearProject();
              setView({ kind: "launcher" });
            });
          }
        },
      );
    },
    [
      agentController,
      agentWorkspace,
      dependencies,
      runGuardedAction,
      setMountedState,
      showProject,
    ],
  );

  const revealProjectDirectory = useCallback(
    async (project: WorkspaceProjectView) => {
      await runGuardedAction("Unable to open project directory", async () => {
        await dependencies.projectDirectoryRevealer.revealProjectDirectory(project.path);
      });
    },
    [dependencies, runGuardedAction],
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

        const [mostRecentlyEdited] = sortProjectsByRecentEdit(
          loadedProjects.filter((project) => project.status === "available"),
        );

        if (mostRecentlyEdited) {
          await showProject(mostRecentlyEdited);
        }
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
  }, [dependencies, openExistingProject, requestCreate, showProject]);

  const orderedProjects = useMemo(
    () => sortProjectsByRecentEdit(projects),
    [projects],
  );

  const cancelQueuedSwitch = () => {
    if (agentController?.getSnapshot().switchProject.status !== "waiting") return;
    agentController.cancelWaitingProjectSwitch();
    cancelLoad();
  };
  const loadingContent = loadAttempt ? (
    <div key={loadAttempt.id} className="relative h-full">
    <ProjectLoadingScreen
      projectName={loadAttempt.name}
      progress={loadAttempt.percent}
      error={loadAttempt.error}
      statusText={agentControllerState?.switchProject.status === "waiting"
        ? "等待助手结束当前任务…" : undefined}
      onRetry={() => {
        void openProject(loadAttempt.path, loadAttempt.name).catch(() => {
          // Guarded opening reports the error and retains the retry screen.
        });
      }}
      onComplete={() => finishLoad(loadAttempt.id)}
    />
    {agentControllerState?.switchProject.status === "waiting" ? (
      <button
        className="absolute bottom-6 left-1/2 min-h-9 -translate-x-1/2 rounded-lg border border-app-border bg-app-panel-strong px-4 text-sm text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
        onClick={cancelQueuedSwitch}
        type="button"
      >
        取消切换
      </button>
    ) : null}
    </div>
  ) : undefined;
  const switchDialog = agentController && agentControllerState ? (
    <AgentProjectSwitchDialog
      onCancelWait={cancelQueuedSwitch}
      onChoose={(choice) => {
        if (choice === "cancel" && agentController.getSnapshot().switchProject.status === "choosing") cancelLoad();
        void agentController.chooseProjectSwitch(choice).catch((error) => {
          if (loadAttempt) reportLoad(loadAttempt.id, loadAttempt.path, { status: "failed", message: detail(error) });
          reportActionError("Unable to switch workspace project", error);
        });
      }}
      state={agentControllerState.switchProject}
    />
  ) : null;

  if (view.kind === "project") {
    return (
      <>
        <AgentWorkspaceProvider store={agentWorkspace}>
          <AppShell
            currentProjectId={view.project.projectId}
            error={alert}
            getProjectSessionCount={agentController
              ? (projectId) =>
                agentController.countProjectSessions(projectId)
              : undefined}
            onNewProject={() => {
              void requestCreate();
            }}
            onOpenProject={() => {
              void openExistingProject().catch(() => {
                // The guarded action already logged and displayed the failure.
              });
            }}
            onRemoveProject={(project) => {
              void removeProject(project);
            }}
            onRevealProject={(project) => {
              void revealProjectDirectory(project);
            }}
            onSelectProject={selectProject}
            projects={orderedProjects}
            projectLoading={Boolean(loadAttempt && !loadAttempt.error)}
            loadingProjectName={loadAttempt?.name}
            loadingContent={loadingContent}
            onCancelQueuedSwitch={cancelQueuedSwitch}
          >
            <Workspace
              agentWorkspace={agentWorkspace}
              loadId={view.loadId}
              onLoadProgress={reportLoad}
              dependencies={planDependencies}
              projectDirectoryRevealer={dependencies.projectDirectoryRevealer}
              projectName={view.project.name}
              projectId={view.project.projectId}
              projectPath={view.project.path}
            />
          </AppShell>
        </AgentWorkspaceProvider>
        {switchDialog}
      </>
    );
  }

  return (
    <>
    {loadingContent ? <div className="h-screen bg-app-bg">{loadingContent}</div> : <WorkspaceLauncher
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
    />}
    {switchDialog}
    </>
  );
}
