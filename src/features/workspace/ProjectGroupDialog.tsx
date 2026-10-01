import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { ProjectOrganization, WorkspaceProjectView } from "../../domain/workspace/models";
import { projectGroupId, type ProjectOrganizationCommand } from "../../domain/workspace/organization";
import { useDialogPortalHost } from "../../shared/ui/DialogPortalContext";

export type GroupDialogRequest =
  | { type: "create"; groupId: string }
  | { type: "rename"; groupId: string }
  | { type: "delete"; groupId: string }
  | { type: "move"; project: WorkspaceProjectView };

interface Props {
  request: GroupDialogRequest;
  organization: ProjectOrganization;
  projects: WorkspaceProjectView[];
  busy: boolean;
  error: string | null;
  onSubmit(command: ProjectOrganizationCommand): void;
  onClose(): void;
  fallbackFocus(): void;
}

export function ProjectGroupDialog({ request, organization, projects, busy, error, onSubmit, onClose, fallbackFocus }: Props) {
  const { t } = useTranslation();
  const host = useDialogPortalHost();
  const titleId = useId();
  const descriptionId = useId();
  const targetId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const group = request.type === "move" ? undefined : organization.groups.find(group => group.id === request.groupId);
  const [name, setName] = useState(group?.name ?? "");
  const [target, setTarget] = useState(request.type === "move" ? projectGroupId(organization, request.project.projectId) : "default");
  const fallback = useRef(fallbackFocus);
  const title = t(`projectGroups.${request.type}`);
  useEffect(() => {
    const origin = document.activeElement;
    const surface = dialog.current;
    const restoreFallback = fallback.current;
    dialog.current?.querySelector<HTMLElement>("input, select, button")?.focus();
    return () => { window.setTimeout(() => {
      if (document.activeElement !== document.body && document.activeElement instanceof HTMLElement && document.activeElement.isConnected && !surface?.contains(document.activeElement)) return;
      if (origin instanceof HTMLElement && origin.isConnected) origin.focus({ preventScroll: true });
      else restoreFallback();
    }, 0); };
  }, []);
  const count = group ? projects.filter(project => projectGroupId(organization, project.projectId) === group.id).length : 0;
  return createPortal(<div data-preshot-surface="true" className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 p-5 backdrop-blur-[2px]"
    onClick={event => { if (!busy && event.target === event.currentTarget) onClose(); }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={request.type === "delete" ? descriptionId : undefined} aria-busy={busy} tabIndex={-1}
      className="w-full max-w-sm rounded-xl border border-app-border bg-app-panel-strong p-5 text-app-ink shadow-[var(--app-shadow)]"
      onKeyDown={event => {
        event.stopPropagation();
        if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) {
          if (event.key === "Enter") event.preventDefault();
          return;
        }
        if (event.key === "Escape") { event.preventDefault(); if (!busy) onClose(); }
        if (event.key === "Tab") {
          const elements = Array.from(dialog.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button") ?? []).filter(element => !element.disabled);
          const first = elements[0], last = elements.at(-1);
          if (!first) { event.preventDefault(); return; }
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }}>
      <h2 id={titleId} className="mb-4 text-lg font-semibold">{title}</h2>
      <form onSubmit={event => {
        event.preventDefault();
        if (busy || composing.current) return;
        if (request.type === "move") onSubmit({ type: "move", projectId: request.project.projectId, groupId: target });
        else if (request.type === "delete") onSubmit(request);
        else onSubmit({ ...request, name });
      }}>
        {request.type === "delete" ? <p id={descriptionId} className="text-sm leading-6 text-app-muted">{t("projectGroups.deleteDescription", { name: group?.name ?? "", count, defaultName: t("projectGroups.default") })}</p>
          : request.type === "move" ? <div className="text-sm"><label htmlFor={targetId}>{t("projectGroups.target")}</label>
            <p className="my-2 truncate text-xs text-app-muted" title={request.project.name}>{request.project.name}</p>
            <select id={targetId} value={target} disabled={busy} onChange={event => setTarget(event.target.value)} className="w-full rounded-lg border border-app-border bg-app-panel px-3 py-2">
              {organization.groups.map(item => <option key={item.id} value={item.id}>{item.id === "default" ? t("projectGroups.default") : item.name}</option>)}
            </select>
          </div> : <label className="block text-sm">{t("projectGroups.name")}
            <input value={name} disabled={busy} onChange={event => setName(event.target.value)}
              onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
              className="mt-2 w-full rounded-lg border border-app-border bg-app-panel px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional" />
          </label>}
        {error && <p role="alert" className="mt-3 text-sm text-app-danger">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-app-border px-3 py-2 text-sm disabled:opacity-50">{t("common.cancel")}</button>
          <button type="submit" disabled={busy} className={`rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50 ${request.type === "delete" ? "bg-app-danger text-app-on-danger" : "bg-app-primary text-app-on-primary"}`}>
            {busy ? t("projectGroups.saving") : t(`projectGroups.${request.type}Confirm`)}
          </button>
        </div>
      </form>
    </div>
  </div>, host);
}
