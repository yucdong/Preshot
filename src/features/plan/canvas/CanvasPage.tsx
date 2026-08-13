import { A4, SPACING } from "../../../domain/plan/canvas/geometry";

interface CanvasPageProps {
  scale: number;
  top: number;
}

export function CanvasPage({ scale, top }: CanvasPageProps) {
  const width = A4.width * scale;
  const height = A4.height * scale;
  const margin = SPACING * scale;
  const cornerSize = Math.max(8, 14 * scale);
  const cornerOffset = margin - cornerSize;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute left-0 bg-white shadow-[0_18px_44px_rgb(23_25_29_/_18%)]"
      data-testid="canvas-page-background"
      style={{ top: `${top}px`, width: `${width}px`, height: `${height}px` }}
    >
      {(["top-left", "top-right", "bottom-left", "bottom-right"] as const).map((corner) => (
        <span
          className="pointer-events-none absolute border-paper-border"
          data-corner={corner}
          data-testid="canvas-page-corner"
          key={corner}
          style={{
            width: `${cornerSize}px`,
            height: `${cornerSize}px`,
            ...(corner.includes("top") ? { top: `${cornerOffset}px`, borderBottomWidth: "1px" } : { bottom: `${cornerOffset}px`, borderTopWidth: "1px" }),
            ...(corner.includes("left") ? { left: `${cornerOffset}px`, borderRightWidth: "1px" } : { right: `${cornerOffset}px`, borderLeftWidth: "1px" }),
          }}
        />
      ))}
    </div>
  );
}
