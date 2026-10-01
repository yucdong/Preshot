import { DndContext, DragOverlay, PointerSensor, pointerWithin, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { ChevronDown, ChevronRight, Ellipsis, Plus, Search, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { ProjectGroup, ProjectOrganization, WorkspaceProjectView } from "../../domain/workspace/models";
import { normalizedProjectQuery, projectGroupId, projectMatchesQuery, WorkspaceOrganizationError, type ProjectOrganizationCommand } from "../../domain/workspace/organization";
import { sortProjectsByRecentEdit } from "../../domain/workspace/registry";
import { ProjectGroupDialog, type GroupDialogRequest } from "./ProjectGroupDialog";
import { ProjectListItem } from "./ProjectListItem";

interface Props {
  projects: WorkspaceProjectView[];
  organization: ProjectOrganization;
  currentProjectId: string;
  query: string;
  onQueryChange(query: string): void;
  onChange(command: ProjectOrganizationCommand): Promise<void>;
  onSelectProject(project: WorkspaceProjectView): void;
  menuProjectId: string | null;
  onProjectMenu(project: WorkspaceProjectView): void;
  registerMenuTrigger(id: string, element: HTMLButtonElement | null): void;
  moveProject: WorkspaceProjectView | null;
  onMoveDialogClose(): void;
}

const iconButton = "grid h-7 w-7 shrink-0 place-items-center rounded-md text-app-muted hover:bg-app-primary-soft hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional disabled:opacity-40";

function GroupSection({ group, name, count, total, searching, expanded, disabled, onToggle, onRename, onDelete, children }: {
  group: ProjectGroup; name: string; count: number; total: number; searching: boolean; expanded: boolean; disabled: boolean;
  onToggle(): void; onRename(): void; onDelete(): void; children: ReactNode;
}) {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({ id: group.id, disabled });
  const [menu, setMenu] = useState<{ left: number; top: number } | null>(null);
  const menuOpen = menu !== null;
  const menuRef = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const focus = window.requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true }));
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target) && !trigger.current?.contains(event.target)) setMenu(null);
    };
    const scroll = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      setMenu(current => current ? { left: Math.max(8, Math.min(rect.right - 128, window.innerWidth - 136)), top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 48)) } : null);
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", scroll);
    return () => { window.cancelAnimationFrame(focus); document.removeEventListener("pointerdown", outside, true); document.removeEventListener("scroll", scroll, true); window.removeEventListener("resize", scroll); };
  }, [menuOpen]);
  return <section ref={setNodeRef} data-project-group={group.id} aria-label={name}
    className={`mb-1 rounded-lg border ${isOver ? "border-app-functional bg-app-primary-soft" : "border-transparent"}`}>
    <div className="flex min-h-8 min-w-0 items-center gap-0.5">
      <button type="button" aria-label={name} aria-expanded={expanded} title={name} disabled={disabled || searching} onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-1 rounded-md py-1.5 text-left text-xs font-semibold text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional">
        {expanded ? <ChevronDown aria-hidden className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate">{name}</span>
      </button>
      <span className="shrink-0 px-0.5 text-[10px] tabular-nums text-app-muted">{searching ? `${count} / ${total}` : total}</span>
      {group.id !== "default" && <>
        <button ref={trigger} type="button" disabled={disabled} className={iconButton} aria-label={t("projectGroups.actions", { name })} aria-haspopup="menu" aria-expanded={Boolean(menu)}
          onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setMenu(menu ? null : { left: Math.max(8, Math.min(rect.right - 128, window.innerWidth - 136)), top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 48)) }); }}>
          <Ellipsis aria-hidden className="h-3.5 w-3.5" />
        </button>
        <button type="button" disabled={disabled} className={iconButton + " hover:text-app-danger"} aria-label={t("projectGroups.deleteNamed", { name })} title={t("projectGroups.delete")} onClick={onDelete}>
          <Trash2 aria-hidden className="h-3.5 w-3.5" />
        </button>
      </>}
    </div>
    {expanded && children}
    {menu && createPortal(<div ref={menuRef} role="menu" aria-label={t("projectGroups.actions", { name })} style={menu}
      className="fixed z-[100] min-w-32 rounded-lg border border-app-border bg-app-panel-strong p-1 text-app-ink shadow-lg"
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setMenu(null); }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); setMenu(null); trigger.current?.focus(); }
        if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) { event.preventDefault(); menuRef.current?.querySelector("button")?.focus(); }
      }}>
      <button type="button" role="menuitem" className="w-full rounded-md px-3 py-2 text-left text-xs hover:bg-app-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
        onClick={() => { trigger.current?.focus(); setMenu(null); onRename(); }}>{t("projectGroups.rename")}</button>
    </div>, document.body)}
  </section>;
}

export function ProjectGroups({ projects, organization, currentProjectId, query, onQueryChange, onChange, onSelectProject, menuProjectId, onProjectMenu, registerMenuTrigger, moveProject, onMoveDialogClose }: Props) {
  const { t } = useTranslation();
  const [input, setInput] = useState(query);
  const composing = useRef(false);
  const [request, setRequest] = useState<GroupDialogRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<ProjectOrganizationCommand | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [dragged, setDragged] = useState<string | null>(null);
  const releaseGroup = useRef<string | null>(null);
  const suppressClick = useRef(false);
  const root = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const searching = Boolean(normalizedProjectQuery(query));
  const dialog = request ?? (moveProject ? { type: "move" as const, project: moveProject } : null);
  const activeProject = projects.find(project => project.projectId === dragged);

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [query]);

  useEffect(() => {
    if (!dragged) return;
    // Resolve the physical target on release; dnd-kit's last hover may be stale.
    const release = (event: PointerEvent) => {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-project-group]");
      releaseGroup.current = target && root.current?.contains(target) ? target.dataset.projectGroup ?? null : null;
    };
    document.addEventListener("pointerup", release, true);
    return () => document.removeEventListener("pointerup", release, true);
  }, [dragged]);

  function closeDialog() { if (pending.current) return; setRequest(null); onMoveDialogClose(); setError(null); setRetry(null); }
  async function commit(command: ProjectOrganizationCommand): Promise<boolean> {
    if (pending.current) return false;
    pending.current = true; setBusy(true); setError(null); setRetry(command);
    try {
      await onChange(command);
      setRetry(null); setAnnouncement(t("projectGroups.saved"));
      return true;
    } catch (failure) {
      setError(failure instanceof WorkspaceOrganizationError ? t(`projectGroups.errors.${failure.code}`) : t("projectGroups.saveFailed", { detail: failure instanceof Error ? failure.message : String(failure) }));
      return false;
    } finally { pending.current = false; setBusy(false); }
  }
  function endDrag(event: DragEndEvent) {
    setDragged(null);
    window.setTimeout(() => { suppressClick.current = false; }, 0);
    const groupId = releaseGroup.current;
    releaseGroup.current = null;
    if (!groupId || !organization.groups.some(group => group.id === groupId)) return;
    const projectId = String(event.active.id);
    if (!projects.some(project => project.projectId === projectId) || projectGroupId(organization, projectId) === groupId) return;
    void commit({ type: "move", projectId, groupId });
  }
  function clearSearch() { composing.current = false; setInput(""); onQueryChange(""); }
  const sorted = sortProjectsByRecentEdit(projects);
  const matches = sorted.filter(project => projectMatchesQuery(project.name, query));
  const disabled = busy || Boolean(dragged);
  return <section ref={root} aria-label={t("shell.allProjects")} className="flex min-h-0 flex-1 flex-col border-t border-app-border">
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 px-3 pb-2 pt-3">
      <h2 className="text-[11px] font-bold text-app-ink">{t("shell.allProjects")}</h2>
      <button ref={createButton} type="button" disabled={disabled} className="flex min-h-7 items-center gap-1 rounded-md px-1 text-[11px] font-medium text-app-muted hover:bg-app-primary-soft hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
        onClick={() => { setError(null); setRequest({ type: "create", groupId: crypto.randomUUID() }); }}>
        <Plus aria-hidden className="h-3.5 w-3.5" />{t("projectGroups.create")}
      </button>
    </div>
    <div className="relative mx-3 mb-2 shrink-0">
      <Search aria-hidden className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-app-muted" />
      <input type="search" aria-label={t("projectGroups.search")} placeholder={t("projectGroups.search")} value={input} disabled={Boolean(dragged)}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={event => { composing.current = false; setInput(event.currentTarget.value); onQueryChange(event.currentTarget.value); }}
        onChange={event => { setInput(event.target.value); if (!composing.current) onQueryChange(event.target.value); }}
        onKeyDown={event => { event.stopPropagation(); if (event.key === "Escape" && !event.nativeEvent.isComposing && !composing.current) { event.preventDefault(); clearSearch(); } }}
        className="h-8 w-full rounded-md border border-app-border bg-app-panel-strong pl-7 pr-7 text-xs text-app-ink placeholder:text-app-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional [&::-webkit-search-cancel-button]:hidden" />
      {input && <button type="button" disabled={Boolean(dragged)} aria-label={t("projectGroups.clearSearch")} onClick={clearSearch} className={iconButton + " absolute right-0.5 top-0.5"}><X aria-hidden className="h-3.5 w-3.5" /></button>}
    </div>
    {!dialog && error && <div role="alert" className="mx-3 mb-2 text-xs text-app-danger">{error}{retry && <button type="button" disabled={busy} className="ml-1 underline" onClick={() => { void commit(retry); }}>{t("projectGroups.retry")}</button>}</div>}
    <DndContext sensors={sensors} collisionDetection={pointerWithin}
      accessibility={{ screenReaderInstructions: { draggable: t("projectGroups.dragInstructions") }, announcements: {
        onDragStart: () => t("projectGroups.dragStarted"), onDragOver: ({ over }) => over ? t("projectGroups.dragTarget", { name: over.id === "default" ? t("projectGroups.default") : organization.groups.find(group => group.id === over.id)?.name ?? "" }) : undefined,
        onDragEnd: () => t("projectGroups.dragEnded"), onDragCancel: () => t("projectGroups.dragCancelled"),
      } }}
      onDragStart={event => { releaseGroup.current = null; suppressClick.current = true; setDragged(String(event.active.id)); }} onDragEnd={endDrag}
      onDragCancel={() => { releaseGroup.current = null; setDragged(null); window.setTimeout(() => { suppressClick.current = false; }, 0); }}>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" data-project-group-scroller>
        {organization.groups.map(group => {
          const members = sorted.filter(project => projectGroupId(organization, project.projectId) === group.id);
          const visible = members.filter(project => projectMatchesQuery(project.name, query));
          if (searching && !visible.length && !dragged) return null;
          const name = group.id === "default" ? t("projectGroups.default") : group.name;
          return <GroupSection key={group.id} group={group} name={name} count={visible.length} total={members.length} searching={searching}
            expanded={searching || !group.collapsed} disabled={busy} onToggle={() => { if (!dragged) void commit({ type: "collapse", groupId: group.id, collapsed: !group.collapsed }); }}
            onRename={() => { if (!dragged) { setError(null); setRequest({ type: "rename", groupId: group.id }); } }}
            onDelete={() => { if (!dragged) { setError(null); setRequest({ type: "delete", groupId: group.id }); } }}>
            {visible.length ? <ul className="space-y-0.5 pl-1">
              {visible.map(project => <ProjectListItem key={project.projectId} project={project} current={project.projectId === currentProjectId} query={query} disabled={busy}
                menuOpen={menuProjectId === project.projectId} menuRef={element => registerMenuTrigger(project.projectId, element)}
                onOpen={() => { if (!suppressClick.current) onSelectProject(project); }} onMenu={() => { if (!dragged) onProjectMenu(project); }} />)}
            </ul> : <p className="px-5 py-3 text-[11px] leading-5 text-app-muted">{t("projectGroups.empty")}</p>}
          </GroupSection>;
        })}
        {searching && !matches.length && !dragged && <p className="px-2 py-5 text-center text-xs text-app-muted">{t("projectGroups.noResults")}</p>}
      </div>
      <DragOverlay dropAnimation={null} style={{ pointerEvents: "none" }}>{activeProject && <div className="max-w-56 truncate rounded-lg border border-app-functional bg-app-panel-strong px-3 py-2 text-xs text-app-ink shadow-lg">{activeProject.name}</div>}</DragOverlay>
    </DndContext>
    <span className="sr-only" role="status">{announcement}</span>
    {dialog && <ProjectGroupDialog key={dialog.type === "move" ? `move-${dialog.project.projectId}` : `${dialog.type}-${dialog.groupId}`}
      request={dialog} organization={organization} projects={projects} busy={busy} error={error} onClose={closeDialog} fallbackFocus={() => createButton.current?.focus()}
      onSubmit={command => { void commit(command).then(saved => { if (saved) closeDialog(); }); }} />}
  </section>;
}
