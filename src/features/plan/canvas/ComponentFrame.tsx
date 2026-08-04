import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { GUTTER, MARGIN, type Rect } from "../../../domain/plan/canvas/geometry";
import { clampWidth, effectiveWidth, type PlanComponent } from "../../../domain/plan/canvas/models";

interface ComponentFrameProps {
  id: string;
  rect: Rect;
  scale: number;
  onRemove: (id: string) => void;
  contentWidthPoints: number;
  component: PlanComponent;
  onResize: (id: string, params: { width?: number; height?: number }) => void;
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
  const gutterInset = (GUTTER / 2) * scale;

  const [resizing, setResizing] = useState<"width" | "height" | "both" | null>(null);
  const [resizePreview, setResizePreview] = useState<{ width?: number; height?: number } | null>(null);
  const [resizeStart, setResizeStart] = useState<{ x: number; y: number; edge: "width" | "height" | "both" } | null>(
    null,
  );

  const { attributes, listeners, setNodeRef: setDragRef } = useDraggable({
    id,
    data: { type: "component" },
  });

  const { setNodeRef: setDropRef } = useDroppable({
    id,
    data: { type: "component" },
  });

  const currentWidth = resizePreview?.width ?? effectiveWidth(component);
  const currentHeight = resizePreview?.height ?? component.height;
  const currentWidthPoints = contentWidthPoints * currentWidth;

  const onPointerDownResize = (edge: "width" | "height" | "both") => (event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setResizing(edge);
    const start = { x: event.clientX, y: event.clientY, edge };
    setResizeStart(start);
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onPointerMoveResize = (event: React.PointerEvent) => {
    const start = resizeStart;
    if (!resizing || !start) {
      return;
    }
    const dxPx = event.clientX - start.x;
    const dyPx = event.clientY - start.y;
    const dxPoints = dxPx / scale;
    const dyPoints = dyPx / scale;

    const result: { width?: number; height?: number } = {};

    if (start.edge === "width" || start.edge === "both") {
      const nextWidth = clampWidth((currentWidthPoints + dxPoints) / contentWidthPoints);
      result.width = nextWidth;
    }

    if (start.edge === "height" || start.edge === "both") {
      result.height = component.height + dyPoints;
    }

    setResizePreview(result);
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
  const displayHeight = currentHeight * scale;

  return (
    <div
      ref={setDropRef}
      className="absolute"
      data-component-frame="true"
      data-component-id={id}
      style={{
        left: `${(MARGIN + rect.x) * scale}px`,
        top: `${(MARGIN + rect.y) * scale}px`,
        width: `${displayWidth}px`,
        height: `${displayHeight}px`,
      }}
    >
      {/* Top bar with drag handle and delete button */}
      <div className="mb-1 flex items-center justify-between">
        <button
          ref={setDragRef}
          {...attributes}
          {...listeners}
          aria-label={t("canvas.moveComponent")}
          className="cursor-move rounded bg-stone-200 px-2 py-1 text-xs hover:bg-stone-300"
          data-drag-handle
          type="button"
        >
          ⋮⋮
        </button>
        <button
          aria-label={t("canvas.removeComponent")}
          className="rounded bg-red-100 px-2 py-1 text-xs text-red-700 hover:bg-red-200"
          onClick={() => onRemove(id)}
          type="button"
        >
          ×
        </button>
      </div>

      {/* Content area with gutter inset */}
      <div
        className="relative"
        style={{
          paddingLeft: `${gutterInset}px`,
          paddingRight: `${gutterInset}px`,
          height: `calc(100% - 28px)`, // Subtract top bar height
        }}
      >
        {children}
      </div>

      {/* Resize handles */}
      <div
        className="absolute right-0 top-1/2 h-8 w-2 -translate-y-1/2 cursor-ew-resize bg-stone-300 opacity-0 hover:opacity-100"
        data-resize="width"
        data-resize-handle="width"
        onPointerDown={onPointerDownResize("width")}
        onPointerMove={onPointerMoveResize}
        onPointerUp={onPointerUpResize}
      />
      <div
        className="absolute bottom-0 left-1/2 h-2 w-8 -translate-x-1/2 cursor-ns-resize bg-stone-300 opacity-0 hover:opacity-100"
        data-resize="height"
        data-resize-handle="height"
        onPointerDown={onPointerDownResize("height")}
        onPointerMove={onPointerMoveResize}
        onPointerUp={onPointerUpResize}
      />
      <div
        className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize bg-stone-300 opacity-0 hover:opacity-100"
        data-resize="both"
        data-resize-handle="both"
        onPointerDown={onPointerDownResize("both")}
        onPointerMove={onPointerMoveResize}
        onPointerUp={onPointerUpResize}
      />
    </div>
  );
}
