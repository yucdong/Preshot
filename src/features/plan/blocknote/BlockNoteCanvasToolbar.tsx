import { Minus, Plus } from "lucide-react";
import { SaveStatus, type SaveState } from "../SaveStatus";

interface BlockNoteCanvasToolbarProps {
  exporting: boolean;
  saveState: SaveState;
  zoom: number;
  onExport(): void;
  onFitWidth(): void;
  onResetZoom(): void;
  onZoomIn(): void;
  onZoomOut(): void;
}

export function BlockNoteCanvasToolbar({
  exporting,
  saveState,
  zoom,
  onExport,
  onFitWidth,
  onResetZoom,
  onZoomIn,
  onZoomOut,
}: BlockNoteCanvasToolbarProps) {
  return (
    <div className="flex h-11 items-center justify-between bg-[#202329] px-4 text-white">
      <span className="text-xs font-semibold">BlockNote Canvas v14</span>
      <div className="flex items-center gap-3">
        <div className="flex h-8 items-center rounded-md border border-white/10 bg-white/[0.06] p-0.5">
          <button
            aria-label="缩小画布"
            className="grid h-7 w-7 place-items-center rounded text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
            onClick={onZoomOut}
            type="button"
          >
            <Minus aria-hidden className="h-3.5 w-3.5" />
          </button>
          <button
            aria-label="恢复 100% 缩放"
            className="h-7 min-w-12 rounded px-1 text-[10px] tabular-nums text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
            onClick={onResetZoom}
            type="button"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            aria-label="放大画布"
            className="grid h-7 w-7 place-items-center rounded text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
            onClick={onZoomIn}
            type="button"
          >
            <Plus aria-hidden className="h-3.5 w-3.5" />
          </button>
          <button
            aria-label="适合宽度"
            className="ml-0.5 h-7 rounded px-2 text-[10px] font-semibold text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
            onClick={onFitWidth}
            type="button"
          >
            适宽
          </button>
        </div>
        <SaveStatus state={saveState} />
        <button
          className="rounded bg-app-accent px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
          disabled={exporting}
          onClick={onExport}
          type="button"
        >
          {exporting ? "导出中…" : "导出 PDF"}
        </button>
      </div>
    </div>
  );
}
