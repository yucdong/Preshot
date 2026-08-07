import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  clampCardRect,
  componentFrameChromeHeight,
  contentSize,
  DEFAULT_PAGE_GEOMETRY,
  EDITABLE_COMPONENT_FRAME_CHROME,
  resizeCard,
  type Rect,
} from "../../../domain/plan/canvas/geometry";
import { type PlanComponent } from "../../../domain/plan/canvas/models";
import type { RenameComponentResult } from "../../../domain/plan/canvas/naming";
import { usePrefersReducedMotion } from "../../../shared/hooks/usePrefersReducedMotion";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { createMotionStyleTransition } from "./dragMotion";
import { estimateNameInputWidthEm } from "./componentNameWidth";

interface ComponentFrameProps {
  id: string;
  frameId?: string;
  rect: Rect;
  scale: number;
  onRemove: (id: string) => void;
  component: PlanComponent;
  onResize: (id: string, rect: Rect) => void;
  onResizePreview?: (id: string, rect: Rect) => void;
  onResizeCancel?: () => void;
  onRename?: (id: string, name: string) => RenameComponentResult;
  children?: React.ReactNode;
  sortableId?: string;
  isPlaceholder?: boolean;
}

interface ComponentFrameBodyProps extends ComponentFrameProps {
  setNodeRef: (node: HTMLElement | null) => void;
  transform?: { x: number; y: number; scaleX: number; scaleY: number } | null;
  transition?: string | null;
  dragAttributes?: React.HTMLAttributes<HTMLDivElement>;
  dragListeners?: React.HTMLAttributes<HTMLDivElement>;
  interactiveChrome: boolean;
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
    <div className="relative shrink-0">
      <input
        aria-describedby={nameError ? `${id}-name-error` : undefined}
        aria-label={t("canvas.componentName")}
        className="min-w-0 border-0 bg-transparent text-stone-700 outline-none focus:ring-2 focus:ring-amber-500 dark:text-stone-100"
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

function ComponentFrameBody({
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
  isPlaceholder = false,
  setNodeRef,
  transform,
  transition,
  dragAttributes,
  dragListeners,
  interactiveChrome,
}: ComponentFrameBodyProps) {
  const { t } = useTranslation();
  const prefersReducedMotion = usePrefersReducedMotion();
  const [resizeSession, setResizeSession] = useState<{
    element: HTMLElement;
    pointerId: number;
  } | null>(null);
  const [resizePreview, setResizePreview] = useState<Rect | null>(null);
  const [resizeStart, setResizeStart] = useState<{
    x: number;
    y: number;
    edge: "left" | "right" | "top" | "bottom";
    rect: Rect;
  } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const currentRect = resizePreview ?? rect;
  const canvasWidth = contentSize(DEFAULT_PAGE_GEOMETRY).width;

  const onPointerDownResize = (
    edge: "left" | "right" | "top" | "bottom",
  ) => (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setResizeSession({ element: event.currentTarget, pointerId: event.pointerId });
    setResizeStart({ x: event.clientX, y: event.clientY, edge, rect });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const nextRectForPointer = (event: React.PointerEvent<HTMLDivElement>): Rect | null => {
    if (!resizeStart) {
      return null;
    }
    const dx = (event.clientX - resizeStart.x) / scale;
    const dy = (event.clientY - resizeStart.y) / scale;
    const start = resizeStart.rect;
    if (resizeStart.edge === "left" || resizeStart.edge === "right") {
      const width = resizeStart.edge === "left" ? start.width - dx : start.width + dx;
      const sized = resizeCard(start, { width, height: start.height }, canvasWidth);
      const x = resizeStart.edge === "left" ? start.x + start.width - sized.width : start.x;
      return clampCardRect({ ...sized, x, y: start.y }, canvasWidth);
    }
    const height = resizeStart.edge === "top" ? start.height - dy : start.height + dy;
    const sized = resizeCard(start, { width: start.width, height }, canvasWidth);
    const y = resizeStart.edge === "top" ? start.y + start.height - sized.height : start.y;
    return clampCardRect({ ...sized, x: start.x, y }, canvasWidth);
  };

  const onPointerMoveResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!interactiveChrome) {
      return;
    }
    const next = nextRectForPointer(event);
    if (!next) {
      return;
    }
    setResizePreview(next);
    onResizePreview?.(id, next);
  };

  const finishResize = (
    event: React.PointerEvent<HTMLDivElement>,
    options: { commit: boolean; releaseCapture: boolean },
  ) => {
    const session = resizeSession;
    if (!session) {
      return;
    }
    const next = resizePreview;
    setResizeSession(null);
    setResizeStart(null);
    setResizePreview(null);
    if (options.releaseCapture && session.element.hasPointerCapture(event.pointerId)) {
      session.element.releasePointerCapture?.(event.pointerId);
    }
    if (options.commit && next && interactiveChrome) {
      onResize(id, next);
    } else if (!options.commit) {
      onResizeCancel?.();
    }
  };

  const frameChromeHeight = componentFrameChromeHeight(EDITABLE_COMPONENT_FRAME_CHROME);
  const bodyHeight = Math.max(0, currentRect.height - frameChromeHeight) * scale;

  return (
    <div
      ref={setNodeRef}
      className={`absolute rounded-xl border border-dashed border-stone-400/80 shadow-sm dark:border-stone-500 dark:shadow-black/30 ${
        isPlaceholder ? "border-2 border-amber-500 bg-transparent" : ""
      }`}
      data-component-frame="true"
      data-component-id={id}
      data-drag-placeholder={isPlaceholder ? "component" : undefined}
      data-fragment-id={frameId ?? id}
      data-sortable-component-id={interactiveChrome ? id : undefined}
      style={{
        left: `${currentRect.x * scale}px`,
        top: `${currentRect.y * scale}px`,
        width: `${currentRect.width * scale}px`,
        height: `${currentRect.height * scale}px`,
        transform:
          prefersReducedMotion || isPlaceholder || !transform
            ? undefined
            : CSS.Transform.toString(transform),
        transition: isPlaceholder
          ? undefined
          : createMotionStyleTransition(prefersReducedMotion, transition),
      }}
    >
      <div
        {...(dragAttributes ?? {})}
        {...(dragListeners ?? {})}
        aria-label={interactiveChrome ? t("canvas.moveHint") : undefined}
        className={`flex items-center justify-between rounded ${
          interactiveChrome
            ? "cursor-grab bg-stone-200 hover:bg-stone-300 dark:bg-stone-700 dark:hover:bg-stone-600"
            : "cursor-default bg-stone-200/70 dark:bg-stone-700/70"
        }`}
        data-component-drag-handle={interactiveChrome ? "true" : undefined}
        data-component-frame-topbar
        style={{
          height: `${EDITABLE_COMPONENT_FRAME_CHROME.topBarHeight * scale}px`,
          marginBottom: `${EDITABLE_COMPONENT_FRAME_CHROME.contentGap * scale}px`,
          opacity: isPlaceholder ? 0 : 1,
          paddingLeft: `${8 * scale}px`,
          paddingRight: `${8 * scale}px`,
        }}
        title={interactiveChrome ? t("canvas.moveHint") : undefined}
      >
        {interactiveChrome ? (
          <ComponentFrameNameInput
            id={id}
            key={component.name}
            name={component.name}
            onRename={onRename}
            scale={scale}
          />
        ) : (
          <span
            className="text-stone-400 dark:text-stone-500"
            style={{ fontSize: `${12 * scale}px`, lineHeight: `${16 * scale}px` }}
          >
            {component.name}
          </span>
        )}
        {interactiveChrome ? (
          <button
            aria-label={t("canvas.removeComponent")}
            className="rounded bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900 dark:text-red-200 dark:hover:bg-red-800"
            onClick={() => setConfirmingDelete(true)}
            onPointerDown={(event) => event.stopPropagation()}
            style={{
              fontSize: `${12 * scale}px`,
              height: `${20 * scale}px`,
              lineHeight: `${16 * scale}px`,
              paddingLeft: `${8 * scale}px`,
              paddingRight: `${8 * scale}px`,
            }}
            type="button"
          >
            ×
          </button>
        ) : null}
      </div>

      <div
        className="relative overflow-hidden"
        data-component-frame-body
        style={{
          paddingLeft: `${12 * scale}px`,
          paddingRight: `${12 * scale}px`,
          height: `${bodyHeight}px`,
          opacity: isPlaceholder ? 0 : 1,
        }}
      >
        {children}
      </div>

      {interactiveChrome ? (
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
              className={`absolute z-10 bg-stone-300/80 opacity-0 hover:opacity-100 focus-visible:opacity-100 dark:bg-stone-600/80 ${
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
  );
}

function DraggableFrame(props: ComponentFrameProps & { sortableId: string }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: props.sortableId,
    data: { type: "component", componentId: props.id },
  });

  return (
    <ComponentFrameBody
      {...props}
      dragAttributes={attributes}
      dragListeners={listeners}
      interactiveChrome
      setNodeRef={setNodeRef}
      transform={transform}
    />
  );
}

function PassiveFrame(props: ComponentFrameProps) {
  const { setNodeRef } = useDroppable({
    id: props.frameId ?? props.id,
    data: { type: "component", componentId: props.id },
  });

  return <ComponentFrameBody {...props} interactiveChrome={false} setNodeRef={setNodeRef} />;
}

export function ComponentFrame(props: ComponentFrameProps) {
  const sortableId = props.sortableId ?? props.id;
  return sortableId.length > 0
    ? <DraggableFrame {...props} sortableId={sortableId} />
    : <PassiveFrame {...props} />;
}
