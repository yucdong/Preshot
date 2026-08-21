import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { createPortal } from "react-dom";
import type {
  LongImagePresetId,
  LongImageWidth,
} from "../../../domain/plan/blocknote/longImageExportContract";

export interface LongImageExportSettings {
  readonly preset: LongImagePresetId;
  readonly width: LongImageWidth;
  readonly allowSplit: boolean;
}

interface LongImageExportDialogProps {
  onCancel(): void;
  onStart(settings: LongImageExportSettings): boolean;
}

const focusableSelector = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

const presets: ReadonlyArray<{
  id: LongImagePresetId;
  label: string;
  detail: string;
}> = [
  {
    id: "wechat",
    label: "微信兼容",
    detail: "JPEG · 每张 1 MB / 累计 24 MiB",
  },
  {
    id: "high-quality",
    label: "高质量",
    detail: "JPEG · 每张 3 MB / 累计 48 MiB",
  },
  {
    id: "lossless-png",
    label: "无损 PNG",
    detail: "PNG · 每张 8 MB / 累计 64 MiB",
  },
];

function focusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(
    container.querySelectorAll<HTMLElement>(focusableSelector),
  ).filter((element) =>
    !element.hasAttribute("disabled") &&
    element.getAttribute("aria-hidden") !== "true"
  );
}

export function LongImageExportDialog({
  onCancel,
  onStart,
}: LongImageExportDialogProps) {
  const [preset, setPreset] = useState<LongImagePresetId>("wechat");
  const [width, setWidth] = useState<LongImageWidth>(900);
  const [allowSplit, setAllowSplit] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstControlRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const format = preset === "lossless-png" ? "png" : "jpeg";

  useEffect(() => {
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    firstControlRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;

      const elements = focusableElements(dialogRef.current);
      if (elements.length === 0) return;
      const first = elements[0]!;
      const last = elements[elements.length - 1]!;
      const active = document.activeElement;
      if (!dialogRef.current?.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (restoreFocusRef.current?.isConnected) {
        restoreFocusRef.current.focus();
      }
    };
  }, [onCancel]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onStart({ preset, width, allowSplit });
  };

  const limits = preset === "wechat"
    ? "每张目标不超过 1 MB / 6000 px"
    : preset === "high-quality"
      ? "每张目标不超过 3 MB / 8000 px"
      : "PNG 无损导出，每张目标不超过 8 MB / 4000 px";

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
      data-preshot-surface="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto rounded-xl border border-app-border bg-app-panel-strong p-6 text-app-ink shadow-[var(--app-shadow)]"
        ref={dialogRef}
        role="dialog"
      >
        <div>
          <p className="text-xs font-semibold text-app-primary">图片导出</p>
          <h2 className="font-editorial mt-1 text-2xl font-bold" id={titleId}>
            导出长图
          </h2>
          <p className="mt-2 text-sm leading-6 text-app-muted" id={descriptionId}>
            默认将整个文档导出为一张长图；勾选“自动分图”后，才会按完整区块边界导出多张连续图片。
          </p>
        </div>

        <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
          <fieldset>
            <legend className="text-sm font-semibold">导出预设</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {presets.map((entry, index) => (
                <label className="relative cursor-pointer" key={entry.id}>
                  <input
                    aria-label={entry.label}
                    checked={preset === entry.id}
                    className="peer sr-only"
                    name="long-image-preset"
                    onChange={() => setPreset(entry.id)}
                    ref={index === 0 ? firstControlRef : undefined}
                    type="radio"
                    value={entry.id}
                  />
                  <span className="flex min-h-20 flex-col justify-center rounded-lg border border-app-border bg-app-panel px-3 py-2.5 transition-colors hover:border-app-primary peer-checked:border-app-primary peer-checked:bg-app-primary/10 peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-app-functional">
                    <span className="text-sm font-semibold">{entry.label}</span>
                    <span className="mt-1 text-xs text-app-muted">
                      {entry.detail}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium" htmlFor={`${titleId}-format`}>
              图片格式
              <select
                className="mt-2 block h-10 w-full rounded-lg border border-app-border bg-app-panel px-3 text-sm outline-none focus:border-app-primary focus:ring-2 focus:ring-app-primary/25"
                id={`${titleId}-format`}
                onChange={(event) =>
                  setPreset(event.target.value === "png"
                    ? "lossless-png"
                    : "wechat")}
                value={format}
              >
                <option value="jpeg">JPEG</option>
                <option value="png">PNG</option>
              </select>
            </label>
            <label className="text-sm font-medium" htmlFor={`${titleId}-target`}>
              JPEG 体积目标
              <select
                className="mt-2 block h-10 w-full rounded-lg border border-app-border bg-app-panel px-3 text-sm outline-none focus:border-app-primary focus:ring-2 focus:ring-app-primary/25 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={format === "png"}
                id={`${titleId}-target`}
                onChange={(event) =>
                  setPreset(event.target.value as LongImagePresetId)}
                value={format === "png" ? "wechat" : preset}
              >
                <option value="wechat">≤ 1 MB / 6000 px</option>
                <option value="high-quality">≤ 3 MB / 8000 px</option>
              </select>
            </label>
          </div>

          <fieldset>
            <legend className="text-sm font-semibold">导出宽度</legend>
            <div className="mt-2 flex gap-2">
              {([890, 900] as const).map((value) => (
                <label className="cursor-pointer" key={value}>
                  <input
                    checked={width === value}
                    className="peer sr-only"
                    name="long-image-width"
                    onChange={() => setWidth(value)}
                    type="radio"
                    value={value}
                  />
                  <span className="inline-flex h-10 min-w-24 items-center justify-center rounded-lg border border-app-border bg-app-panel px-4 text-sm font-semibold transition-colors hover:border-app-primary peer-checked:border-app-primary peer-checked:bg-app-primary/10 peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-app-functional">
                    {value} px
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-app-border bg-app-panel p-3">
            <input
              aria-label="自动分图"
              checked={allowSplit}
              className="mt-0.5 h-4 w-4 accent-[var(--app-primary)]"
              onChange={(event) => setAllowSplit(event.target.checked)}
              type="checkbox"
            />
            <span>
              <span className="block text-sm font-semibold">自动分图</span>
              <span className="mt-0.5 block text-xs leading-5 text-app-muted">
                勾选后按完整区块边界拆分，避免单张图片超过安全高度或体积。
              </span>
            </span>
          </label>

          <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs leading-5 text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
            <p className="font-semibold">{limits}</p>
            <p className="mt-1">
              未启用自动分图时，如文档超过单张图片安全限制，请启用自动分图、缩短方案，或导出 PDF/DOCX。
            </p>
            <p className="mt-1">
              最多导出 32 张；超出累计体积时，请缩短方案、分段导出、改用较小的 JPEG 预设，或导出 PDF/DOCX。
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <button
              className="inline-flex h-10 items-center justify-center rounded-lg border border-app-border px-4 text-sm font-semibold text-app-muted transition-colors hover:border-app-primary hover:text-app-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
              onClick={onCancel}
              type="button"
            >
              取消
            </button>
            <button
              className="inline-flex h-10 items-center justify-center rounded-lg bg-app-accent px-4 text-sm font-semibold text-white transition-colors hover:bg-app-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional focus-visible:ring-offset-2"
              type="submit"
            >
              开始导出
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
