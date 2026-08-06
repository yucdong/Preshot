import type { PropsWithChildren } from "react";
import { useTranslation } from "react-i18next";
import type { WorkspaceProjectView } from "../../domain/workspace/models";
import { AgentPanel } from "../../features/agent/AgentPanel";
import { SettingsButton } from "../../features/settings/SettingsButton";

interface AppShellProps extends PropsWithChildren {
  projects: WorkspaceProjectView[];
  currentProjectId: string;
  error?: string | null;
  onSelectProject(project: WorkspaceProjectView): void;
  onNewProject(): void;
  onOpenProject(): void;
}

const railButtonClassName =
  "w-full rounded-lg px-3 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300";

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

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-stone-100 text-stone-800 dark:bg-stone-950 dark:text-stone-100">
      <header className="flex h-16 items-center gap-3 border-b border-stone-200 px-6 dark:border-white/10">
        <h1 className="text-lg font-semibold tracking-wide">Preshot</h1>
        <span className="text-sm text-stone-500 dark:text-stone-400">{t("shell.tagline")}</span>
        <div className="ml-auto">
          <SettingsButton />
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[15fr_60fr_25fr]">
        <nav
          aria-label={t("shell.projects")}
          className="flex min-h-0 min-w-0 flex-col border-r border-stone-200 dark:border-white/10"
        >
          <p className="shrink-0 px-4 pb-2 pt-4 text-xs font-medium uppercase tracking-[0.24em] text-stone-500 dark:text-stone-500">
            {t("shell.projects")}
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
                    className={`${railButtonClassName} flex flex-col items-start gap-0.5 text-left ${
                      isCurrent
                        ? "bg-stone-200 text-stone-900 dark:bg-white/10 dark:text-white"
                        : "text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-white/5"
                    }`}
                    onClick={() => onSelectProject(project)}
                    type="button"
                  >
                    <span className="w-full truncate">{project.name}</span>
                    {!isAvailable ? (
                      <span className="text-xs font-normal text-amber-600 dark:text-amber-300/80">
                        {t("shell.unavailable")}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
          <div aria-hidden className="min-h-0 flex-1" />
          <div className="shrink-0 space-y-2 border-t border-stone-200 p-3 dark:border-white/10">
            <button
              className={`${railButtonClassName} bg-amber-300 text-stone-950 hover:bg-amber-200`}
              onClick={onNewProject}
              type="button"
            >
              {t("shell.newProject")}
            </button>
            <button
              className={`${railButtonClassName} border border-stone-300 bg-white text-stone-800 hover:border-stone-400 hover:bg-stone-50 dark:border-white/10 dark:bg-white/[0.03] dark:text-stone-100 dark:hover:border-white/20 dark:hover:bg-white/10`}
              onClick={onOpenProject}
              type="button"
            >
              {t("shell.openProject")}
            </button>
          </div>
        </nav>
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
        <AgentPanel />
      </div>
    </div>
  );
}
