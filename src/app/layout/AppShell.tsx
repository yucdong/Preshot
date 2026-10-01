import { ProjectGroups } from "../../features/workspace/ProjectGroups";
import type { ProjectOrganizationCommand } from "../../domain/workspace/organization";
import { ui, useUiLanguage } from "../../shared/i18n/ui";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Copy,
  Focus,
  FolderOpen,
  Minimize2,
  PanelLeftOpen,
  Library,
  Trash2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  PROJECT_RAIL_WIDTH,
} from "../../domain/settings/models";
import type { ProjectOrganization, WorkspaceProjectView } from "../../domain/workspace/models";
import { SettingsButton } from "../../features/settings/SettingsButton";
import { useTheme } from "../theme/ThemeContext";
import { BrandMark } from "../../shared/ui/BrandMark";
import { useOptionalMaterialLibrary } from "../../features/library/MaterialLibraryContext";

interface AppShellProps extends PropsWithChildren {
  projects: WorkspaceProjectView[];
  organization: ProjectOrganization;
  onOrganizationChange(command: ProjectOrganizationCommand): Promise<void>;
  openProjects?: WorkspaceProjectView[];
  onCloseProject?(project: WorkspaceProjectView): void;
  currentProjectId: string;
  projectLoading?: boolean;
  loadingProjectName?: string;
  loadingContent?: ReactNode;
  error?: string | null;
  onSelectProject(project: WorkspaceProjectView): void;
  onNewProject(): void;
  onOpenProject(): void;
  onRevealProject(project: WorkspaceProjectView): void;
  onRemoveProject(project: WorkspaceProjectView): void;
  onCopyProject?(project: WorkspaceProjectView): void;
}

const railButtonClassName =
  "w-full rounded-lg px-2 py-2 text-sm font-medium transition-[background-color,border-color,color,box-shadow] duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-app-functional focus-visible:ring-offset-2 focus-visible:ring-offset-app-panel";

const MIN_CANVAS_WIDTH = 480;
const SPLITTER_WIDTH = 6;

function constrainedPanelWidth(
  requested: number,
  range: { min: number; max: number },
  workspaceWidth: number,
) {
  const available = workspaceWidth - MIN_CANVAS_WIDTH - SPLITTER_WIDTH;
  return Math.min(range.max, Math.max(range.min, Math.min(requested, available)));
}

export function AppShell({
  children,
  projects,
  organization,
  onOrganizationChange,
  openProjects = [],
  onCloseProject,
  currentProjectId,
  projectLoading = false,
  loadingProjectName,
  loadingContent,
  error,
  onSelectProject,
  onNewProject,
  onOpenProject,
  onRevealProject,
  onRemoveProject,
  onCopyProject,
}: AppShellProps) {
  useUiLanguage();
  const { t } = useTranslation();
  const materialLibrary = useOptionalMaterialLibrary();
  const settings = useTheme();
  const workspaceContentRef = useRef<HTMLDivElement>(null);
  const previouslyLoading = useRef(false);
  const hasLoadingContent = Boolean(loadingContent);
  useEffect(() => {
    if (previouslyLoading.current && !hasLoadingContent) {
      workspaceContentRef.current?.focus({ preventScroll: true });
    }
    previouslyLoading.current = hasLoadingContent;
  }, [hasLoadingContent]);
  const [projectQuery, setProjectQuery] = useState("");
  const [moveProject, setMoveProject] = useState<WorkspaceProjectView | null>(null);
  const [projectMenuId, setProjectMenuId] = useState<string | null>(null);
  const [projectMenuPosition, setProjectMenuPosition] = useState({
    left: 0,
    top: 0,
  });
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const projectMenuTriggerRefs = useRef(
    new Map<string, HTMLButtonElement>(),
  );
  const [workspaceView, setWorkspaceView] = useState<{
    projectId: string;
    focusMode: boolean;
    overlayPanel: "projects" | null;
  }>({
    projectId: currentProjectId,
    focusMode: false,
    overlayPanel: null,
  });
  const activeWorkspaceView = workspaceView.projectId === currentProjectId
    ? workspaceView
    : {
        projectId: currentProjectId,
        focusMode: false,
        overlayPanel: null,
      };
  const { focusMode, overlayPanel } = activeWorkspaceView;
  const setFocusMode = (
    value: boolean | ((current: boolean) => boolean),
  ) => {
    setWorkspaceView((previous) => {
      const current = previous.projectId === currentProjectId
        ? previous
        : activeWorkspaceView;
      return {
        ...current,
        focusMode: typeof value === "function"
          ? value(current.focusMode)
          : value,
      };
    });
  };
  const setOverlayPanel = (
    value:
      | "projects"
      | null
      | ((current: "projects" | null) =>
          "projects" | null),
  ) => {
    setWorkspaceView((previous) => {
      const current = previous.projectId === currentProjectId
        ? previous
        : activeWorkspaceView;
      return {
        ...current,
        overlayPanel: typeof value === "function"
          ? value(current.overlayPanel)
          : value,
      };
    });
  };
  const [panelWidthPreview, setPanelWidthPreview] = useState<{
    projectRailWidth: number;
  } | null>(null);
  const panelWidths = panelWidthPreview ?? {
      projectRailWidth: settings.projectRailWidth,
  };

  useEffect(() => {
    if (!focusMode || overlayPanel === null) return;
    const closeOverlay = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      setWorkspaceView((current) =>
        current.projectId === currentProjectId
          ? { ...current, overlayPanel: null }
          : current);
    };
    window.addEventListener("keydown", closeOverlay);
    return () => window.removeEventListener("keydown", closeOverlay);
  }, [currentProjectId, focusMode, overlayPanel]);

  const positionProjectMenu = useCallback((projectId: string) => {
    const trigger = projectMenuTriggerRefs.current.get(projectId);
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuWidth = 144;
    const menuHeight = onCopyProject ? 152 : 120;
    const viewportGutter = 8;
    const preferredTop = rect.bottom + 4;
    setProjectMenuPosition({
      left: Math.min(
        window.innerWidth - menuWidth - viewportGutter,
        Math.max(viewportGutter, rect.right - menuWidth),
      ),
      top: preferredTop + menuHeight <= window.innerHeight - viewportGutter
        ? preferredTop
        : Math.max(viewportGutter, rect.top - menuHeight - 4),
    });
  }, [onCopyProject]);
  const focusProjectMenuTrigger = useCallback((projectId: string) => {
    document
      .getElementById(`project-overflow-trigger-${projectId}`)
      ?.focus();
  }, []);
  const moveFocusFromProjectMenu = useCallback((
    projectId: string,
    backwards: boolean,
  ) => {
    const trigger = document.getElementById(
      `project-overflow-trigger-${projectId}`,
    );
    if (!trigger) return;
    const focusable = Array.from(document.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => !element.closest('[role="menu"]'));
    const triggerIndex = focusable.indexOf(trigger);
    if (triggerIndex < 0) return;
    const nextIndex = triggerIndex + (backwards ? -1 : 1);
    focusable[nextIndex]?.focus();
  }, []);

  useEffect(() => {
    if (!projectMenuId) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("[data-project-overflow-menu]")?.getAttribute(
          "data-project-overflow-menu",
        ) === projectMenuId
      ) {
        return;
      }
      setProjectMenuId(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setProjectMenuId(null);
      focusProjectMenuTrigger(projectMenuId);
    };
    const updatePosition = () => positionProjectMenu(projectMenuId);
    const focusFirstItem = window.requestAnimationFrame(() => {
      projectMenuRef.current
        ?.querySelector<HTMLElement>('[role="menuitem"]')
        ?.focus();
    });

    updatePosition();
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.cancelAnimationFrame(focusFirstItem);
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [focusProjectMenuTrigger, positionProjectMenu, projectMenuId]);

  const commitWidths = (next = panelWidths) => {
    settings.setPanelWidths(next);
    setPanelWidthPreview(null);
  };

  const splitterProps = () => {
    const value = panelWidths.projectRailWidth;
    const range = PROJECT_RAIL_WIDTH;
    return {
      role: "separator" as const,
      tabIndex: 0,
      "aria-label": t("shell.resizeProjectRail"),
      "aria-orientation": "vertical" as const,
      "aria-valuemin": range.min,
      "aria-valuemax": range.max,
      "aria-valuenow": Math.round(value),
      onDoubleClick: () => {
        const next = {
          ...panelWidths,
          projectRailWidth: range.default,
        };
        setPanelWidthPreview(next);
        commitWidths(next);
      },
      onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const delta = direction * 8;
        const workspaceWidth = event.currentTarget.parentElement?.getBoundingClientRect().width ?? Number.POSITIVE_INFINITY;
        const nextValue = constrainedPanelWidth(value + delta, range, workspaceWidth);
        const next = {
          ...panelWidths,
          projectRailWidth: nextValue,
        };
        setPanelWidthPreview(next);
        commitWidths(next);
      },
      onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
        const target = event.currentTarget;
        const startX = event.clientX;
        const startWidth = value;
        let latest = panelWidths;
        const workspaceWidth = target.parentElement?.getBoundingClientRect().width ?? Number.POSITIVE_INFINITY;
        target.setPointerCapture(event.pointerId);
        const move = (moveEvent: PointerEvent) => {
          const delta = moveEvent.clientX - startX;
          const requested = startWidth + delta;
          const nextValue = constrainedPanelWidth(requested, range, workspaceWidth);
          latest = {
            ...latest,
            projectRailWidth: nextValue,
          };
          setPanelWidthPreview(latest);
        };
        const finish = () => {
          target.removeEventListener("pointermove", move);
          target.removeEventListener("pointerup", finish);
          target.removeEventListener("pointercancel", finish);
          commitWidths(latest);
        };
        target.addEventListener("pointermove", move);
        target.addEventListener("pointerup", finish);
        target.addEventListener("pointercancel", finish);
      },
    };
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-app-bg text-app-ink">
      <header className="relative flex h-[58px] shrink-0 items-center gap-3 border-b border-white/10 bg-[#17191d] px-4 text-white shadow-[0_2px_12px_rgb(0_0_0_/_16%)]">
        <BrandMark />
        <h1 className="font-editorial text-lg font-extrabold">PRESHOT</h1>
        <span className="h-5 w-px bg-white/15" />
        <strong className="max-w-64 truncate text-sm font-semibold">
          {loadingProjectName ?? projects.find((project) => project.projectId === currentProjectId)?.name ?? ""}
        </strong>
        <span className="whitespace-nowrap text-xs text-white/45">
          {t("shell.tagline")}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {materialLibrary ? (
            <button
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-xs font-semibold text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => materialLibrary.openBrowser()}
              disabled={hasLoadingContent}
              type="button"
            >
              <Library aria-hidden className="h-4 w-4" />
              {ui("素材库")}
            </button>
          ) : null}
          <button
            aria-label={focusMode ? ui("退出专注模式") : ui("进入专注模式")}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-xs font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
            onClick={() => {
              setFocusMode((current) => !current);
              setOverlayPanel(null);
            }}
            type="button"
          >
            {focusMode ? <Minimize2 aria-hidden className="h-4 w-4" /> : <Focus aria-hidden className="h-4 w-4" />}
            <span>{focusMode ? ui("退出专注") : ui("专注模式")}</span>
          </button>
          <SettingsButton />
        </div>
      </header>
      <div
        className={focusMode ? "relative min-h-0 flex-1" : "grid min-h-0 flex-1"}
        data-testid="resizable-workspace"
        data-focus-mode={focusMode ? "true" : "false"}
        style={focusMode ? undefined : {
          gridTemplateColumns: `${panelWidths.projectRailWidth}px ${SPLITTER_WIDTH}px minmax(0, 1fr)`,
        }}
      >
        {focusMode ? (
          <>
            <button
              aria-label={ui("打开项目面板")}
              aria-pressed={overlayPanel === "projects"}
              className="absolute left-0 top-14 z-40 grid h-10 w-8 place-items-center rounded-r-lg border border-l-0 border-app-border bg-app-panel-strong text-app-muted shadow-md transition-colors hover:text-app-functional focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
              onClick={() => setOverlayPanel((current) =>
                current === "projects" ? null : "projects")}
              type="button"
            >
              <PanelLeftOpen aria-hidden className="h-4 w-4" />
            </button>
          </>
        ) : null}
        {!focusMode || overlayPanel === "projects" ? (
          <nav
            inert={projectLoading}
            aria-label={t("shell.projects")}
            className={focusMode
              ? "absolute inset-y-3 left-3 z-50 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-app-border bg-app-panel shadow-[0_16px_42px_rgb(24_24_27_/_20%)]"
              : "flex min-h-0 min-w-0 flex-col bg-app-panel"}
            style={focusMode ? { width: panelWidths.projectRailWidth } : undefined}
          >
            <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-4">
              <p className="text-[11px] font-bold text-app-ink">
                {t("shell.openProjects")}
              </p>
              {focusMode ? (
                <button
                  aria-label={ui("关闭项目面板")}
                  className="grid h-7 w-7 place-items-center rounded-md text-app-muted hover:bg-app-panel-strong hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
                  onClick={() => setOverlayPanel(null)}
                  type="button"
                >
                  <X aria-hidden className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          <section aria-label={t("shell.openProjects")} className="flex max-h-[35%] min-h-0 shrink-0 flex-col">
            <ul className="min-h-0 space-y-1 overflow-y-auto px-3 pb-3">
              {openProjects.map((project) => (
                <li key={project.projectId} className={`flex items-center rounded-lg border ${project.projectId === currentProjectId ? "border-app-border bg-app-panel-strong" : "border-transparent"}`}>
                  <button
                    type="button"
                    className={`${railButtonClassName} min-w-0 flex-1 truncate text-left text-app-ink`}
                    aria-current={project.projectId === currentProjectId ? "page" : undefined}
                    aria-label={t("shell.openProjectNamed", { name: project.name })}
                    onClick={() => { setProjectMenuId(null); onSelectProject(project); }}
                  >{project.name}</button>
                  <button
                    type="button"
                    className="mr-1 grid h-7 w-7 shrink-0 place-items-center rounded text-app-muted hover:bg-app-panel-strong hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
                    aria-label={t("shell.closeProjectNamed", { name: project.name })}
                    onClick={() => onCloseProject?.(project)}
                  ><X aria-hidden className="h-3.5 w-3.5" /></button>
                </li>
              ))}
            </ul>
          </section>
          <ProjectGroups projects={projects} organization={organization} currentProjectId={currentProjectId}
            query={projectQuery} onQueryChange={setProjectQuery} onChange={onOrganizationChange}
            onSelectProject={project => { setProjectMenuId(null); onSelectProject(project); }}
            menuProjectId={projectMenuId} onProjectMenu={project => {
              if (projectMenuId === project.projectId) setProjectMenuId(null);
              else { positionProjectMenu(project.projectId); setProjectMenuId(project.projectId); }
            }}
            registerMenuTrigger={(id, element) => { if (element) projectMenuTriggerRefs.current.set(id, element); else projectMenuTriggerRefs.current.delete(id); }}
            moveProject={moveProject} onMoveDialogClose={() => setMoveProject(null)} />
          <div className="shrink-0 space-y-2 border-t border-app-border p-3">
            <button
              className={`${railButtonClassName} bg-[#202329] text-white hover:bg-[#30343a] active:scale-[0.98]`}
              onClick={onNewProject}
              type="button"
            >
              {t("shell.newProject")}
            </button>
            <button
              className={`${railButtonClassName} border border-app-border bg-app-panel-strong text-app-ink hover:border-[#202329] active:scale-[0.98]`}
              onClick={onOpenProject}
              type="button"
            >
              {t("shell.openProject")}
            </button>
          </div>
          </nav>
        ) : null}
        {!focusMode ? (
          <div
            {...splitterProps()}
            className="group relative z-30 cursor-col-resize bg-[#d5d6da] transition-colors duration-200 hover:bg-app-accent focus-visible:bg-app-accent focus-visible:outline-none"
            title={t("shell.resizePanelHint")}
          >
            <span className="absolute left-1/2 top-1/2 h-10 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-app-muted/50 group-hover:bg-white" />
          </div>
        ) : null}
        <div className={focusMode
          ? "relative flex h-full min-h-0 min-w-0 flex-col"
          : "relative flex min-h-0 min-w-0 flex-col"}
        >
          {error && !hasLoadingContent ? (
            <div
              className="border-b border-rose-200 bg-rose-50 px-6 py-3 text-sm text-rose-700 dark:border-rose-400/40 dark:bg-rose-500/10 dark:text-rose-100"
              role="alert"
            >
              {t("errors.workspace")}
              <span className="ml-2">{error}</span>
            </div>
          ) : null}
          <div
            ref={workspaceContentRef}
            tabIndex={-1}
            aria-label={ui("方案工作区")}
            aria-hidden={hasLoadingContent || undefined}
            inert={hasLoadingContent}
            className="flex min-h-0 flex-1 flex-col outline-none"
            style={hasLoadingContent ? { visibility: "hidden" } : undefined}
          >
            {children}
          </div>
          {hasLoadingContent ? <div className="absolute inset-0 z-40">{loadingContent}</div> : null}
        </div>
      </div>
      {projectMenuId
        ? (() => {
            const project = projects.find(
              (candidate) => candidate.projectId === projectMenuId,
            );
            if (!project) return null;
            return createPortal(
              <div
                aria-label={ui("{{v0}} 项目操作", { v0: project.name })}
                className="fixed z-[90] min-w-36 rounded-lg border border-app-border bg-app-panel-strong p-1 shadow-[0_10px_28px_rgb(24_24_27_/_18%)]"
                data-project-overflow-menu={project.projectId}
                onBlur={(event) => {
                  const next = event.relatedTarget;
                  if (
                    next instanceof Node &&
                    event.currentTarget.contains(next)
                  ) {
                    return;
                  }
                  setProjectMenuId(null);
                }}
                onKeyDown={(event) => {
                  const items = Array.from(
                    event.currentTarget.querySelectorAll<HTMLElement>(
                      '[role="menuitem"]:not(:disabled)',
                    ),
                  );
                  const currentIndex = items.indexOf(
                    document.activeElement as HTMLElement,
                  );
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    const delta = event.key === "ArrowDown" ? 1 : -1;
                    items[
                      (currentIndex + delta + items.length) % items.length
                    ]?.focus();
                  } else if (event.key === "Home") {
                    event.preventDefault();
                    items[0]?.focus();
                  } else if (event.key === "End") {
                    event.preventDefault();
                    items.at(-1)?.focus();
                  } else if (event.key === "Tab") {
                    event.preventDefault();
                    moveFocusFromProjectMenu(
                      project.projectId,
                      event.shiftKey,
                    );
                    setProjectMenuId(null);
                  }
                }}
                ref={projectMenuRef}
                role="menu"
                style={projectMenuPosition}
              >
                <button
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium text-app-ink hover:bg-app-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
                  onClick={() => {
                    setProjectMenuId(null);
                    onRevealProject(project);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <FolderOpen aria-hidden className="h-3.5 w-3.5" />
                  {ui("打开项目目录")}
                </button>
                <button role="menuitem" type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium text-app-ink hover:bg-app-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
                  onClick={() => { focusProjectMenuTrigger(project.projectId); setProjectMenuId(null); setMoveProject(project); }}>
                  <FolderOpen aria-hidden className="h-3.5 w-3.5" />{t("projectGroups.move")}
                </button>
                {onCopyProject && <button
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium text-app-ink hover:bg-app-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional disabled:opacity-50"
                  disabled={project.status !== "available"}
                  onClick={() => { focusProjectMenuTrigger(project.projectId); setProjectMenuId(null); onCopyProject(project); }}
                  role="menuitem" type="button">
                  <Copy aria-hidden className="h-3.5 w-3.5" />{ui("复制项目")}
                </button>}
                <button
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium text-app-danger hover:bg-app-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-danger"
                  onClick={() => {
                    focusProjectMenuTrigger(project.projectId);
                    setProjectMenuId(null);
                    onRemoveProject(project);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <Trash2 aria-hidden className="h-3.5 w-3.5" />
                  {ui("删除项目")}
                </button>
              </div>,
              document.body,
            );
          })()
        : null}
    </div>
  );
}
