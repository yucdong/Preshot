import { useDraggable } from "@dnd-kit/core";
import { Ellipsis } from "lucide-react";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import type { WorkspaceProjectView } from "../../domain/workspace/models";
import { matchingNameRanges } from "../../domain/workspace/organization";
import { ui, uiLocale } from "../../shared/i18n/ui";

interface Props {
  project: WorkspaceProjectView;
  current: boolean;
  query: string;
  disabled: boolean;
  menuOpen: boolean;
  onOpen(): void;
  onMenu(): void;
  menuRef(element: HTMLButtonElement | null): void;
}

function HighlightedName({ name, query }: { name: string; query: string }) {
  const ranges = matchingNameRanges(name, query);
  const parts = ranges.map(([start, end], index) => {
    const before = name.slice(index ? ranges[index - 1][1] : 0, start);
    return <Fragment key={start}>{before}<mark className="rounded-sm bg-app-primary-soft text-app-ink">{name.slice(start, end)}</mark></Fragment>;
  });
  return <>{parts}{name.slice(ranges.at(-1)?.[1] ?? 0)}</>;
}

export function ProjectListItem({ project, current, query, disabled, menuOpen, onOpen, onMenu, menuRef }: Props) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: project.projectId, disabled });
  return <li ref={setNodeRef} data-sidebar-project={project.projectId} className={isDragging ? "opacity-40" : undefined}>
    <article data-project-overflow-menu={project.projectId} className={`group/project relative rounded-lg border ${current ? "border-app-border bg-app-panel-strong" : "border-transparent hover:bg-app-panel-strong focus-within:bg-app-panel-strong"}`}>
      <button {...attributes} {...listeners} type="button" disabled={disabled}
        aria-current={current ? "page" : undefined}
        aria-label={t(project.status === "available" ? "shell.openProjectNamed" : "shell.projectUnavailableNamed", { name: project.name })}
        title={project.name} onClick={onOpen}
        className="flex min-h-12 w-full touch-none items-center gap-2 rounded-lg py-1.5 pl-2 pr-8 text-left text-app-muted hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional">
        <span aria-hidden className="font-editorial grid h-7 w-7 shrink-0 cursor-grab place-items-center rounded-md bg-app-primary-soft text-[10px] font-bold active:cursor-grabbing">{Array.from(project.name).slice(0, 2).join("").toUpperCase()}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold"><HighlightedName name={project.name} query={query} /></span>
          <span className={`mt-0.5 block truncate text-[10px] ${project.status === "available" ? "text-app-muted" : "text-app-accent"}`}>
            {project.status === "available" ? new Date(project.updatedAt).toLocaleDateString(uiLocale()) : t("shell.unavailable")}
          </span>
        </span>
      </button>
      <button type="button" disabled={disabled} aria-haspopup="menu" aria-expanded={menuOpen}
        aria-label={ui("更多项目操作 {{v0}}", { v0: project.name })} title={ui("更多项目操作")}
        id={`project-overflow-trigger-${project.projectId}`} ref={menuRef} onClick={onMenu}
        className={`absolute right-1 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-app-muted hover:bg-app-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional ${current || menuOpen ? "opacity-100" : "opacity-0 group-hover/project:opacity-100 group-focus-within/project:opacity-100"}`}>
        <Ellipsis aria-hidden className="h-4 w-4" />
      </button>
    </article>
  </li>;
}
