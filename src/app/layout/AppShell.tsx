import type { PropsWithChildren } from "react";
import type { WorkspaceProjectView } from "../../domain/workspace/models";

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
  return (
    <div className="flex min-h-screen flex-col bg-stone-950 text-stone-100">
      <header className="flex h-16 items-center gap-3 border-b border-white/10 px-6">
        <h1 className="text-lg font-semibold tracking-wide">Preshot</h1>
        <span className="text-sm text-stone-400">Photography planning</span>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Projects"
          className="flex w-64 flex-col border-r border-white/10"
        >
          <p className="px-4 pb-2 pt-4 text-xs font-medium uppercase tracking-[0.24em] text-stone-500">
            Projects
          </p>
          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-3">
            {projects.map((project) => {
              const isCurrent = project.projectId === currentProjectId;
              const isAvailable = project.status === "available";

              return (
                <li key={project.projectId}>
                  <button
                    aria-current={isCurrent ? "page" : undefined}
                    aria-label={
                      isAvailable
                        ? `Open project ${project.name}`
                        : `${project.name} (unavailable)`
                    }
                    className={`${railButtonClassName} flex flex-col items-start gap-0.5 text-left ${
                      isCurrent
                        ? "bg-white/10 text-white"
                        : "text-stone-300 hover:bg-white/5"
                    }`}
                    onClick={() => onSelectProject(project)}
                    type="button"
                  >
                    <span className="w-full truncate">{project.name}</span>
                    {!isAvailable ? (
                      <span className="text-xs font-normal text-amber-300/80">
                        Unavailable
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="space-y-2 border-t border-white/10 p-3">
            <button
              className={`${railButtonClassName} bg-amber-300 text-stone-950 hover:bg-amber-200`}
              onClick={onNewProject}
              type="button"
            >
              New project
            </button>
            <button
              className={`${railButtonClassName} border border-white/10 bg-white/[0.03] text-stone-100 hover:border-white/20 hover:bg-white/10`}
              onClick={onOpenProject}
              type="button"
            >
              Open project
            </button>
          </div>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          {error ? (
            <div
              className="border-b border-rose-400/40 bg-rose-500/10 px-6 py-3 text-sm text-rose-100"
              role="alert"
            >
              {error}
            </div>
          ) : null}
          {children}
        </div>
      </div>
    </div>
  );
}
