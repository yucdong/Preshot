import { useState } from "react";
import { useTranslation } from "react-i18next";
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
  "inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-app-primary disabled:cursor-not-allowed disabled:opacity-50";

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
  const { t } = useTranslation();
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
    <main className="min-h-screen bg-app-bg text-app-ink">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-8 py-8">
        <header className="flex flex-wrap items-center justify-between gap-6 rounded-lg bg-[#17191d] px-6 py-5 text-white shadow-[0_8px_24px_rgb(23_25_29_/_16%)]">
          <div className="max-w-2xl">
            <h1 className="font-editorial text-3xl font-extrabold">
              PRESHOT
            </h1>
            <p className="mt-2 text-sm leading-6 text-white/75">
              {t("workspace.intro")}
            </p>
            <p className="mt-1 text-xs text-white/40">
              {t("workspace.menuHint")}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              className={`${actionButtonClassName} bg-app-accent text-white hover:bg-app-accent-hover active:scale-[0.98]`}
              disabled={Boolean(busyAction)}
              onClick={() =>
                void runAction("request-create", () => onRequestCreate())
              }
              type="button"
            >
              {t("workspace.newProject")}
            </button>
            <button
              className={`${actionButtonClassName} border border-white/15 bg-white/[0.06] text-white hover:bg-white/10 active:scale-[0.98]`}
              disabled={Boolean(busyAction)}
              onClick={() =>
                void runAction("open-existing", () => onOpenExisting())
              }
              type="button"
            >
              {t("workspace.openProject")}
            </button>
          </div>
        </header>

        <div className="flex flex-1 flex-col justify-center py-8">
          {loading ? (
            <div
              aria-live="polite"
              className="mb-6 inline-flex items-center gap-3 rounded-lg border border-app-border bg-app-panel px-4 py-2 text-sm text-app-muted"
              role="status"
            >
              <span className="h-2.5 w-2.5 rounded-full bg-app-primary" />
              {t("workspace.loading")}
            </div>
          ) : null}

          {error ? (
            <div
              className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-400/40 dark:bg-rose-500/10 dark:text-rose-100"
              role="alert"
            >
              {t("errors.workspace")}
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
            <section className="py-16 text-center">
              <p className="text-xs font-semibold text-app-primary">
                {t("workspace.launcherEyebrow")}
              </p>
              <h2 className="mt-4 text-2xl font-semibold">
                {t("workspace.emptyTitle")}
              </h2>
              <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-app-muted">
                {t("workspace.emptyBody")}
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
