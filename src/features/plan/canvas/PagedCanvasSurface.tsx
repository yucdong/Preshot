import { A4 } from "../../../domain/plan/canvas/geometry";
import { useDroppable } from "@dnd-kit/core";
import { CanvasPage } from "./CanvasPage";
import { PAGE_SCREEN_GAP, pageTopPx } from "./pagedCanvasMetrics";

const CANVAS_DROPPABLE_ID = Number.MIN_SAFE_INTEGER;

interface PagedCanvasSurfaceProps {
  pageCount: number;
  scale: number;
  children: React.ReactNode;
}

export function PagedCanvasSurface({ pageCount, scale, children }: PagedCanvasSurfaceProps) {
  const { setNodeRef } = useDroppable({
    id: CANVAS_DROPPABLE_ID,
    data: { type: "canvas" },
  });
  const pageHeight = A4.height * scale;
  const height = pageCount * pageHeight + Math.max(0, pageCount - 1) * PAGE_SCREEN_GAP;

  return (
    <div
      className="relative shrink-0"
      data-testid="paged-canvas-surface"
      ref={setNodeRef}
      style={{ width: `${A4.width * scale}px`, height: `${height}px` }}
    >
      {Array.from({ length: pageCount }, (_unused, index) => (
        <CanvasPage key={index} scale={scale} top={pageTopPx(index, scale)} />
      ))}
      {Array.from({ length: Math.max(0, pageCount - 1) }, (_unused, index) => (
        <div
          aria-hidden="true"
          className="absolute left-0 z-30 cursor-default"
          data-testid="canvas-page-gap"
          key={`gap-${index}`}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          style={{
            top: `${pageTopPx(index, scale) + pageHeight}px`,
            width: `${A4.width * scale}px`,
            height: `${PAGE_SCREEN_GAP}px`,
          }}
        />
      ))}
      {children}
    </div>
  );
}
