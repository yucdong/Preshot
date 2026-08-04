import { A4, SPACING } from "../../../domain/plan/canvas/geometry";

interface CanvasPageProps {
  scale: number;
  children?: React.ReactNode;
}

export function CanvasPage({ scale, children }: CanvasPageProps) {
  const width = A4.width * scale;
  const height = A4.height * scale;
  const marginScaled = SPACING * scale;

  return (
    <div
      className="relative bg-white dark:bg-stone-900"
      data-testid="canvas-page"
      style={{ width: `${width}px`, height: `${height}px` }}
    >
      {/* Margin guide */}
      <div
        className="pointer-events-none absolute border border-dashed border-stone-200 dark:border-stone-700"
        style={{
          left: `${marginScaled}px`,
          top: `${marginScaled}px`,
          right: `${marginScaled}px`,
          bottom: `${marginScaled}px`,
        }}
      />
      {children}
    </div>
  );
}
