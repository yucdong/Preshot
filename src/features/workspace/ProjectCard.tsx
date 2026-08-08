import { useTranslation } from "react-i18next";
import type { WorkspaceProjectView } from "../../domain/workspace/models";

interface ProjectCardProps {
  project: WorkspaceProjectView;
  disabled?: boolean;
  onOpen(project: WorkspaceProjectView): Promise<void> | void;
  onRelocate(project: WorkspaceProjectView): Promise<void> | void;
  onRemove(project: WorkspaceProjectView): Promise<void> | void;
  primaryActionRef?: (element: HTMLButtonElement | null) => void;
}

function getNameGradient(name: string) {
  const hash = Array.from(name).reduce((value, character) => {
    return character.charCodeAt(0) + ((value << 5) - value);
  }, 0);
  const start = Math.abs(hash) % 360;
  const end = (start + 42) % 360;

  return `linear-gradient(135deg, hsl(${start} 68% 38%), hsl(${end} 68% 18%))`;
}

function ProjectArt({ project, dimmed = false }: { project: WorkspaceProjectView; dimmed?: boolean }) {
  const { t } = useTranslation();
  const sharedClassName =
    "relative flex aspect-[4/5] w-full items-end overflow-hidden rounded-lg border border-app-border bg-app-panel";

  if (project.coverDataUrl) {
    return (
      <div className={sharedClassName}>
        <img
          alt={t("card.coverAlt", { name: project.name })}
          className={`h-full w-full object-cover ${dimmed ? "opacity-35" : ""}`}
          src={project.coverDataUrl}
        />
      </div>
    );
  }

  return (
    <div className={sharedClassName}>
      <div
        aria-hidden="true"
        className={`absolute inset-0 ${dimmed ? "opacity-45" : ""}`}
        style={{ background: getNameGradient(project.name) }}
      />
    </div>
  );
}

const actionButtonClassName =
  "inline-flex items-center justify-center rounded-lg border border-app-border px-4 py-2 text-sm font-medium text-app-ink transition-[border-color,color,background-color,transform] duration-200 hover:border-[#202329] hover:bg-app-primary-soft active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-app-functional disabled:cursor-not-allowed disabled:opacity-50";

export function ProjectCard({
  project,
  disabled = false,
  onOpen,
  onRelocate,
  onRemove,
  primaryActionRef,
}: ProjectCardProps) {
  const { t } = useTranslation();
  const details = (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent p-6 text-left dark:from-black/85 dark:via-black/35">
      <p className="text-xs font-semibold text-white/80">
        {project.status === "available" ? t("card.recentProject") : t("card.unavailable")}
      </p>
      <h3 className="font-editorial mt-3 text-2xl font-bold text-white">{project.name}</h3>
      {project.status === "available" ? (
        <p className="mt-2 text-sm text-white/80">{t("card.openHint")}</p>
      ) : (
        <p className="mt-2 text-sm text-white/80">
          {t("card.movedHint")}
        </p>
      )}
    </div>
  );

  if (project.status === "available") {
    return (
      <article className="relative min-w-0">
        <button
          aria-label={t("card.openAria", { name: project.name })}
          className="group relative block w-full rounded-lg text-left transition-transform duration-200 hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-app-functional disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          onClick={() => onOpen(project)}
          ref={primaryActionRef}
          type="button"
        >
          <ProjectArt project={project} />
          <div className="absolute inset-0 transition group-hover:bg-white/4 dark:group-hover:bg-white/4">{details}</div>
        </button>
      </article>
    );
  }

  return (
    <article className="rounded-lg border border-app-border bg-app-panel-strong p-4 shadow-[var(--app-shadow)]">
      <div className="relative">
        <ProjectArt dimmed project={project} />
        <div className="absolute inset-0">{details}</div>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          aria-label={t("card.relocateAria", { name: project.name })}
          className={actionButtonClassName}
          disabled={disabled}
          onClick={() => onRelocate(project)}
          ref={primaryActionRef}
          type="button"
        >
          {t("card.relocate")}
        </button>
        <button
          aria-label={t("card.removeAria", { name: project.name })}
          className={actionButtonClassName}
          disabled={disabled}
          onClick={() => onRemove(project)}
          type="button"
        >
          {t("card.remove")}
        </button>
      </div>
    </article>
  );
}
