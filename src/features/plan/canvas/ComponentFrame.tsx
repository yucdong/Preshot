import { useTranslation } from "react-i18next";
import { GUTTER, MARGIN, type Rect } from "../../../domain/plan/canvas/geometry";

interface ComponentFrameProps {
  id: string;
  rect: Rect;
  scale: number;
  onRemove: (id: string) => void;
  children?: React.ReactNode;
}

export function ComponentFrame({ id, rect, scale, onRemove, children }: ComponentFrameProps) {
  const { t } = useTranslation();
  const gutterInset = (GUTTER / 2) * scale;

  return (
    <div
      className="absolute"
      style={{
        left: `${(MARGIN + rect.x) * scale}px`,
        top: `${(MARGIN + rect.y) * scale}px`,
        width: `${rect.width * scale}px`,
        height: `${rect.height * scale}px`,
      }}
    >
      {/* Top bar with drag handle and delete button */}
      <div className="mb-1 flex items-center justify-between">
        <button
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

      {/* Resize handles (inert for Task B3, interactive in Task B4) */}
      <div
        className="absolute right-0 top-1/2 h-8 w-2 -translate-y-1/2 cursor-ew-resize bg-stone-300 opacity-0 hover:opacity-100"
        data-resize="width"
      />
      <div
        className="absolute bottom-0 left-1/2 h-2 w-8 -translate-x-1/2 cursor-ns-resize bg-stone-300 opacity-0 hover:opacity-100"
        data-resize="height"
      />
      <div
        className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize bg-stone-300 opacity-0 hover:opacity-100"
        data-resize="both"
      />
    </div>
  );
}
