import { ui, useUiLanguage } from "../../shared/i18n/ui";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type {
  WorkspaceProjectRecord,
  WorkspaceProjectView,
} from "../../domain/workspace/models";
import { sortProjectsByRecentEdit, upsertProject } from "../../domain/workspace/registry";
import type { WorkspaceMenuAction } from "../../domain/workspace/ports";
import type { PlanDependencies } from "../../features/plan/blocknote/dependencies";
import { WorkspaceLauncher } from "../../features/workspace/WorkspaceLauncher";
import { AppShell } from "../layout/AppShell";
import { Workspace } from "../layout/Workspace";
import { createPlanDependencies } from "../plan/planDependencies";
import type { WorkspaceDependencies } from "./dependencies";
import { useProjectLoading } from "./useProjectLoading";
import type { PlanLoadProgress } from "../../features/plan/blocknote/planLoadProgress";
import { CloseProjectDialog } from "../../features/workspace/CloseProjectDialog";
import { ProjectLoadingScreen } from "../../features/workspace/ProjectLoadingScreen";
import { DeleteProjectDialog, type ProjectRemovalMode } from "../../features/workspace/DeleteProjectDialog";
import { CopyProjectDialog, type CopyRunOptions } from "../../features/workspace/CopyProjectDialog";
import type { ProjectCopyRequest, PendingProjectCopy } from "../../domain/workspace/projectCopy";

interface OpenProject {
  project: WorkspaceProjectView;
  loadId: number;
}

type AppView =
  | { kind: "launcher" }
  | { kind: "project"; project: WorkspaceProjectView; loadId: number };

interface WorkspaceProviderProps {
  dependencies: WorkspaceDependencies;
  planDependencies?: PlanDependencies;
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
}: WorkspaceProviderProps) {
  useUiLanguage();
  const { t } = useTranslation();
  const [view, setView] = useState<AppView>({ kind: "launcher" });
  const [projects, setProjects] = useState<WorkspaceProjectView[]>([]);
  const [loading, setLoading] = useState(true);
  const [openProjects, setOpenProjects] = useState<OpenProject[]>([]);
  const openProjectsRef = useRef<OpenProject[]>([]);
  const readyLoadsRef = useRef(new Set<number>());
  const beforeCloseRef = useRef(new Map<string, (saveChanges?: boolean) => Promise<void>>());
  const beforeCopyRef = useRef(new Map<string, () => Promise<() => void>>());
  const [copyRequest, setCopyRequest] = useState<{ project: WorkspaceProjectView; parentPath: string; name: string; recovery?: ProjectCopyRequest; returnFocus?: HTMLElement } | null>(null);
  const copyRequestRef = useRef<typeof copyRequest>(null);
  const pendingCopiesRef = useRef<PendingProjectCopy[]>([]);
  const registerBeforeCopy = useCallback((path: string, prepare: () => Promise<() => void>) => {
    beforeCopyRef.current.set(path, prepare);
    return () => { if (beforeCopyRef.current.get(path) === prepare) beforeCopyRef.current.delete(path); };
  }, []);
  const nextRecoveredCopy = useCallback((items: PendingProjectCopy[], loadedProjects: WorkspaceProjectView[]) => {
    const pending = items.shift(); pendingCopiesRef.current = items;
    if (!pending) { copyRequestRef.current = null; setCopyRequest(null); return; }
    const input = pending.request;
    const project = loadedProjects.find(p => p.projectId === input.sourceProjectId) ?? {
      projectId: input.sourceProjectId, path: input.sourcePath, name: input.sourcePath.split(/[\\/]/).at(-1) ?? input.sourcePath,
      coverImage: null, coverDataUrl: null, status: "unavailable" as const, createdAt: "", updatedAt: "", lastOpenedAt: "",
    };
    const request = { project, parentPath: input.parentPath, name: input.name, recovery: input };
    copyRequestRef.current = request; setCopyRequest(request);
  }, []);
  const [closing, setClosing] = useState(false);
  const [closeRequest, setCloseRequest] = useState<WorkspaceProjectView | null>(null);
  const closeRequestRef = useRef<WorkspaceProjectView | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [deleteRequest, setDeleteRequest] = useState<WorkspaceProjectView | null>(null);
  const deleteRequestRef = useRef<WorkspaceProjectView | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteTrigger, setDeleteTrigger] = useState<HTMLElement | null>(null);
  const registerBeforeClose = useCallback((path: string, flush: (saveChanges?: boolean) => Promise<void>) => {
    beforeCloseRef.current.set(path, flush);
    return () => {
      if (beforeCloseRef.current.get(path) === flush) beforeCloseRef.current.delete(path);
    };
  }, []);
  const updateOpenProjects = useCallback((next: OpenProject[]) => {
    const retained = new Set(next.map((entry) => entry.loadId));
    readyLoadsRef.current.forEach((id) => {
      if (!retained.has(id)) readyLoadsRef.current.delete(id);
    });
    openProjectsRef.current = next;
    setOpenProjects(next);
  }, []);
  const {
    attempt: loadAttempt, begin: beginLoad, activate: activateLoad,
    report: reportLoad, finish: finishLoad, cancel: cancelLoad, isPending: isLoadPending,
  } = useProjectLoading();
  const [alert, setAlert] = useState<string | null>(null);
  const [createParentPath, setCreateParentPath] = useState<string | null>(null);
  const isMountedRef = useRef(false);
  const isBusyRef = useRef(false);
  const activeProjectRef = useRef<WorkspaceProjectView | null>(null);
  const activeLoadIdRef = useRef(0);
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
      allowDuringClose = false,
    ): Promise<boolean> => {
      if (isBusyRef.current || !isMountedRef.current || isLoadPending() || ((closeRequestRef.current || deleteRequestRef.current || copyRequestRef.current) && !allowDuringClose)) {
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

  const handleLoadProgress = useCallback((id: number, path: string, progress: PlanLoadProgress) => {
    if (progress.status === "ready" && openProjectsRef.current.some(
      (entry) => entry.loadId === id && entry.project.path === path,
    )) readyLoadsRef.current.add(id);
    reportLoad(id, path, progress);
  }, [reportLoad]);

  const activateCachedProject = useCallback((path: string) => {
    const cached = openProjectsRef.current.find((entry) =>
      entry.project.path === path && readyLoadsRef.current.has(entry.loadId));
    if (!cached) return false;
    cancelLoad();
    activeProjectRef.current = cached.project;
    activeLoadIdRef.current = cached.loadId;
    setAlert(null);
    setView({ kind: "project", ...cached });
    return true;
  }, [cancelLoad]);

  const showProject = useCallback(
    async (project: WorkspaceProjectView, requestedLoadId?: number) => {
      if (!isMountedRef.current) return;
      if (activateCachedProject(project.path)) return;
      const loadId = requestedLoadId ?? beginLoad(project.path, project.name);
      const activate = () => {
        if (!isMountedRef.current || !activateLoad(loadId, project.name, project.path)) return;
        void dependencies.native.maximizeWindow().catch((error) => {
          dependencies.logger.warn("Unable to maximize the project window", {
            error,
          });
        });
        setMountedState(() => {
          activeProjectRef.current = project;
          activeLoadIdRef.current = loadId;
          setProjects((currentProjects) =>
            upsertProject(currentProjects, project)
          );
          setAlert(null);
          updateOpenProjects([
            ...openProjectsRef.current.filter((entry) => entry.project.projectId !== project.projectId && entry.project.path !== project.path),
            { project, loadId },
          ]);
          setView({ kind: "project", project, loadId });
        });
      };
      try {
        activate();
      } catch (error) {
        reportLoad(loadId, project.path, { status: "failed", message: detail(error) });
        throw error;
      }
    },
    [activateCachedProject, activateLoad, beginLoad, dependencies, reportLoad, setMountedState, updateOpenProjects],
  );

  const requestCreate = useCallback(async () => {
    await runGuardedAction("Unable to prepare project creation", async () => {
      const parentPath = await dependencies.directoryPicker.getDefaultProjectsDirectory();

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
      if (activeProjectRef.current) {
        activateCachedProject(activeProjectRef.current.path);
      }
    });
  }, [activateCachedProject, setMountedState]);

  const createProject = useCallback(
    async (name: string, parentPath: string) => {
      if (createParentPath === null || !parentPath.trim()) {
        const error = new Error(
          ui("请填写项目文件夹所在的上级目录"),
        );
        reportActionError("Unable to create workspace project", error);
        throw error;
      }

      const created = await runGuardedAction(
        "Unable to create workspace project",
        async () => {
          const project = await dependencies.service.createProject(
            parentPath.trim(),
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
        if (activateCachedProject(path)) return;
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
    [activateCachedProject, beginLoad, dependencies, reportLoad, runGuardedAction, showProject],
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
          setAlert(null);
          setView({ kind: "launcher" });
        });
        return;
      }

      if (view.kind === "project" && activeProjectRef.current?.projectId === project.projectId) {
        return;
      }

      void openProject(project.path, project.name).catch(() => {
        // The guarded action already logs and displays the opening failure.
      });
    },
    [cancelLoad, isLoadPending, openProject, setMountedState, view.kind],
  );

  const openExistingProject = useCallback(async () => {
    await runGuardedAction("Unable to open workspace project", async () => {
      const projectPath = await dependencies.directoryPicker.pickDirectory(
        t("picker.openProject"),
      );

      if (projectPath === null) {
        return;
      }

      if (activateCachedProject(projectPath)) return;
      const loadId = beginLoad(projectPath, t("shell.openProject"));
      try {
        const project = await dependencies.service.openProject(projectPath);
        await showProject(project, loadId);
      } catch (error) {
        reportLoad(loadId, projectPath, { status: "failed", message: detail(error) });
        throw error;
      }
    });
  }, [activateCachedProject, beginLoad, dependencies, reportLoad, runGuardedAction, showProject, t]);

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

  const requestRemoveProject = useCallback((project: WorkspaceProjectView) => {
    if (isBusyRef.current || isLoadPending() || closeRequestRef.current || deleteRequestRef.current) return;
    deleteRequestRef.current = project;
    // Capture before the workspace becomes inert and the browser clears focus.
    setDeleteTrigger(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setDeleteError(null);
    setDeleteRequest(project);
  }, [isLoadPending]);

  const removeProject = useCallback(
    async (project: WorkspaceProjectView, mode: ProjectRemovalMode) => {
      await runGuardedAction(
        "Unable to remove workspace project",
        async () => {
          setDeleting(true);
          try {
            const removedActiveProject =
              activeProjectRef.current?.projectId === project.projectId;
            const beforeClose = beforeCloseRef.current.get(project.path);
            // Keep a recoverable saved project if deletion fails. Drain pending
            // media/saves, then disable retirement writes before deleting files.
            await beforeClose?.(true);
            if (mode === "disk") {
              await beforeClose?.(false);
              updateOpenProjects(openProjectsRef.current.filter((entry) => entry.project.projectId !== project.projectId));
              if (removedActiveProject) {
                cancelLoad();
                activeProjectRef.current = null;
                setView({ kind: "launcher" });
              }
            }
            const nextProjects = mode === "disk"
              ? await dependencies.service.deleteProject(project)
              : await dependencies.service.removeRecord(project.projectId);
            updateOpenProjects(openProjectsRef.current.filter((entry) => entry.project.projectId !== project.projectId));
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
              deleteRequestRef.current = null;
              setDeleteRequest(null);
            });
            if (removedActiveProject && nextProject) {
              await showProject(nextProject);
            } else if (removedActiveProject) {
              setMountedState(() => {
                activeProjectRef.current = null;
                setView({ kind: "launcher" });
              });
            }
          } finally {
            if (isMountedRef.current) setDeleting(false);
          }
        },
        true,
      );
    },
    [
      dependencies,
      runGuardedAction,
      setMountedState,
      showProject,
      updateOpenProjects,
      cancelLoad,
    ],
  );

  const closeProject = useCallback(async (project: WorkspaceProjectView, saveChanges: boolean) => {
    await runGuardedAction("Unable to close workspace project", async () => {
      setClosing(true);
      try {
        await beforeCloseRef.current.get(project.path)?.(saveChanges);
        if (!isMountedRef.current) return;
        const remaining = openProjectsRef.current.filter((entry) => entry.project.projectId !== project.projectId);
        updateOpenProjects(remaining);
        closeRequestRef.current = null;
        setCloseRequest(null);
        if (activeProjectRef.current?.projectId !== project.projectId) return;
        const next = remaining[remaining.length - 1];
        if (next) {
          await showProject(next.project);
        } else {
          cancelLoad();
          activeProjectRef.current = null;
          setView({ kind: "launcher" });
        }
      } finally {
        if (isMountedRef.current) setClosing(false);
      }
    }, true);
  }, [cancelLoad, runGuardedAction, showProject, updateOpenProjects]);

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
    let active = true;

    function reportStartupError(message: string, error: unknown) {
      dependencies.logger.error(message, {
        error,
      });

      if (!active) {
        return;
      }

      setAlert(detail(error));
    }

    async function loadInitialProjects() {
      try {
        const loadedProjects = await dependencies.service.loadProjects();
        if (!active) {
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
        try {
          const pending = await dependencies.service.pendingProjectCopies?.() ?? [];
          const unregistered: PendingProjectCopy[] = [];
          for (const item of pending) {
            if (item.status.phase === "cancelled" || item.status.project && loadedProjects.some(p => p.projectId === item.status.project!.manifest.id && p.path === item.status.project!.path)) {
              await dependencies.service.acknowledgeProjectCopy?.(item.request.operationId);
            } else unregistered.push(item);
          }
          if (active && unregistered.length) nextRecoveredCopy(unregistered, loadedProjects);
        } catch (error) { reportStartupError("Unable to recover a project copy", error); }
      } catch (error) {
        reportStartupError("Unable to load workspace projects", error);
        if (!active) {
          return;
        }

        setProjects([]);
        setView({ kind: "launcher" });
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadInitialProjects();
    return () => {
      active = false;
      isMountedRef.current = false;
    };
  }, [dependencies, showProject, nextRecoveredCopy]);

  // Menu labels change with the UI language; project startup must not rerun.
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    async function handleMountedMenuAction(action: WorkspaceMenuAction) {
      if (!active) {
        return;
      }

      if (action === "new-project") {
        await requestCreate();
        return;
      }

      await openExistingProject();
    }

    dependencies.native
      .onMenuAction((action) => {
        void handleMountedMenuAction(action).catch(() => {
          // Guarded actions already log and surface their own failures; swallow
          // here so a native menu action never becomes an unhandled rejection.
        });
      })
      .then((dispose) => {
        if (!active) {
          dispose();
          return;
        }

        unlisten = dispose;
      })
      .catch((error) => {
        if (active) reportActionError("Unable to listen for workspace menu actions", error);
      });

    return () => {
      active = false;
      unlisten?.();
    };
  }, [dependencies, openExistingProject, reportActionError, requestCreate]);

  const orderedProjects = useMemo(
    () => sortProjectsByRecentEdit(projects),
    [projects],
  );

  const requestCopyProject = async (project: WorkspaceProjectView) => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    await runGuardedAction("Unable to prepare project copy", async () => {
      if (!dependencies.service.suggestProjectCopy) throw new Error(ui("当前环境不支持复制项目。"));
      const defaults = await dependencies.service.suggestProjectCopy(project, ui("{{v0}} - 副本", { v0: project.name }));
      const request = { project, ...defaults, returnFocus };
      copyRequestRef.current = request; setCopyRequest(request);
    });
  };
  const copyProject = async (input: ProjectCopyRequest, options: CopyRunOptions) => {
    const started = await runGuardedAction("Unable to copy project", async () => {
      if (!dependencies.service.copyProject) throw new Error(ui("当前环境不支持复制项目。"));
      let release: (() => void) | undefined;
      try {
        const previous = await dependencies.service.projectCopyStatus?.(input.operationId);
        // An uncertain retry may still have a native reader holding the source.
        // Only a new/failed operation may prepare and save that source again.
        if (!previous || previous.phase === "failed" || previous.phase === "cancelled") {
          options.signal.throwIfAborted();
          const open = openProjectsRef.current.find(entry => entry.project.path === input.sourcePath && entry.project.projectId === input.sourceProjectId);
          if (open) {
            const prepare = beforeCopyRef.current.get(input.sourcePath);
            if (!prepare) throw new Error(ui("项目仍在加载，请稍后复制。"));
            release = await prepare();
          }
          options.signal.throwIfAborted();
        }
        options.onCopying();
        const project = await dependencies.service.copyProject(input);
        setProjects(current => upsertProject(current, project));
        await showProject(project);
      } finally { release?.(); }
    }, true);
    if (!started) throw new Error(ui("当前操作尚未完成，请稍后重试复制。"));
  };

  const loadingContent = loadAttempt ? (
    <div key={loadAttempt.id} className="relative h-full">
      <ProjectLoadingScreen
        projectName={loadAttempt.name}
        progress={loadAttempt.percent}
        error={loadAttempt.error}
        onRetry={() => {
          void openProject(loadAttempt.path, loadAttempt.name).catch(() => {
            // Guarded opening reports the error and retains the retry screen.
          });
        }}
        onComplete={() => finishLoad(loadAttempt.id)}
      />
    </div>
  ) : undefined;
  return (
    <>
      {openProjects.length > 0 ? (
        <div hidden={view.kind !== "project"} inert={view.kind !== "project" || closing || closeRequest !== null || deleteRequest !== null || copyRequest !== null}>
          <AppShell
            currentProjectId={view.kind === "project" ? view.project.projectId : ""}
            error={alert}
            onNewProject={() => {
              void requestCreate().catch(() => {
                // The guarded action already reports default-directory failures.
              });
            }}
            onOpenProject={() => {
              void openExistingProject().catch(() => {
                // The guarded action already logged and displayed the failure.
              });
            }}
            onRemoveProject={requestRemoveProject}
            onCopyProject={project => { void requestCopyProject(project).catch(() => undefined); }}
            onRevealProject={(project) => {
              void revealProjectDirectory(project);
            }}
            onSelectProject={selectProject}
            projects={orderedProjects}
            openProjects={openProjects.map((entry) => entry.project)}
            onCloseProject={(project) => {
              if (isBusyRef.current || isLoadPending() || closeRequestRef.current) return;
              closeRequestRef.current = project;
              setCloseError(null);
              setCloseRequest(project);
            }}
            projectLoading={Boolean(loadAttempt && !loadAttempt.error)}
            loadingProjectName={loadAttempt?.name}
            loadingContent={view.kind === "project" ? loadingContent : undefined}
          >
            {openProjects.map((entry) => (
              <Workspace
                key={entry.loadId}
                active={view.kind === "project" && entry.loadId === view.loadId}
                interactionPaused={copyRequest !== null}
                loadId={entry.loadId}
                onLoadProgress={handleLoadProgress}
                registerBeforeClose={registerBeforeClose}
                registerBeforeCopy={registerBeforeCopy}
                savePaused={closeRequest?.path === entry.project.path || deleteRequest?.path === entry.project.path || copyRequest?.project.path === entry.project.path}
                dependencies={planDependencies}
                projectDirectoryRevealer={dependencies.projectDirectoryRevealer}
                projectName={entry.project.name}
                projectId={entry.project.projectId}
                projectPath={entry.project.path}
              />
            ))}
          </AppShell>
        </div>
      ) : null}
      {view.kind === "launcher" ? (
        loadingContent ? <div className="h-screen bg-app-bg">{loadingContent}</div> : (
          <div inert={deleteRequest !== null || copyRequest !== null}><WorkspaceLauncher
            error={alert}
            isCreateDialogOpen={createParentPath !== null}
            defaultParentPath={createParentPath ?? ""}
            onPickCreateDirectory={(currentPath) => dependencies.directoryPicker.pickDirectory(
              t("picker.createParent"), { defaultPath: currentPath },
            )}
            loading={loading}
            onCancelCreate={cancelCreate}
            onCreate={createProject}
            onOpen={openAvailableProject}
            onOpenExisting={openExistingProject}
            onRelocate={relocateProject}
            onRemove={requestRemoveProject}
            onCopy={requestCopyProject}
            onRequestCreate={requestCreate}
            projects={projects}
          /></div>
        )
      ) : null}
      {copyRequest && <CopyProjectDialog key={copyRequest.recovery?.operationId ?? copyRequest.project.projectId}
        sourceName={copyRequest.project.name} sourcePath={copyRequest.project.path} sourceProjectId={copyRequest.project.projectId}
        defaultParentPath={copyRequest.parentPath} defaultName={copyRequest.name} recovery={copyRequest.recovery} returnFocus={copyRequest.returnFocus}
        onClose={() => nextRecoveredCopy([...pendingCopiesRef.current], projects)} onCopy={copyProject}
        onPickDirectory={path => dependencies.directoryPicker.pickDirectory(ui("选择副本存放目录"), { defaultPath: path })}
        getStatus={id => dependencies.service.projectCopyStatus!(id)} cancelCopy={id => dependencies.service.cancelProjectCopy!(id)}
        acknowledge={id => dependencies.service.acknowledgeProjectCopy!(id)}
      />}
      {closeRequest ? <CloseProjectDialog
        projectName={closeRequest.name}
        busy={closing}
        error={closeError}
        onCancel={() => {
          if (isBusyRef.current) return;
          closeRequestRef.current = null;
          setCloseRequest(null);
          setCloseError(null);
        }}
        onClose={(saveChanges) => {
          setCloseError(null);
          void closeProject(closeRequest, saveChanges).catch((error: unknown) => {
            if (isMountedRef.current) setCloseError(detail(error));
          });
        }}
      /> : null}
      {deleteRequest ? <DeleteProjectDialog
        project={deleteRequest} busy={deleting} error={deleteError}
        returnFocusTo={deleteTrigger}
        onCancel={() => {
          if (isBusyRef.current) return;
          deleteRequestRef.current = null;
          setDeleteRequest(null);
          setDeleteError(null);
        }}
        onRemove={(mode) => {
          setDeleteError(null);
          void removeProject(deleteRequest, mode).catch((error: unknown) => {
            if (isMountedRef.current) setDeleteError(detail(error));
          });
        }}
      /> : null}
    </>
  );
}
