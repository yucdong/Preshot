import { A4 } from "../../../domain/plan/canvas/geometry";
import { CanvasPage } from "./CanvasPage";
import { PAGE_SCREEN_GAP, pageTopPx } from "./pagedCanvasMetrics";

interface PagedCanvasSurfaceProps {
  pageCount: number;
  scale: number;
  children: React.ReactNode;
}

export function PagedCanvasSurface({ pageCount, scale, children }: PagedCanvasSurfaceProps) {
  const pageHeight = A4.height * scale;
  const height = pageCount * pageHeight + Math.max(0, pageCount - 1) * PAGE_SCREEN_GAP;

  return (
    <div
      className="relative"
      data-testid="paged-canvas-surface"
      style={{ width: `${A4.width * scale}px`, height: `${height}px` }}
    >
      {Array.from({ length: pageCount }, (_unused, index) => (
        <CanvasPage key={index} scale={scale} top={pageTopPx(index, scale)} />
      ))}
      {children}
    </div>
  );
}
