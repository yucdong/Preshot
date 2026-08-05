import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { SPACING, type Rect } from "../../../domain/plan/canvas/geometry";
import { type PlanComponent } from "../../../domain/plan/canvas/models";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { resizeFromDrag } from "./useComponentResize";

interface ComponentFrameProps {
  id: string;
  rect: Rect;
  scale: number;
  onRemove: (id: string) => void;
  contentWidthPoints: number;
  component: PlanComponent;
  onResize: (id: string, params: { width: number }) => void;
  children?: React.ReactNode;
}

export function ComponentFrame({
  id,
  rect,
  scale,
  onRemove,
  contentWidthPoints,
  component,
  onResize,
  children,
}: ComponentFrameProps) {
  const { t } = useTranslation();
  const gutterInset = (SPACING / 2) * scale;

  const [resizing, setResizing] = useState<"width" | "left" | null>(null);
  const [resizePreview, setResizePreview] = useState<{ width: number } | null>(null);
  const [resizeStart, setResizeStart] = useState<{ x: number; edge: "width" | "left" } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const { attributes, listeners, setNodeRef: setDragRef } = useDraggable({
    id,
    data: { type: "component" },
  });

  const { setNodeRef: setDropRef } = useDroppable({
    id,
    data: { type: "component" },
  });

  const currentWidth = resizePreview?.width ?? component.width;
  const currentWidthPoints = contentWidthPoints * currentWidth;

  const typeLabel = component.type === "plan" ? t("canvas.typePlan") : t("canvas.typeReference");

  const onPointerDownResize = (edge: "width" | "left") => (event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setResizing(edge);
    setResizeStart({ x: event.clientX, edge });
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onPointerMoveResize = (event: React.PointerEvent) => {
    const start = resizeStart;
    if (!resizing || !start) {
      return;
    }
    const dxPoints = (event.clientX - start.x) / scale;
    const committedWidthPoints = contentWidthPoints * component.width;
    setResizePreview(
      resizeFromDrag({
        dxPoints: start.edge === "left" ? -dxPoints : dxPoints,
        currentWidthPoints: committedWidthPoints,
        contentWidth: contentWidthPoints,
      }),
    );
  };

  const onPointerUpResize = (event: React.PointerEvent) => {
    const currentPreview = resizePreview;
    if (!resizing || !currentPreview) {
      setResizing(null);
      setResizeStart(null);
      setResizePreview(null);
      return;
    }
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);
    setResizing(null);
    setResizeStart(null);
    setResizePreview(null);
    onResize(id, currentPreview);
  };

  const displayWidth = currentWidthPoints * scale;
  const displayHeight = rect.height * scale;

  return (
    <div
      ref={setDropRef}
      className="absolute"
      data-component-frame="true"
      data-component-id={id}
      style={{
        left: `${(SPACING + rect.x) * scale}px`,
        top: `${(SPACING + rect.y) * scale}px`,
        width: `${displayWidth}px`,
        height: `${displayHeight}px`,
      }}
    >
      <div
        ref={setDragRef}
        {...attributes}
        {...listeners}
        className="mb-1 flex cursor-grab items-center justify-between rounded bg-stone-200 px-2 py-1 hover:bg-stone-300 dark:bg-stone-700 dark:hover:bg-stone-600"
        data-component-frame-topbar
        title={t("canvas.moveHint")}
      >
        <span className="text-xs text-stone-400 dark:text-stone-500">{typeLabel}</span>
        <button
          aria-label={t("canvas.removeComponent")}
          className="rounded bg-red-100 px-2 py-1 text-xs text-red-700 hover:bg-red-200 dark:bg-red-900 dark:text-red-200 dark:hover:bg-red-800"
          onClick={() => setConfirmingDelete(true)}
          onPointerDown={(e) => e.stopPropagation()}
          type="button"
        >
          ×
        </button>
      </div>

      <div
        className="relative"
        style={{
          paddingLeft: `${gutterInset}px`,
          paddingRight: `${gutterInset}px`,
          height: "calc(100% - 28px)",
        }}
      >
        {children}
      </div>

      <div
        className="absolute left-0 top-1/2 h-8 w-2 -translate-y-1/2 cursor-ew-resize bg-stone-300 opacity-0 hover:opacity-100 dark:bg-stone-600"
        data-resize="left"
        data-resize-handle="left"
        onPointerDown={onPointerDownResize("left")}
        onPointerMove={onPointerMoveResize}
        onPointerUp={onPointerUpResize}
      />
      <div
        className="absolute right-0 top-1/2 h-8 w-2 -translate-y-1/2 cursor-ew-resize bg-stone-300 opacity-0 hover:opacity-100 dark:bg-stone-600"
        data-resize="width"
        data-resize-handle="width"
        onPointerDown={onPointerDownResize("width")}
        onPointerMove={onPointerMoveResize}
        onPointerUp={onPointerUpResize}
      />

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
