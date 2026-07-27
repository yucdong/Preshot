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
  const sharedClassName =
    "relative flex aspect-[4/5] w-full items-end overflow-hidden rounded-[2rem] border border-white/10 bg-stone-900";

  if (project.coverDataUrl) {
    return (
      <div className={sharedClassName}>
        <img
          alt={`${project.name} cover`}
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
  "inline-flex items-center justify-center rounded-full border border-white/15 px-4 py-2 text-sm font-medium text-stone-100 transition hover:border-white/30 hover:bg-white/8 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-50";

export function ProjectCard({
  project,
  disabled = false,
  onOpen,
  onRelocate,
  onRemove,
  primaryActionRef,
}: ProjectCardProps) {
  const details = (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent p-6 text-left">
      <p className="text-xs uppercase tracking-[0.24em] text-stone-300">
        {project.status === "available" ? "Recent project" : "Unavailable"}
      </p>
      <h3 className="mt-3 text-2xl font-semibold text-white">{project.name}</h3>
      {project.status === "available" ? (
        <p className="mt-2 text-sm text-stone-300">Open your photography workspace.</p>
      ) : (
        <p className="mt-2 text-sm text-stone-300">
          This project moved or is missing from its last known location.
        </p>
      )}
    </div>
  );

  if (project.status === "available") {
    return (
      <article className="relative min-w-0">
        <button
          aria-label={`Open project ${project.name}`}
          className="group relative block w-full rounded-[2rem] text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          onClick={() => onOpen(project)}
          ref={primaryActionRef}
          type="button"
        >
          <ProjectArt project={project} />
          <div className="absolute inset-0 transition group-hover:bg-white/4">{details}</div>
        </button>
      </article>
    );
  }

  return (
    <article className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-4 shadow-2xl shadow-black/20">
      <div className="relative">
        <ProjectArt dimmed project={project} />
        <div className="absolute inset-0">{details}</div>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          aria-label={`Relocate project ${project.name}`}
          className={actionButtonClassName}
          disabled={disabled}
          onClick={() => onRelocate(project)}
          ref={primaryActionRef}
          type="button"
        >
          Relocate project
        </button>
        <button
          aria-label={`Remove ${project.name} from recent projects`}
          className={actionButtonClassName}
          disabled={disabled}
          onClick={() => onRemove(project)}
          type="button"
        >
          Remove from recent projects
        </button>
      </div>
    </article>
  );
}
