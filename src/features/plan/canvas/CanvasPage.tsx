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
      className="pointer-events-none absolute left-0 bg-white shadow-[0_18px_44px_rgb(23_25_29_/_18%)]"
      data-testid="canvas-page-background"
      style={{ top: `${top}px`, width: `${width}px`, height: `${height}px` }}
    >
      <div
        className="pointer-events-none absolute border border-paper-border/55"
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
