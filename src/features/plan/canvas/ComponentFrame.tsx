import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import {
  COMPONENT_CLOSE_GUTTER,
  COMPONENT_CLOSE_INSET,
  COMPONENT_CLOSE_SIZE,
  componentFrameChromeHeight,
  contentSize,
  DEFAULT_PAGE_GEOMETRY,
  EDITABLE_COMPONENT_FRAME_CHROME,
  PLAN_COMPONENT_FRAME_CHROME,
  PLAN_COMPONENT_FRAME_INSET,
  PLAN_COMPONENT_VISUAL_INSET,
  resizeCardFromEdge,
  type Rect,
  type ResizeEdge,
} from "../../../domain/plan/canvas/geometry";
import { type PlanComponent } from "../../../domain/plan/canvas/models";
import type { RenameComponentResult } from "../../../domain/plan/canvas/naming";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { estimateNameInputWidthEm } from "./componentNameWidth";

interface ComponentFrameProps {
  id: string;
  frameId?: string;
  rect: Rect;
  scale: number;
  onRemove: (id: string) => void;
  component: PlanComponent;
  onResize: (id: string, rect: Rect, edge: ResizeEdge) => void;
  onResizePreview?: (id: string, rect: Rect, edge: ResizeEdge) => Rect | undefined;
  onResizeCancel?: () => void;
  onRename?: (id: string, name: string) => RenameComponentResult;
  children?: React.ReactNode;
  sortableId?: string;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  showName?: boolean;
  allowContentOverflow?: boolean;
  resizeLimitedEdge?: ResizeEdge | null;
}

interface ComponentFrameNameInputProps {
  id: string;
  name: string;
  onRename?: (id: string, name: string) => RenameComponentResult;
  scale: number;
}

function ComponentFrameNameInput({
  id,
  name,
  onRename,
  scale,
}: ComponentFrameNameInputProps) {
  const { t } = useTranslation();
  const [nameDraft, setNameDraft] = useState(name);
  const [nameError, setNameError] = useState<string | null>(null);

  const commitName = () => {
    if (!onRename) {
      return;
    }
    const result = onRename(id, nameDraft);
    if (result.ok) {
      setNameDraft(
        result.plan.components?.find((entry) => entry.id === id)?.name ??
          nameDraft.trim(),
      );
      setNameError(null);
    } else {
      setNameDraft(name);
      setNameError(t(`canvas.nameError.${result.reason}`));
    }
  };

  return (
    <div className="relative min-w-0 flex-1">
      <input
        aria-describedby={nameError ? `${id}-name-error` : undefined}
        aria-label={t("canvas.componentName")}
        className="min-w-0 max-w-full border-0 bg-transparent text-paper-ink outline-none focus:ring-2 focus:ring-paper-primary"
        onBlur={commitName}
        onChange={(event) => setNameDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitName();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setNameDraft(name);
            setNameError(null);
          }
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        style={{
          fontSize: `${12 * scale}px`,
          lineHeight: `${16 * scale}px`,
          width: `${estimateNameInputWidthEm(nameDraft)}em`,
        }}
        type="text"
        value={nameDraft}
      />
      {nameError ? (
        <div
          className="absolute left-0 top-full z-20 whitespace-nowrap text-xs text-red-600 dark:text-red-400"
          id={`${id}-name-error`}
          role="alert"
        >
          {nameError}
        </div>
      ) : null}
    </div>
  );
}

function ComponentCloseButton({
  ariaLabel,
  onClick,
  scale,
}: {
  ariaLabel: string;
  onClick(): void;
  scale: number;
}) {
  return (
    <button
      aria-label={ariaLabel}
      className="absolute z-[70] grid place-items-center rounded bg-[#25272b] p-0 text-white shadow-sm transition-[background-color,transform,box-shadow] duration-200 hover:bg-paper-danger hover:shadow-md active:scale-[0.92] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-danger focus-visible:ring-offset-1"
      data-card-interactive="true"
      onClick={onClick}
      onPointerDown={(event) => event.stopPropagation()}
      style={{
        height: `${COMPONENT_CLOSE_SIZE * scale}px`,
        right: `${COMPONENT_CLOSE_INSET * scale}px`,
        top: `${COMPONENT_CLOSE_INSET * scale}px`,
        width: `${COMPONENT_CLOSE_SIZE * scale}px`,
      }}
      title={ariaLabel}
      type="button"
    >
      <X
        aria-hidden="true"
        strokeWidth={2}
        style={{ height: `${9 * scale}px`, width: `${9 * scale}px` }}
      />
    </button>
  );
}

function collapseTextSelectionWithin(container: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
  const selectedNode = selection.focusNode ?? selection.anchorNode;
  const selectedElement = selectedNode instanceof Element
    ? selectedNode
    : selectedNode?.parentElement;
  const editor = selectedElement?.closest<HTMLElement>('[contenteditable="true"]');
  if (!editor || !container.contains(editor)) return;
  const selectedBlock = selectedElement?.closest<HTMLElement>(
    "p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,td,th",
  );
  const collapseTarget = selectedBlock && editor.contains(selectedBlock)
    ? selectedBlock
    : editor;
  editor.focus({ preventScroll: true });
  const range = document.createRange();
  range.selectNodeContents(collapseTarget);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function ComponentFrame({
  id,
  frameId,
  rect,
  scale,
  onRemove,
  onRename,
  component,
  onResize,
  onResizePreview,
  onResizeCancel,
  children,
  sortableId,
  onMoveUp,
  onMoveDown,
  canMoveUp = true,
  canMoveDown = true,
  showName = true,
  allowContentOverflow = false,
  resizeLimitedEdge = null,
}: ComponentFrameProps) {
  const { t } = useTranslation();
  const resizeSessionRef = useRef<{
    element: HTMLElement;
    pointerId: number;
  } | null>(null);
  const [resizePreview, setResizePreview] = useState<Rect | null>(null);
  const [activeResizeEdge, setActiveResizeEdge] = useState<ResizeEdge | null>(null);
  const resizePreviewRef = useRef<Rect | null>(null);
  const resizeStartRef = useRef<{
    x: number;
    y: number;
    edge: ResizeEdge;
    rect: Rect;
  } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const currentRect = resizePreview ?? rect;
  const canvasWidth = contentSize(DEFAULT_PAGE_GEOMETRY).width;

  const onPointerDownResize = (
    edge: ResizeEdge,
  ) => (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    resizeSessionRef.current = { element: event.currentTarget, pointerId: event.pointerId };
    resizeStartRef.current = { x: event.clientX, y: event.clientY, edge, rect };
    setActiveResizeEdge(edge);
    resizePreviewRef.current = null;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const nextRectForPointer = (event: React.PointerEvent<HTMLDivElement>): Rect | null => {
    const resizeStart = resizeStartRef.current;
    if (!resizeStart) {
      return null;
    }
    const dx = (event.clientX - resizeStart.x) / scale;
    const dy = (event.clientY - resizeStart.y) / scale;
    return resizeCardFromEdge(
      resizeStart.rect,
      resizeStart.edge,
      resizeStart.edge === "left" || resizeStart.edge === "right" ? dx : dy,
      canvasWidth,
    );
  };

  const onPointerMoveResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const next = nextRectForPointer(event);
    if (!next) {
      return;
    }
    const preview = onResizePreview?.(
      id,
      next,
      resizeStartRef.current?.edge ?? "right",
    ) ?? next;
    resizePreviewRef.current = preview;
    setResizePreview(preview);
  };

  const finishResize = (
    event: React.PointerEvent<HTMLDivElement>,
    options: { commit: boolean; releaseCapture: boolean },
  ) => {
    const session = resizeSessionRef.current;
    if (!session) {
      return;
    }
    const edge = resizeStartRef.current?.edge;
    const next = resizePreviewRef.current;
    resizeSessionRef.current = null;
    resizeStartRef.current = null;
    setActiveResizeEdge(null);
    setResizePreview(null);
    resizePreviewRef.current = null;
    if (options.releaseCapture && session.element.hasPointerCapture(event.pointerId)) {
      session.element.releasePointerCapture?.(event.pointerId);
    }
    if (options.commit && next && edge) {
      onResize(id, next, edge);
    } else if (!options.commit) {
      onResizeCancel?.();
    }
  };

  const isPlan = component.type === "plan";
  const horizontalPlanPreview =
    isPlan &&
    resizePreview !== null &&
    (activeResizeEdge === "left" || activeResizeEdge === "right");
  const frameChrome = isPlan
    ? PLAN_COMPONENT_FRAME_CHROME
    : EDITABLE_COMPONENT_FRAME_CHROME;
  const frameChromeHeight = componentFrameChromeHeight(frameChrome);
  const frameInset = isPlan ? PLAN_COMPONENT_FRAME_INSET : 12;
  const bodyHeight = Math.max(
    0,
    currentRect.height -
      frameChromeHeight -
      (isPlan ? PLAN_COMPONENT_VISUAL_INSET : frameInset) * 2,
  ) * scale;
  const moveControlHeight = 17 * scale;
  const moveControlWidth = 20 * scale;
  const moveControlGap = 2 * scale;
  return (
    <div className="group contents">
      <div
        className="pointer-events-none absolute z-20 flex flex-col opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
        data-component-move-controls={id}
        style={{
          gap: `${2 * scale}px`,
          left: `${Math.max(
            -DEFAULT_PAGE_GEOMETRY.margin * scale,
            currentRect.x * scale - moveControlWidth - moveControlGap,
          )}px`,
          top: `${currentRect.y * scale}px`,
        }}
      >
        <button
          aria-label={t("canvas.moveUp")}
          className="flex items-center justify-center rounded border border-paper-border bg-white text-paper-muted shadow-sm transition-colors hover:border-paper-primary hover:bg-paper-primary-soft hover:text-paper-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-primary disabled:cursor-not-allowed disabled:opacity-30"
          disabled={!canMoveUp}
          onClick={onMoveUp}
          style={{
            fontSize: `${5.5 * scale}px`,
            gap: `${0.5 * scale}px`,
            height: `${moveControlHeight}px`,
            width: `${moveControlWidth}px`,
          }}
          type="button"
        >
          <ChevronUp aria-hidden="true" style={{ height: `${7 * scale}px`, width: `${7 * scale}px` }} />
          <span>{t("canvas.moveUpLabel")}</span>
        </button>
        <button
          aria-label={t("canvas.moveDown")}
          className="flex items-center justify-center rounded border border-paper-border bg-white text-paper-muted shadow-sm transition-colors hover:border-paper-primary hover:bg-paper-primary-soft hover:text-paper-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-primary disabled:cursor-not-allowed disabled:opacity-30"
          disabled={!canMoveDown}
          onClick={onMoveDown}
          style={{
            fontSize: `${5.5 * scale}px`,
            gap: `${0.5 * scale}px`,
            height: `${moveControlHeight}px`,
            width: `${moveControlWidth}px`,
          }}
          type="button"
        >
          <ChevronDown aria-hidden="true" style={{ height: `${7 * scale}px`, width: `${7 * scale}px` }} />
          <span>{t("canvas.moveDownLabel")}</span>
        </button>
      </div>
    <div
      className={`pointer-events-auto absolute cursor-default rounded-md border border-paper-border bg-white shadow-[0_3px_12px_rgb(24_24_27_/_6%)] transition-[border-color,box-shadow] duration-200 hover:border-paper-primary/60 hover:shadow-md focus-within:border-paper-primary focus-within:shadow-[0_0_0_2px_rgb(8_145_178_/_10%)] ${allowContentOverflow ? "overflow-visible" : "overflow-hidden"}`}
      data-component-frame="true"
      data-component-id={id}
      data-fragment-id={frameId ?? id}
      data-sortable-component-id={sortableId ?? id}
      onPointerDownCapture={(event) => {
        if (event.button !== 0) return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest('button,input,textarea,select,a,[contenteditable="true"],[role="application"]')) return;
        collapseTextSelectionWithin(event.currentTarget);
      }}
      style={{
        left: `${currentRect.x * scale}px`,
        top: `${currentRect.y * scale}px`,
        width: `${currentRect.width * scale}px`,
        height: horizontalPlanPreview ? "auto" : `${currentRect.height * scale}px`,
        boxSizing: "border-box",
        padding: `${frameInset * scale}px`,
      }}
    >
      <ComponentCloseButton
        ariaLabel={t("canvas.removeComponent")}
        onClick={() => setConfirmingDelete(true)}
        scale={scale}
      />
      {!isPlan ? (
        <div
          className="flex items-center"
          data-component-frame-header
          style={{
            height: `${frameChrome.topBarHeight * scale}px`,
            marginBottom: `${frameChrome.contentGap * scale}px`,
            paddingRight: `${COMPONENT_CLOSE_GUTTER * scale}px`,
          }}
        >
          {showName ? (
            <ComponentFrameNameInput
              id={id}
              key={component.name}
              name={component.name}
              onRename={onRename}
              scale={scale}
            />
          ) : null}
        </div>
      ) : null}

      <div
        className={`relative min-h-0 ${allowContentOverflow ? "overflow-visible" : "overflow-hidden"}`}
        data-component-frame-body
        style={{
          boxSizing: "border-box",
          height: horizontalPlanPreview ? "auto" : `${bodyHeight}px`,
          paddingRight: isPlan ? `${COMPONENT_CLOSE_GUTTER * scale}px` : undefined,
        }}
      >
        {children}
      </div>

        <>
          {(["left", "right", "top", "bottom"] as const).map((edge) => (
            <div
              aria-label={
                edge === "left"
                  ? t("canvas.resizeLeft")
                  : edge === "right"
                    ? t("canvas.resizeRight")
                    : edge === "top"
                      ? t("canvas.resizeTop")
                      : t("canvas.resizeBottom")
              }
              className={`absolute z-10 bg-transparent hover:bg-paper-primary/20 focus-visible:bg-paper-primary/30 ${
                resizeLimitedEdge === edge ? "bg-amber-300/60 hover:bg-amber-300/70" : ""
              } ${
                edge === "left"
                  ? "left-0 top-0 h-full w-2 cursor-ew-resize"
                  : edge === "right"
                    ? "right-0 top-0 h-full w-2 cursor-ew-resize"
                    : edge === "top"
                      ? "left-0 top-0 h-2 w-full cursor-ns-resize"
                      : "bottom-0 left-0 h-2 w-full cursor-ns-resize"
              }`}
              data-resize={edge}
              data-resize-handle={edge}
              data-resize-limited={resizeLimitedEdge === edge ? "true" : undefined}
              key={edge}
              onLostPointerCapture={(event) =>
                finishResize(event, { commit: false, releaseCapture: false })
              }
              onPointerCancel={(event) =>
                finishResize(event, { commit: false, releaseCapture: true })
              }
              onPointerDown={onPointerDownResize(edge)}
              onPointerMove={onPointerMoveResize}
              onPointerUp={(event) =>
                finishResize(event, { commit: true, releaseCapture: true })
              }
              role="separator"
              tabIndex={0}
            />
          ))}
        </>

      {resizeLimitedEdge ? (
        <div
          aria-live="polite"
          className="pointer-events-none absolute bottom-2 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-800 shadow-sm"
          role="status"
        >
          {t("canvas.resizeContentLimit")}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmingDelete}
        title={t("canvas.deleteConfirmTitle")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => {
          setConfirmingDelete(false);
          onRemove(id);
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
    </div>
    </div>
  );
}
