import { useState, type PropsWithChildren } from "react";
import { useTranslation } from "react-i18next";
import {
  ASSISTANT_WIDTH,
  PROJECT_RAIL_WIDTH,
} from "../../domain/settings/models";
import type { WorkspaceProjectView } from "../../domain/workspace/models";
import { AgentPanel } from "../../features/agent/AgentPanel";
import { SettingsButton } from "../../features/settings/SettingsButton";
import { useTheme } from "../theme/ThemeProvider";

interface AppShellProps extends PropsWithChildren {
  projects: WorkspaceProjectView[];
  currentProjectId: string;
  error?: string | null;
  onSelectProject(project: WorkspaceProjectView): void;
  onNewProject(): void;
  onOpenProject(): void;
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
}: AppShellProps) {
  const { t } = useTranslation();
  const settings = useTheme();
  const [panelWidthPreview, setPanelWidthPreview] = useState<{
    projectRailWidth: number;
    assistantWidth: number;
  } | null>(null);
  const panelWidths = panelWidthPreview ?? {
      projectRailWidth: settings.projectRailWidth,
      assistantWidth: settings.assistantWidth,
  };

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
        const other = isProject ? panelWidths.assistantWidth : panelWidths.projectRailWidth;
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
          const other = isProject ? latest.assistantWidth : latest.projectRailWidth;
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
        <div className="ml-auto mr-28">
          <SettingsButton />
        </div>
      </header>
      <div
        className="grid min-h-0 flex-1"
        data-testid="resizable-workspace"
        style={{
          gridTemplateColumns: `${panelWidths.projectRailWidth}px ${SPLITTER_WIDTH}px minmax(0, 1fr) ${SPLITTER_WIDTH}px ${panelWidths.assistantWidth}px`,
        }}
      >
        <nav
          aria-label={t("shell.projects")}
          className="flex min-h-0 min-w-0 flex-col bg-app-panel"
        >
          <p className="shrink-0 px-4 pb-2 pt-4 text-[11px] font-bold text-app-ink">
            {t("shell.recentProjects")}
          </p>
          <ul className="min-h-0 max-h-[38rem] space-y-1 overflow-y-auto px-3 pb-3">
            {projects.map((project) => {
              const isCurrent = project.projectId === currentProjectId;
              const isAvailable = project.status === "available";

              return (
                <li key={project.projectId}>
                  <button
                    aria-current={isCurrent ? "page" : undefined}
                    aria-label={
                      isAvailable
                        ? t("shell.openProjectNamed", { name: project.name })
                        : t("shell.projectUnavailableNamed", { name: project.name })
                    }
                    className={`${railButtonClassName} flex items-center gap-2.5 border text-left ${
                      isCurrent
                        ? "border-app-border bg-app-panel-strong text-app-ink shadow-[0_3px_12px_rgb(24_24_27_/_7%)]"
                        : "border-transparent text-app-muted hover:bg-app-panel-strong hover:text-app-ink"
                    }`}
                    onClick={() => onSelectProject(project)}
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
        <div
          {...splitterProps("project")}
          className="group relative z-30 cursor-col-resize bg-[#d5d6da] transition-colors duration-200 hover:bg-app-accent focus-visible:bg-app-accent focus-visible:outline-none"
          title={t("shell.resizePanelHint")}
        >
          <span className="absolute left-1/2 top-1/2 h-10 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-app-muted/50 group-hover:bg-white" />
        </div>
        <div className="flex min-h-0 min-w-0 flex-col">
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
        <div
          {...splitterProps("assistant")}
          className="group relative z-30 cursor-col-resize bg-[#d5d6da] transition-colors duration-200 hover:bg-app-accent focus-visible:bg-app-accent focus-visible:outline-none"
          title={t("shell.resizePanelHint")}
        >
          <span className="absolute left-1/2 top-1/2 h-10 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-app-muted/50 group-hover:bg-white" />
        </div>
        <AgentPanel />
      </div>
    </div>
  );
}
