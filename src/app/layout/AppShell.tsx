import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { createPortal } from "react-dom";
import {
  Ellipsis,
  Focus,
  FolderOpen,
  Minimize2,
  PanelLeftOpen,
  PanelRightOpen,
  Trash2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  ASSISTANT_WIDTH,
  PROJECT_RAIL_WIDTH,
} from "../../domain/settings/models";
import type { WorkspaceProjectView } from "../../domain/workspace/models";
import { AgentPanel } from "../../features/agent/AgentPanel";
import { SettingsButton } from "../../features/settings/SettingsButton";
import { useTheme } from "../theme/ThemeContext";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";

interface AppShellProps extends PropsWithChildren {
  projects: WorkspaceProjectView[];
  currentProjectId: string;
  error?: string | null;
  onSelectProject(project: WorkspaceProjectView): void;
  onNewProject(): void;
  onOpenProject(): void;
  onRevealProject(project: WorkspaceProjectView): void;
  onRemoveProject(project: WorkspaceProjectView): void;
  getProjectSessionCount?(projectId: string): Promise<number>;
}

const railButtonClassName =
  "w-full rounded-lg px-2 py-2 text-sm font-medium transition-[background-color,border-color,color,box-shadow] duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-app-functional focus-visible:ring-offset-2 focus-visible:ring-offset-app-panel";

const MIN_CANVAS_WIDTH = 480;
const SPLITTER_WIDTH = 6;

function constrainedPanelWidth(
  requested: number,
  range: { min: number; max: number },
  otherWidth: number,
  workspaceWidth: number,
) {
  const available = workspaceWidth - otherWidth - MIN_CANVAS_WIDTH - SPLITTER_WIDTH * 2;
  return Math.min(range.max, Math.max(range.min, Math.min(requested, available)));
}

export function AppShell({
  children,
  projects,
  currentProjectId,
  error,
  onSelectProject,
  onNewProject,
  onOpenProject,
  onRevealProject,
  onRemoveProject,
  getProjectSessionCount,
}: AppShellProps) {
  const { t } = useTranslation();
  const settings = useTheme();
  const assistantOpen = settings.assistantOpen;
  const [projectMenuId, setProjectMenuId] = useState<string | null>(null);
  const [projectMenuPosition, setProjectMenuPosition] = useState({
    left: 0,
    top: 0,
  });
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const projectMenuTriggerRefs = useRef(
    new Map<string, HTMLButtonElement>(),
  );
  const [projectToRemove, setProjectToRemove] = useState<WorkspaceProjectView | null>(null);
  const [projectSessionCount, setProjectSessionCount] = useState<
    number | "loading" | "error" | null
  >(null);
  const requestProjectRemoval = (project: WorkspaceProjectView) => {
    setProjectToRemove(project);
    if (!getProjectSessionCount) {
      setProjectSessionCount(0);
      return;
    }
    setProjectSessionCount("loading");
    void getProjectSessionCount(project.projectId).then(
      (count) => setProjectSessionCount(count),
      () => setProjectSessionCount("error"),
    );
  };
  const [workspaceView, setWorkspaceView] = useState<{
    projectId: string;
    focusMode: boolean;
    overlayPanel: "projects" | "assistant" | null;
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
      | "assistant"
      | null
      | ((current: "projects" | "assistant" | null) =>
          "projects" | "assistant" | null),
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
    assistantWidth: number;
  } | null>(null);
  const panelWidths = panelWidthPreview ?? {
      projectRailWidth: settings.projectRailWidth,
      assistantWidth: settings.assistantWidth,
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
    const menuHeight = 84;
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
  }, []);
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

  const splitterProps = (side: "project" | "assistant") => {
    const isProject = side === "project";
    const value = isProject ? panelWidths.projectRailWidth : panelWidths.assistantWidth;
    const range = isProject ? PROJECT_RAIL_WIDTH : ASSISTANT_WIDTH;
    return {
      role: "separator" as const,
      tabIndex: 0,
      "aria-label": isProject ? t("shell.resizeProjectRail") : t("shell.resizeAssistant"),
      "aria-orientation": "vertical" as const,
      "aria-valuemin": range.min,
      "aria-valuemax": range.max,
      "aria-valuenow": Math.round(value),
      onDoubleClick: () => {
        const next = {
          ...panelWidths,
          [isProject ? "projectRailWidth" : "assistantWidth"]: range.default,
        };
        setPanelWidthPreview(next);
        commitWidths(next);
      },
      onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const delta = direction * 8 * (isProject ? 1 : -1);
        const workspaceWidth = event.currentTarget.parentElement?.getBoundingClientRect().width ?? Number.POSITIVE_INFINITY;
        const other = isProject
          ? (assistantOpen ? panelWidths.assistantWidth : 0)
          : panelWidths.projectRailWidth;
        const nextValue = constrainedPanelWidth(value + delta, range, other, workspaceWidth);
        const next = {
          ...panelWidths,
          [isProject ? "projectRailWidth" : "assistantWidth"]: nextValue,
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
          const requested = startWidth + delta * (isProject ? 1 : -1);
          const other = isProject
            ? (assistantOpen ? latest.assistantWidth : 0)
            : latest.projectRailWidth;
          const nextValue = constrainedPanelWidth(requested, range, other, workspaceWidth);
          latest = {
            ...latest,
            [isProject ? "projectRailWidth" : "assistantWidth"]: nextValue,
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
      <header className="flex h-[58px] shrink-0 items-center gap-3 border-b border-white/10 bg-[#17191d] px-4 text-white shadow-[0_2px_12px_rgb(0_0_0_/_16%)]">
        <span className="font-editorial grid h-7 w-7 place-items-center rounded-lg bg-app-accent text-sm font-extrabold">P</span>
        <h1 className="font-editorial text-lg font-extrabold">PRESHOT</h1>
        <span className="h-5 w-px bg-white/15" />
        <strong className="max-w-64 truncate text-sm font-semibold">
          {projects.find((project) => project.projectId === currentProjectId)?.name ?? ""}
        </strong>
        <span className="text-xs text-white/45">
          {t("shell.tagline")}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            aria-label={focusMode ? "退出专注模式" : "进入专注模式"}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-xs font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
            onClick={() => {
              setFocusMode((current) => !current);
              setOverlayPanel(null);
            }}
            type="button"
          >
            {focusMode ? <Minimize2 aria-hidden className="h-4 w-4" /> : <Focus aria-hidden className="h-4 w-4" />}
            <span>{focusMode ? "退出专注" : "专注模式"}</span>
          </button>
          <button
            aria-label={assistantOpen ? "隐藏助手面板" : "显示助手面板"}
            aria-pressed={focusMode
              ? overlayPanel === "assistant"
              : assistantOpen}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-xs font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
            onClick={() => {
              if (focusMode) {
                setOverlayPanel((current) =>
                  current === "assistant" ? null : "assistant");
                return;
              }
              settings.setAssistantOpen(!assistantOpen);
            }}
            type="button"
          >
            <PanelRightOpen aria-hidden className="h-4 w-4" />
            <span>助手</span>
          </button>
          <SettingsButton />
        </div>
      </header>
      <div
        className={focusMode ? "relative min-h-0 flex-1" : "grid min-h-0 flex-1"}
        data-testid="resizable-workspace"
        data-focus-mode={focusMode ? "true" : "false"}
        style={focusMode ? undefined : {
          gridTemplateColumns: assistantOpen
            ? `${panelWidths.projectRailWidth}px ${SPLITTER_WIDTH}px minmax(0, 1fr) ${SPLITTER_WIDTH}px ${panelWidths.assistantWidth}px`
            : `${panelWidths.projectRailWidth}px ${SPLITTER_WIDTH}px minmax(0, 1fr)`,
        }}
      >
        {focusMode ? (
          <>
            <button
              aria-label="打开项目面板"
              aria-pressed={overlayPanel === "projects"}
              className="absolute left-0 top-14 z-40 grid h-10 w-8 place-items-center rounded-r-lg border border-l-0 border-app-border bg-app-panel-strong text-app-muted shadow-md transition-colors hover:text-app-functional focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
              onClick={() => setOverlayPanel((current) =>
                current === "projects" ? null : "projects")}
              type="button"
            >
              <PanelLeftOpen aria-hidden className="h-4 w-4" />
            </button>
            <button
              aria-label="打开助手面板"
              aria-pressed={overlayPanel === "assistant"}
              className="absolute right-0 top-14 z-40 grid h-10 w-8 place-items-center rounded-l-lg border border-r-0 border-app-border bg-app-panel-strong text-app-muted shadow-md transition-colors hover:text-app-functional focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
              onClick={() => setOverlayPanel((current) =>
                current === "assistant" ? null : "assistant")}
              type="button"
            >
              <PanelRightOpen aria-hidden className="h-4 w-4" />
            </button>
          </>
        ) : null}
        {!focusMode || overlayPanel === "projects" ? (
          <nav
            aria-label={t("shell.projects")}
            className={focusMode
              ? "absolute inset-y-3 left-3 z-50 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-app-border bg-app-panel shadow-[0_16px_42px_rgb(24_24_27_/_20%)]"
              : "flex min-h-0 min-w-0 flex-col bg-app-panel"}
            style={focusMode ? { width: panelWidths.projectRailWidth } : undefined}
          >
            <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-4">
              <p className="text-[11px] font-bold text-app-ink">
                {t("shell.recentProjects")}
              </p>
              {focusMode ? (
                <button
                  aria-label="关闭项目面板"
                  className="grid h-7 w-7 place-items-center rounded-md text-app-muted hover:bg-app-panel-strong hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
                  onClick={() => setOverlayPanel(null)}
                  type="button"
                >
                  <X aria-hidden className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          <ul className="min-h-0 max-h-[38rem] space-y-1 overflow-y-auto px-3 pb-3">
            {projects.map((project) => {
              const isCurrent = project.projectId === currentProjectId;
              const isAvailable = project.status === "available";

              return (
                <li key={project.projectId}>
                  <article
                    className={`group/project relative rounded-lg border ${
                      isCurrent
                        ? "border-app-border bg-app-panel-strong shadow-[0_3px_12px_rgb(24_24_27_/_7%)]"
                        : "border-transparent hover:bg-app-panel-strong focus-within:bg-app-panel-strong"
                    }`}
                    data-project-overflow-menu={project.projectId}
                  >
                    <button
                      aria-current={isCurrent ? "page" : undefined}
                      aria-label={
                        isAvailable
                          ? t("shell.openProjectNamed", { name: project.name })
                          : t("shell.projectUnavailableNamed", { name: project.name })
                      }
                      className={`${railButtonClassName} flex items-center gap-2.5 pr-10 text-left text-app-muted hover:text-app-ink`}
                      onClick={() => {
                        setProjectMenuId(null);
                        onSelectProject(project);
                      }}
                      type="button"
                    >
                      {project.coverDataUrl ? (
                        <img alt="" className="h-10 w-12 shrink-0 rounded-md object-cover" src={project.coverDataUrl} />
                      ) : (
                        <span className="font-editorial grid h-10 w-12 shrink-0 place-items-center rounded-md bg-app-primary-soft text-xs font-bold text-app-muted">
                          {project.name.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block w-full truncate text-[11px] font-bold">{project.name}</span>
                        <span className={`mt-1 block truncate text-[9px] font-normal ${!isAvailable ? "text-app-accent" : "text-app-muted"}`}>
                          {!isAvailable ? t("shell.unavailable") : new Date(project.updatedAt).toLocaleDateString("zh-CN")}
                        </span>
                      </span>
                    </button>
                    <button
                      aria-expanded={projectMenuId === project.projectId}
                      aria-haspopup="menu"
                      aria-label={`更多项目操作 ${project.name}`}
                      className={`absolute right-2 top-1/2 z-10 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-app-muted transition-[opacity,color,background-color] hover:bg-app-primary-soft hover:text-app-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional ${
                        isCurrent || projectMenuId === project.projectId
                          ? "opacity-100"
                          : "opacity-0 group-hover/project:opacity-100 group-focus-within/project:opacity-100"
                      }`}
                      onClick={() =>
                        setProjectMenuId((current) => {
                          if (current === project.projectId) return null;
                          positionProjectMenu(project.projectId);
                          return project.projectId;
                        })}
                      id={`project-overflow-trigger-${project.projectId}`}
                      ref={(element) => {
                        if (element) {
                          projectMenuTriggerRefs.current.set(
                            project.projectId,
                            element,
                          );
                        } else {
                          projectMenuTriggerRefs.current.delete(
                            project.projectId,
                          );
                        }
                      }}
                      title="更多项目操作"
                      type="button"
                    >
                      <Ellipsis aria-hidden className="h-4 w-4" />
                    </button>
                  </article>
                </li>
              );
            })}
          </ul>
          <div aria-hidden className="min-h-0 flex-1" />
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
            {...splitterProps("project")}
            className="group relative z-30 cursor-col-resize bg-[#d5d6da] transition-colors duration-200 hover:bg-app-accent focus-visible:bg-app-accent focus-visible:outline-none"
            title={t("shell.resizePanelHint")}
          >
            <span className="absolute left-1/2 top-1/2 h-10 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-app-muted/50 group-hover:bg-white" />
          </div>
        ) : null}
        <div className={focusMode
          ? "flex h-full min-h-0 min-w-0 flex-col"
          : "flex min-h-0 min-w-0 flex-col"}
        >
          {error ? (
            <div
              className="border-b border-rose-200 bg-rose-50 px-6 py-3 text-sm text-rose-700 dark:border-rose-400/40 dark:bg-rose-500/10 dark:text-rose-100"
              role="alert"
            >
              {t("errors.workspace")}
            </div>
          ) : null}
          {children}
        </div>
        {!focusMode && assistantOpen ? (
          <div
            {...splitterProps("assistant")}
            className="group relative z-30 cursor-col-resize bg-[#d5d6da] transition-colors duration-200 hover:bg-app-accent focus-visible:bg-app-accent focus-visible:outline-none"
            title={t("shell.resizePanelHint")}
          >
            <span className="absolute left-1/2 top-1/2 h-10 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-app-muted/50 group-hover:bg-white" />
          </div>
        ) : null}
        {(!focusMode && assistantOpen) || overlayPanel === "assistant" ? (
          <div
            className={focusMode
              ? "absolute inset-y-3 right-3 z-50 flex min-h-0 overflow-hidden rounded-xl border border-app-border bg-app-panel shadow-[0_16px_42px_rgb(24_24_27_/_20%)] [&>aside]:h-full [&>aside]:w-full"
              : "flex min-h-0 min-w-0 [&>aside]:h-full [&>aside]:w-full"}
            style={focusMode ? { width: panelWidths.assistantWidth } : undefined}
          >
            {focusMode ? (
              <button
                aria-label="关闭助手面板"
                className="absolute right-3 top-3 z-10 grid h-7 w-7 place-items-center rounded-md text-app-muted hover:bg-app-panel-strong hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
                onClick={() => setOverlayPanel(null)}
                type="button"
              >
                <X aria-hidden className="h-4 w-4" />
              </button>
            ) : null}
            <AgentPanel />
          </div>
        ) : null}
      </div>
      {projectMenuId
        ? (() => {
            const project = projects.find(
              (candidate) => candidate.projectId === projectMenuId,
            );
            if (!project) return null;
            return createPortal(
              <div
                aria-label={`${project.name} 项目操作`}
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
                      '[role="menuitem"]',
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
                  打开项目目录
                </button>
                <button
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium text-app-danger hover:bg-app-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-danger"
                  onClick={() => {
                    focusProjectMenuTrigger(project.projectId);
                    setProjectMenuId(null);
                    requestProjectRemoval(project);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <Trash2 aria-hidden className="h-3.5 w-3.5" />
                  删除项目
                </button>
              </div>,
              document.body,
            );
          })()
        : null}
      <ConfirmDialog
        cancelLabel="取消"
        confirmLabel="从列表移除"
        confirmDisabled={projectSessionCount === "loading"}
        onCancel={() => {
          setProjectToRemove(null);
          setProjectSessionCount(null);
        }}
        onConfirm={() => {
          if (projectToRemove) onRemoveProject(projectToRemove);
          setProjectToRemove(null);
          setProjectSessionCount(null);
        }}
        open={projectToRemove !== null}
        title={projectSessionCount === "loading"
          ? "正在检查关联的助手会话…"
          : projectSessionCount === "error"
          ? "无法统计助手会话；移除项目仍会执行安全清理"
          : `仅从最近项目移除，磁盘文件不会被删除；将删除 ${
            projectSessionCount ?? 0
          } 个助手会话`}
      />
    </div>
  );
}
