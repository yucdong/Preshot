import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { WorkspaceProjectView } from "../../domain/workspace/models";
import { ui, useUiLanguage } from "../../shared/i18n/ui";
import { useDialogPortalHost } from "../../shared/ui/DialogPortalContext";

export type ProjectRemovalMode = "list" | "disk";

interface Props {
  project: WorkspaceProjectView;
  busy: boolean;
  error: string | null;
  returnFocusTo: HTMLElement | null;
  onCancel(): void;
  onRemove(mode: ProjectRemovalMode): void;
}

export function DeleteProjectDialog({ project, busy, error, returnFocusTo, onCancel, onRemove }: Props) {
  useUiLanguage();
  const host = useDialogPortalHost();
  const [confirmDisk, setConfirmDisk] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const origin = returnFocusTo;
    cancelRef.current?.focus();
    return () => {
      if (origin instanceof HTMLElement && origin.isConnected) {
        window.setTimeout(() => origin.focus({ preventScroll: true }), 0);
      }
    };
  }, [returnFocusTo]);
  const buttonClass = "rounded-lg border border-app-border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-primary disabled:opacity-50";
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 p-6 backdrop-blur-[2px]"
      data-preshot-surface="true" onClick={(event) => { if (!busy && event.target === event.currentTarget) onCancel(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}
        aria-busy={busy} tabIndex={-1}
        className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-lg border border-app-border bg-app-panel-strong p-5 text-app-ink shadow-[var(--app-shadow)]"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault(); event.stopPropagation();
            if (!busy) onCancel();
          }
          if (event.key === "Tab") {
            const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
            const first = buttons[0]; const last = buttons.at(-1);
            if (!first || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
              event.preventDefault(); (event.shiftKey ? last : first)?.focus();
            }
          }
        }}>
        <h2 id={titleId} className="text-lg font-semibold">{confirmDisk ? ui("确认从磁盘删除项目？") : ui("删除项目")}</h2>
        <p className="mt-3 break-words font-medium">{project.name}</p>
        <p className="mt-2 break-all rounded-md bg-app-panel p-3 text-xs text-app-muted">{project.path}</p>
        <p id={descriptionId} className="mt-3 text-sm leading-6 text-app-muted">
          {confirmDisk
            ? ui("将永久删除以上整个项目文件夹，包括文档、图片、导出文件和其他所有文件。此操作无法撤销，已打开的项目也会关闭。")
            : ui("仅从项目列表移除，磁盘文件不会被删除；也可以选择从磁盘删除整个项目文件夹。")}
        </p>
        {error ? <p role="alert" className="mt-3 break-words text-sm text-app-danger">{error}</p> : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button ref={cancelRef} type="button" disabled={busy} onClick={onCancel} className={buttonClass}>{ui("取消")}</button>
          {!confirmDisk ? <>
            <button type="button" disabled={busy} onClick={() => onRemove("list")} className={buttonClass}>{ui("从列表移除")}</button>
            <button type="button" disabled={busy} onClick={() => { setConfirmDisk(true); cancelRef.current?.focus(); }} className={`${buttonClass} text-app-danger`}>{ui("从磁盘删除")}</button>
          </> : <button type="button" disabled={busy} onClick={() => onRemove("disk")}
            className={`${buttonClass} bg-app-danger font-semibold text-app-on-danger`}>{busy ? ui("正在删除…") : ui("确认从磁盘删除")}</button>}
        </div>
      </div>
    </div>, host,
  );
}
