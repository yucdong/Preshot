import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDroppable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  componentFrameChromeHeight,
  EDITABLE_COMPONENT_FRAME_CHROME,
  SPACING,
  type Rect,
} from "../../../domain/plan/canvas/geometry";
import { type PlanComponent } from "../../../domain/plan/canvas/models";
import type { RenameComponentResult } from "../../../domain/plan/canvas/naming";
import { usePrefersReducedMotion } from "../../../shared/hooks/usePrefersReducedMotion";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { resizeFromDrag } from "./useComponentResize";
import {
  createAnimateLayoutChanges,
  createMotionStyleTransition,
  SORTABLE_LAYOUT_TRANSITION,
} from "./dragMotion";

interface ComponentFrameProps {
  id: string;
  frameId?: string;
  rect: Rect;
  scale: number;
  topPx?: number;
  onRemove: (id: string) => void;
  contentWidthPoints: number;
  component: PlanComponent;
  onResize: (id: string, params: { width: number }) => void;
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

function ComponentFrameBody({
  id,
  frameId,
  rect,
  scale,
  topPx,
  onRemove,
  onRename,
  contentWidthPoints,
  component,
  onResize,
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
  const gutterInset = (SPACING / 2) * scale;
  const prefersReducedMotion = usePrefersReducedMotion();

  const [resizeSession, setResizeSession] = useState<{ element: HTMLElement; pointerId: number } | null>(null);
  const [resizing, setResizing] = useState<"width" | "left" | null>(null);
  const [resizePreview, setResizePreview] = useState<{ width: number } | null>(null);
  const [resizeStart, setResizeStart] = useState<{ x: number; edge: "width" | "left" } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [nameDraft, setNameDraft] = useState(component.name);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    setNameDraft(component.name);
    setNameError(null);
  }, [component.name]);

  const currentWidth = resizePreview?.width ?? component.width;
  const committedWidthPoints = contentWidthPoints * component.width;
  const currentWidthPoints = contentWidthPoints * currentWidth;
  const commitName = () => {
    if (!onRename) {
      return;
    }
    const result = onRename(id, nameDraft);
    if (result.ok) {
      setNameDraft(result.plan.components?.find((entry) => entry.id === id)?.name ?? nameDraft.trim());
      setNameError(null);
    } else {
      setNameError(t(`canvas.nameError.${result.reason}`));
    }
  };

  const onPointerDownResize = (edge: "width" | "left") => (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setResizeSession({ element: event.currentTarget, pointerId: event.pointerId });
    setResizing(edge);
    setResizeStart({ x: event.clientX, edge });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMoveResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = resizeStart;
    if (!interactiveChrome || !resizing || !start) {
      return;
    }
    const dxPoints = (event.clientX - start.x) / scale;
    setResizePreview(
      resizeFromDrag({
        dxPoints: start.edge === "left" ? -dxPoints : dxPoints,
        currentWidthPoints: committedWidthPoints,
        contentWidth: contentWidthPoints,
      }),
    );
  };

  const finishResize = (
    event: React.PointerEvent<HTMLDivElement>,
    options: { commit: boolean; releaseCapture: boolean },
  ) => {
    const session = resizeSession;
    if (!session) {
      return;
    }
    const currentPreview = resizePreview;
    setResizeSession(null);
    setResizing(null);
    setResizeStart(null);
    setResizePreview(null);
    if (options.releaseCapture && session.element.hasPointerCapture(event.pointerId)) {
      session.element.releasePointerCapture?.(event.pointerId);
    }
    if (options.commit && currentPreview && interactiveChrome) {
      onResize(id, currentPreview);
    }
  };

  const displayWidth = currentWidthPoints * scale;
  const displayHeight = rect.height * scale;
  const frameChromeHeight = componentFrameChromeHeight(EDITABLE_COMPONENT_FRAME_CHROME);
  const bodyHeight = Math.max(0, rect.height - frameChromeHeight) * scale;
  const displayLeft =
    (SPACING + rect.x) * scale +
    (resizing === "left" && resizePreview ? (committedWidthPoints - currentWidthPoints) * scale : 0);

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
        left: `${displayLeft}px`,
        top: `${topPx ?? (SPACING + rect.y) * scale}px`,
        width: `${displayWidth}px`,
        height: `${displayHeight}px`,
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
        className={`flex items-center justify-between rounded ${
          interactiveChrome
            ? "cursor-grab bg-stone-200 hover:bg-stone-300 dark:bg-stone-700 dark:hover:bg-stone-600"
            : "cursor-default bg-stone-200/70 dark:bg-stone-700/70"
        }`}
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
          <div className="relative min-w-0 flex-1">
            <input
              aria-describedby={nameError ? `${id}-name-error` : undefined}
              aria-label={t("canvas.componentName")}
              className="min-w-0 w-full border-0 bg-transparent text-stone-700 outline-none focus:ring-2 focus:ring-amber-500 dark:text-stone-100"
              onBlur={commitName}
              onChange={(event) => setNameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitName();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setNameDraft(component.name);
                  setNameError(null);
                }
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              style={{ fontSize: `${12 * scale}px`, lineHeight: `${16 * scale}px` }}
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
            onPointerDown={(e) => e.stopPropagation()}
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
        className="relative"
        data-component-frame-body
        style={{
          paddingLeft: `${gutterInset}px`,
          paddingRight: `${gutterInset}px`,
          height: `${bodyHeight}px`,
          opacity: isPlaceholder ? 0 : 1,
        }}
      >
        {children}
      </div>

      {interactiveChrome ? (
        <>
          <div
            className="absolute left-0 top-1/2 h-8 w-2 -translate-y-1/2 cursor-ew-resize bg-stone-300 opacity-0 hover:opacity-100 dark:bg-stone-600"
            data-resize="left"
            data-resize-handle="left"
            onLostPointerCapture={(event) => finishResize(event, { commit: false, releaseCapture: false })}
            onPointerDown={onPointerDownResize("left")}
            onPointerMove={onPointerMoveResize}
            onPointerCancel={(event) => finishResize(event, { commit: false, releaseCapture: true })}
            onPointerUp={(event) => finishResize(event, { commit: true, releaseCapture: true })}
          />
          <div
            className="absolute right-0 top-1/2 h-8 w-2 -translate-y-1/2 cursor-ew-resize bg-stone-300 opacity-0 hover:opacity-100 dark:bg-stone-600"
            data-resize="width"
            data-resize-handle="width"
            onLostPointerCapture={(event) => finishResize(event, { commit: false, releaseCapture: false })}
            onPointerDown={onPointerDownResize("width")}
            onPointerMove={onPointerMoveResize}
            onPointerCancel={(event) => finishResize(event, { commit: false, releaseCapture: true })}
            onPointerUp={(event) => finishResize(event, { commit: true, releaseCapture: true })}
          />
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

function SortableFrame(props: ComponentFrameProps & { sortableId: string }) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: props.sortableId,
    data: { type: "component", componentId: props.id },
    animateLayoutChanges: createAnimateLayoutChanges(prefersReducedMotion),
    transition: prefersReducedMotion ? undefined : SORTABLE_LAYOUT_TRANSITION,
  });

  return (
    <ComponentFrameBody
      {...props}
      dragAttributes={attributes}
      dragListeners={listeners}
      interactiveChrome
      setNodeRef={setNodeRef}
      transform={transform}
      transition={transition}
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

  if (sortableId.length > 0) {
    return <SortableFrame {...props} sortableId={sortableId} />;
  }

  return <PassiveFrame {...props} />;
}
