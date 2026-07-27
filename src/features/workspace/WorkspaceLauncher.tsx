import { useState } from "react";
import type { WorkspaceProjectView } from "../../domain/workspace/models";
import { NewProjectDialog } from "./NewProjectDialog";
import { ProjectRail } from "./ProjectRail";

export interface WorkspaceLauncherProps {
  projects: WorkspaceProjectView[];
  loading: boolean;
  error: string | null;
  isCreateDialogOpen: boolean;
  onOpen(project: WorkspaceProjectView): Promise<void> | void;
  onRequestCreate(): Promise<void> | void;
  onCancelCreate(): void;
  onCreate(name: string): Promise<void> | void;
  onOpenExisting(): Promise<void> | void;
  onRelocate(project: WorkspaceProjectView): Promise<void> | void;
  onRemove(project: WorkspaceProjectView): Promise<void> | void;
}

const actionButtonClassName =
  "inline-flex items-center justify-center rounded-full px-5 py-3 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-50";

export function WorkspaceLauncher({
  projects,
  loading,
  error,
  isCreateDialogOpen,
  onOpen,
  onRequestCreate,
  onCancelCreate,
  onCreate,
  onOpenExisting,
  onRelocate,
  onRemove,
}: WorkspaceLauncherProps) {
  const [busyAction, setBusyAction] = useState<string | null>(null);

  async function runAction(actionKey: string, action: () => Promise<void> | void) {
    if (busyAction) {
      return;
    }

    setBusyAction(actionKey);

    try {
      await Promise.resolve(action()).then(
        () => undefined,
        () => undefined,
      );
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <main className="min-h-screen bg-stone-950 px-8 py-10 text-stone-100">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-7xl flex-col rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.12),_transparent_45%),linear-gradient(180deg,_rgba(28,25,23,0.98),_rgba(12,10,9,1))] p-8 shadow-2xl shadow-black/30">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-white/10 pb-8">
          <div className="max-w-2xl">
            <p className="text-xs uppercase tracking-[0.3em] text-stone-400">
              Preshot
            </p>
            <h1 className="mt-3 text-5xl font-semibold tracking-tight text-white">
              Preshot
            </h1>
            <p className="mt-4 text-base leading-7 text-stone-300">
              Launch a recent workspace, create a fresh production, or open an
              existing project from your desktop library.
            </p>
            <p className="mt-3 text-sm text-stone-500">
              File menu actions stay in sync with the launcher for new windows and
              quick reopening.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              className={`${actionButtonClassName} bg-amber-300 text-stone-950 hover:bg-amber-200`}
              disabled={Boolean(busyAction)}
              onClick={() =>
                void runAction("request-create", () => onRequestCreate())
              }
              type="button"
            >
              New project
            </button>
            <button
              className={`${actionButtonClassName} border border-white/10 bg-white/[0.03] text-stone-100 hover:border-white/20 hover:bg-white/8`}
              disabled={Boolean(busyAction)}
              onClick={() =>
                void runAction("open-existing", () => onOpenExisting())
              }
              type="button"
            >
              Open project
            </button>
          </div>
        </header>

        <div className="flex flex-1 flex-col justify-center py-8">
          {loading ? (
            <div
              aria-live="polite"
              className="mb-6 inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-stone-300"
              role="status"
            >
              <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
              Loading recent projects
            </div>
          ) : null}

          {error ? (
            <div
              className="mb-6 rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100"
              role="alert"
            >
              {error}
            </div>
          ) : null}

          {projects.length ? (
            <ProjectRail
              disabled={Boolean(busyAction)}
              onOpen={(project) =>
                runAction(`open:${project.projectId}`, () => onOpen(project))
              }
              onRelocate={(project) =>
                runAction(`relocate:${project.projectId}`, () => onRelocate(project))
              }
              onRemove={(project) =>
                runAction(`remove:${project.projectId}`, () => onRemove(project))
              }
              projects={projects}
            />
          ) : (
            <section className="rounded-[2rem] border border-dashed border-white/15 bg-white/[0.02] p-10 text-center">
              <p className="text-xs uppercase tracking-[0.24em] text-stone-400">
                Workspace launcher
              </p>
              <h2 className="mt-4 text-3xl font-semibold text-white">
                Start your next photography plan
              </h2>
              <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-stone-300">
                Create a new Preshot project or open one that already lives on this
                PC.
              </p>
            </section>
          )}
        </div>
      </div>

      {isCreateDialogOpen ? (
        <NewProjectDialog
          onClose={onCancelCreate}
          onCreate={onCreate}
        />
      ) : null}
    </main>
  );
}
