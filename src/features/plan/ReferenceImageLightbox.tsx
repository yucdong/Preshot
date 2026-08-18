import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Check, Crop, LoaderCircle, RotateCcw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  cropFocus,
  cropForFrame,
  cropZoom,
  imageViewCss,
  normalizeImageCrop,
  type NormalizedImageCrop,
} from "../../domain/plan/canvas/imageView";

export interface ReferenceImageCropAction {
  sourceWidth: number;
  sourceHeight: number;
  confirm(crop: NormalizedImageCrop): Promise<void>;
}

interface ReferenceImageLightboxProps {
  src: string;
  alt: string;
  cropAction?: ReferenceImageCropAction;
  onClose(): void;
}

type CropPresetId = "original" | "free" | "1:1" | "4:5" | "3:4" | "16:9";

const CROP_PRESETS: ReadonlyArray<{
  id: CropPresetId;
  label: string;
  ratio?: number;
}> = [
  { id: "original", label: "原始比例" },
  { id: "free", label: "自由" },
  { id: "1:1", label: "1:1", ratio: 1 },
  { id: "4:5", label: "4:5", ratio: 4 / 5 },
  { id: "3:4", label: "3:4", ratio: 3 / 4 },
  { id: "16:9", label: "16:9", ratio: 16 / 9 },
];

const FULL_CROP: NormalizedImageCrop = { x: 0, y: 0, width: 1, height: 1 };

function errorMessage(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  return `裁剪项目图片副本失败：${detail}。请检查项目文件是否可写，然后重试。`;
}

export function ReferenceImageLightbox({
  src,
  alt,
  cropAction,
  onClose,
}: ReferenceImageLightboxProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const cropButtonRef = useRef<HTMLButtonElement>(null);
  const cropPreviewRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const panCleanupRef = useRef<(() => void) | null>(null);
  const [mode, setMode] = useState<"viewer" | "crop">("viewer");
  const [preset, setPreset] = useState<CropPresetId>("original");
  const [draftCrop, setDraftCrop] = useState<NormalizedImageCrop>(FULL_CROP);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const sourceAspectRatio = cropAction
    ? cropAction.sourceWidth / cropAction.sourceHeight
    : 1;
  const cropAspectRatio =
    draftCrop.width * sourceAspectRatio / draftCrop.height;
  const zoom = cropZoom(draftCrop, sourceAspectRatio, cropAspectRatio);
  const previewStyle = useMemo(
    () => imageViewCss(draftCrop),
    [draftCrop],
  );

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    closeRef.current?.focus();
    return () => {
      panCleanupRef.current?.();
      returnFocusRef.current?.focus();
    };
  }, []);

  useLayoutEffect(() => {
    if (mode === "crop") {
      cropPreviewRef.current?.focus();
    }
  }, [mode]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (confirming) {
          setStatus("正在裁剪项目图片副本，完成前无法关闭。");
        } else {
          onCloseRef.current();
        }
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
        ) ?? [],
      ).sort((left, right) => {
        if (left === right) return 0;
        return left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING
          ? -1
          : 1;
      });
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (!dialogRef.current?.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [confirming]);

  const beginCrop = () => {
    setPreset("original");
    setDraftCrop(FULL_CROP);
    setError(null);
    setStatus(null);
    setMode("crop");
  };

  const cancelCrop = () => {
    if (confirming) return;
    setMode("viewer");
    setPreset("original");
    setDraftCrop(FULL_CROP);
    setError(null);
    window.requestAnimationFrame(() => cropButtonRef.current?.focus());
  };

  const selectPreset = (nextPreset: CropPresetId) => {
    if (!cropAction) return;
    setPreset(nextPreset);
    if (nextPreset === "free") return;
    const ratio = nextPreset === "original"
      ? sourceAspectRatio
      : CROP_PRESETS.find((entry) => entry.id === nextPreset)?.ratio ??
        sourceAspectRatio;
    const focus = cropFocus(draftCrop);
    setDraftCrop(cropForFrame({
      sourceAspectRatio,
      frameAspectRatio: ratio,
      focusX: focus.x,
      focusY: focus.y,
      zoom,
    }));
  };

  const setZoom = (nextZoom: number) => {
    const focus = cropFocus(draftCrop);
    setDraftCrop(cropForFrame({
      sourceAspectRatio,
      frameAspectRatio: cropAspectRatio,
      focusX: focus.x,
      focusY: focus.y,
      zoom: nextZoom,
    }));
  };

  const resizeFreeCrop = (
    dimension: "width" | "height",
    value: number,
  ) => {
    const focus = cropFocus(draftCrop);
    setDraftCrop(normalizeImageCrop({
      ...draftCrop,
      [dimension]: value,
      x: focus.x - (dimension === "width" ? value : draftCrop.width) / 2,
      y: focus.y - (dimension === "height" ? value : draftCrop.height) / 2,
    }));
  };

  const nudgeCrop = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (confirming) return;
    const movement = event.shiftKey ? 0.05 : 0.01;
    const changes: Partial<NormalizedImageCrop> = {};
    if (event.key === "ArrowLeft") changes.x = draftCrop.x - draftCrop.width * movement;
    if (event.key === "ArrowRight") changes.x = draftCrop.x + draftCrop.width * movement;
    if (event.key === "ArrowUp") changes.y = draftCrop.y - draftCrop.height * movement;
    if (event.key === "ArrowDown") changes.y = draftCrop.y + draftCrop.height * movement;
    if (Object.keys(changes).length === 0) return;
    event.preventDefault();
    setDraftCrop(normalizeImageCrop({ ...draftCrop, ...changes }));
  };

  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || confirming) return;
    event.preventDefault();
    event.currentTarget.focus();
    panCleanupRef.current?.();
    const startX = event.clientX;
    const startY = event.clientY;
    const start = draftCrop;
    const rect = event.currentTarget.getBoundingClientRect();
    const move = (moveEvent: PointerEvent) => {
      setDraftCrop(normalizeImageCrop({
        ...start,
        x: start.x - (moveEvent.clientX - startX) / Math.max(rect.width, 1) * start.width,
        y: start.y - (moveEvent.clientY - startY) / Math.max(rect.height, 1) * start.height,
      }));
    };
    const finish = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", finish);
      if (panCleanupRef.current === finish) panCleanupRef.current = null;
    };
    panCleanupRef.current = finish;
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", finish);
  };

  const confirmCrop = async () => {
    if (!cropAction || confirming) return;
    setConfirming(true);
    setError(null);
    setStatus("正在裁剪项目图片副本…");
    try {
      await cropAction.confirm(draftCrop);
      setMode("viewer");
      setPreset("original");
      setDraftCrop(FULL_CROP);
      setStatus("裁剪已应用到项目图片副本，外部源文件未更改。");
      window.requestAnimationFrame(() => cropButtonRef.current?.focus());
    } catch (caught) {
      setError(errorMessage(caught));
      setStatus(null);
    } finally {
      setConfirming(false);
    }
  };

  const close = () => {
    if (confirming) {
      setStatus("正在裁剪项目图片副本，完成前无法关闭。");
    } else {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 sm:p-6"
      data-preshot-surface="true"
      data-testid="reference-image-backdrop"
      onClick={close}
    >
      <div
        aria-busy={confirming}
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="relative flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-white/15 bg-[#17191d] text-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
      >
        <header className="flex min-h-14 items-center justify-between gap-4 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold" id={titleId}>
              {mode === "crop" ? "裁剪参考图" : alt}
            </h2>
            <p className="text-xs text-white/65" id={descriptionId}>
              {mode === "crop"
                ? "裁剪只覆盖项目中的图片副本，不会修改外部源文件。"
                : "查看项目中的参考图片副本。"}
            </p>
          </div>
          <button
            aria-label={t("lightbox.close")}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none"
            disabled={confirming}
            onClick={close}
            ref={closeRef}
            type="button"
          >
            <X aria-hidden="true" className="h-4 w-4" data-icon="close" />
          </button>
        </header>

        {mode === "viewer" ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 items-center justify-center p-4">
              <img
                alt={alt}
                className="min-h-0 max-h-[72vh] max-w-full object-contain"
                src={src}
              />
            </div>
            <footer className="flex items-center justify-between gap-4 border-t border-white/10 px-4 py-3">
              <p aria-live="polite" className="text-xs text-emerald-300" role="status">
                {status}
              </p>
              {cropAction ? (
                <button
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#17191d] transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#17191d] motion-reduce:transition-none"
                  onClick={beginCrop}
                  ref={cropButtonRef}
                  type="button"
                >
                  <Crop aria-hidden size={17} />
                  裁剪
                </button>
              ) : null}
            </footer>
          </div>
        ) : (
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              void confirmCrop();
            }}
          >
            <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
              <div className="flex min-h-[18rem] items-center justify-center rounded-lg bg-black/45 p-4">
                <div
                  aria-label="裁剪预览；拖动调整位置，方向键微调，Shift 加方向键大幅微调"
                  aria-disabled={confirming}
                  className="relative max-h-[58vh] max-w-full touch-none cursor-move overflow-hidden rounded border border-white/70 bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  onKeyDown={nudgeCrop}
                  onPointerDown={startPan}
                  ref={cropPreviewRef}
                  role="group"
                  style={{
                    aspectRatio: cropAspectRatio,
                    width: `min(100%, ${Math.max(18, cropAspectRatio * 58)}vh)`,
                  }}
                  tabIndex={0}
                >
                  <img
                    alt=""
                    aria-hidden="true"
                    className="pointer-events-none absolute max-w-none select-none"
                    draggable={false}
                    src={src}
                    style={previewStyle}
                  />
                  <span className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-55">
                    {Array.from({ length: 9 }, (_, index) => (
                      <span
                        className="border-[0.5px] border-white/45"
                        key={index}
                      />
                    ))}
                  </span>
                </div>
              </div>

              <aside className="space-y-5 rounded-lg border border-white/10 bg-white/[0.04] p-4">
                <fieldset disabled={confirming}>
                  <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/70">
                    宽高比
                  </legend>
                  <div className="grid grid-cols-3 gap-2">
                    {CROP_PRESETS.map((entry) => (
                      <button
                        aria-pressed={preset === entry.id}
                        className="min-h-10 rounded-lg border border-white/15 px-2 text-xs font-medium transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white aria-pressed:border-white aria-pressed:bg-white aria-pressed:text-[#17191d] motion-reduce:transition-none"
                        key={entry.id}
                        onClick={() => selectPreset(entry.id)}
                        type="button"
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <label className="block text-xs font-semibold text-white/75">
                  <span className="mb-2 flex justify-between">
                    <span>缩放</span>
                    <output>{zoom.toFixed(2)}×</output>
                  </span>
                  <input
                    aria-label="裁剪缩放"
                    className="w-full accent-white"
                    disabled={confirming}
                    max="8"
                    min="1"
                    onChange={(event) => setZoom(Number(event.target.value))}
                    step="0.01"
                    type="range"
                    value={zoom}
                  />
                </label>

                {preset === "free" ? (
                  <div className="space-y-4">
                    <label className="block text-xs font-semibold text-white/75">
                      <span className="mb-2 flex justify-between">
                        <span>自由裁剪宽度</span>
                        <output>{Math.round(draftCrop.width * 100)}%</output>
                      </span>
                      <input
                        aria-label="自由裁剪宽度"
                        className="w-full accent-white"
                        disabled={confirming}
                        max="1"
                        min="0.05"
                        onChange={(event) =>
                          resizeFreeCrop("width", Number(event.target.value))}
                        step="0.01"
                        type="range"
                        value={draftCrop.width}
                      />
                    </label>
                    <label className="block text-xs font-semibold text-white/75">
                      <span className="mb-2 flex justify-between">
                        <span>自由裁剪高度</span>
                        <output>{Math.round(draftCrop.height * 100)}%</output>
                      </span>
                      <input
                        aria-label="自由裁剪高度"
                        className="w-full accent-white"
                        disabled={confirming}
                        max="1"
                        min="0.05"
                        onChange={(event) =>
                          resizeFreeCrop("height", Number(event.target.value))}
                        step="0.01"
                        type="range"
                        value={draftCrop.height}
                      />
                    </label>
                  </div>
                ) : null}

                <button
                  className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-white/20 px-3 text-sm font-medium transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-45 motion-reduce:transition-none"
                  disabled={confirming}
                  onClick={() => {
                    setPreset("original");
                    setDraftCrop(FULL_CROP);
                    setError(null);
                  }}
                  type="button"
                >
                  <RotateCcw aria-hidden size={16} />
                  重置
                </button>

                <p className="text-xs leading-5 text-white/60">
                  拖动图片调整焦点；聚焦预览后可用方向键微调位置。
                </p>
              </aside>
            </div>

            {error ? (
              <div
                className="mx-4 mb-3 rounded-lg border border-red-300/35 bg-red-400/15 px-3 py-2 text-sm text-red-100"
                role="alert"
              >
                {error}
              </div>
            ) : null}
            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-4 py-3">
              <p aria-live="polite" className="text-xs text-white/70" role="status">
                {status}
              </p>
              <div className="ml-auto flex gap-2">
                <button
                  className="min-h-11 rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-45 motion-reduce:transition-none"
                  disabled={confirming}
                  onClick={cancelCrop}
                  type="button"
                >
                  取消
                </button>
                <button
                  className="inline-flex min-h-11 min-w-28 items-center justify-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#17191d] transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#17191d] disabled:cursor-wait disabled:opacity-65 motion-reduce:transition-none"
                  disabled={confirming}
                  type="submit"
                >
                  {confirming ? (
                    <LoaderCircle
                      aria-hidden
                      className="animate-spin motion-reduce:animate-none"
                      size={17}
                    />
                  ) : (
                    <Check aria-hidden size={17} />
                  )}
                  {confirming ? "正在裁剪…" : "确认裁剪"}
                </button>
              </div>
            </footer>
          </form>
        )}
      </div>
    </div>
  );
}
