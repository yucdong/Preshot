import { A4, SPACING } from "../../../domain/plan/canvas/geometry";

interface CanvasPageProps {
  scale: number;
  top: number;
}

export function CanvasPage({ scale, top }: CanvasPageProps) {
  const width = A4.width * scale;
  const height = A4.height * scale;
  const marginScaled = SPACING * scale;

  return (
    <div
      aria-hidden="true"
      className="absolute left-0 bg-white shadow-sm dark:bg-stone-900"
      data-testid="canvas-page-background"
      style={{ top: `${top}px`, width: `${width}px`, height: `${height}px` }}
    >
      <div
        className="pointer-events-none absolute border border-dashed border-stone-200 dark:border-stone-700"
        style={{
          left: `${marginScaled}px`,
          top: `${marginScaled}px`,
          right: `${marginScaled}px`,
          bottom: `${marginScaled}px`,
        }}
      />
    </div>
  );
}
