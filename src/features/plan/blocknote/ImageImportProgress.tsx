import { ui, useUiLanguage } from "../../../shared/i18n/ui";

/** Transient UI state only; never part of the document or undo history. */
export interface ImageImportProgressState {
  phase: "waiting" | "loading" | "preparing";
  completed?: number;
  total?: number;
}

export function ImageImportProgress({ progress }: { progress: ImageImportProgressState }) {
  useUiLanguage();
  const { phase, completed, total } = progress;
  const determinate = phase === "loading" && completed !== undefined && total !== undefined && total > 0;
  const message = phase === "waiting"
    ? ui("准备加载图片…")
    : phase === "preparing"
      ? ui("图片已加载，正在完成…")
      : determinate
        ? ui("正在加载图片… {{v0}} / {{v1}}", { v0: completed, v1: total })
        : total !== undefined
          ? ui("正在加载 {{v0}} 张图片…", { v0: total })
          : ui("正在加载图片…");
  return <div className="preshot-image-import-progress bn-drag-exclude" contentEditable={false}>
    <div className="preshot-image-import-progress-label" role="status" aria-live="polite" aria-atomic="true">
      <span>{message}</span>
      {determinate && <span aria-hidden="true">{Math.floor(completed / total * 100)}%</span>}
    </div>
    <progress aria-label={ui("图片加载进度")} aria-valuetext={message}
      max={determinate ? total : 1} value={determinate ? completed : undefined} />
  </div>;
}
