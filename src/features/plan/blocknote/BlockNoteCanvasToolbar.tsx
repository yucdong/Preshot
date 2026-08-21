import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import { flushSync } from "react-dom";
import { ChevronDown, FileImage, FileText, Minus, Plus } from "lucide-react";
import { SaveStatus, type SaveState } from "../SaveStatus";
import {
  LongImageExportDialog,
  type LongImageExportSettings,
} from "./LongImageExportDialog";

interface BlockNoteCanvasToolbarProps {
  exportingDocx: boolean;
  exportingLongImage: boolean;
  exportingPdf: boolean;
  saveState: SaveState;
  zoom: number;
  onExportDocx(): void;
  onExportLongImage(settings: LongImageExportSettings): boolean;
  onExportPdf(): void;
  onFitWidth(): void;
  onResetZoom(): void;
  onZoomIn(): void;
  onZoomOut(): void;
}

export function BlockNoteCanvasToolbar({
  exportingDocx,
  exportingLongImage,
  exportingPdf,
  saveState,
  zoom,
  onExportDocx,
  onExportLongImage,
  onExportPdf,
  onFitWidth,
  onResetZoom,
  onZoomIn,
  onZoomOut,
}: BlockNoteCanvasToolbarProps) {
  const exportBusy = exportingPdf || exportingDocx || exportingLongImage;
  const exportLabel = exportingPdf
    ? "正在导出 PDF…"
    : exportingDocx
      ? "正在导出 DOCX…"
      : exportingLongImage
        ? "正在导出长图…"
      : "导出";
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [longImageDialogOpen, setLongImageDialogOpen] = useState(false);
  const exportMenuVisible = exportMenuOpen && !exportBusy;
  const exportControlRef = useRef<HTMLDivElement>(null);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);
  const exportItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const focusOnOpenRef = useRef<number | null>(null);
  const exportMenuId = useId();

  const closeExportMenu = useCallback((restoreTriggerFocus = false) => {
    focusOnOpenRef.current = null;
    setExportMenuOpen(false);
    if (restoreTriggerFocus) exportTriggerRef.current?.focus();
  }, []);
  const closeLongImageDialog = useCallback(() => {
    setLongImageDialogOpen(false);
  }, []);

  const openExportMenuAndFocus = (itemIndex: number) => {
    if (exportBusy) return;
    if (exportMenuVisible) {
      exportItemRefs.current[itemIndex]?.focus();
      return;
    }
    focusOnOpenRef.current = itemIndex;
    setExportMenuOpen(true);
  };

  const closeAfterFocusLeaves = (event: FocusEvent<HTMLDivElement>) => {
    const focusScope = event.currentTarget;
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && focusScope.contains(nextTarget)) return;
    queueMicrotask(() => {
      if (!focusScope.contains(document.activeElement)) closeExportMenu();
    });
  };

  useEffect(() => {
    if (!exportMenuVisible) return;
    const itemIndex = focusOnOpenRef.current;
    if (itemIndex === null) return;
    exportItemRefs.current[itemIndex]?.focus();
    focusOnOpenRef.current = null;
  }, [exportMenuVisible]);

  useEffect(() => {
    if (!exportMenuVisible) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target &&
        !exportControlRef.current?.contains(event.target as Node)
      ) {
        closeExportMenu();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [closeExportMenu, exportMenuVisible]);

  const handleExportTriggerKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
  ) => {
    if (exportBusy) {
      if (
        event.key === "Enter" ||
        event.key === " " ||
        event.key === "ArrowDown" ||
        event.key === "ArrowUp"
      ) {
        event.preventDefault();
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openExportMenuAndFocus(event.key === "ArrowDown" ? 0 : 2);
    } else if (event.key === "Escape" && exportMenuVisible) {
      event.preventDefault();
      closeExportMenu(true);
    }
  };

  const handleExportMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeExportMenu(true);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const currentIndex = exportItemRefs.current.findIndex(
      (item) => item === document.activeElement,
    );
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = (currentIndex + direction + 3) % 3;
    exportItemRefs.current[nextIndex]?.focus();
  };

  const selectExport = (format: "PDF" | "DOCX" | "LONG_IMAGE") => {
    if (exportBusy) return;
    flushSync(() => closeExportMenu());
    exportTriggerRef.current?.focus();
    if (format === "PDF") {
      onExportPdf();
    } else if (format === "DOCX") {
      onExportDocx();
    } else {
      setLongImageDialogOpen(true);
    }
  };

  const toggleExportMenu = () => {
    if (exportBusy) return;
    setExportMenuOpen((open) => !open);
  };

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
        <div
          className="relative"
          onBlur={closeAfterFocusLeaves}
          ref={exportControlRef}
        >
          <button
            aria-controls={exportMenuVisible ? exportMenuId : undefined}
            aria-disabled={exportBusy || undefined}
            aria-expanded={exportMenuVisible}
            aria-haspopup="menu"
            aria-label={exportLabel}
            className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded bg-app-accent px-3 text-xs font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#202329] ${
              exportBusy
                ? "cursor-not-allowed opacity-50"
                : "hover:brightness-105"
            }`}
            onClick={toggleExportMenu}
            onKeyDown={handleExportTriggerKeyDown}
            ref={exportTriggerRef}
            title={exportLabel}
            type="button"
          >
            <span>{exportLabel}</span>
            <ChevronDown
              aria-hidden
              className={`h-3.5 w-3.5 transition-transform ${
                exportMenuVisible ? "rotate-180" : ""
              }`}
            />
          </button>
          {exportMenuVisible ? (
            <div
              aria-label="导出格式"
              className="absolute right-0 top-full z-50 mt-1 w-40 max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-white/15 bg-[#292d34] p-1 shadow-xl"
              id={exportMenuId}
              onBlur={closeAfterFocusLeaves}
              onKeyDown={handleExportMenuKeyDown}
              role="menu"
            >
              {([
                { id: "PDF", label: "导出 PDF", icon: FileText },
                { id: "DOCX", label: "导出 DOCX", icon: FileText },
                { id: "LONG_IMAGE", label: "导出长图", icon: FileImage },
              ] as const).map(({ id, label, icon: Icon }, index) => (
                <button
                  className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-xs font-semibold text-white/90 hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-app-functional"
                  key={id}
                  onClick={() => selectExport(id)}
                  ref={(item) => {
                    exportItemRefs.current[index] = item;
                  }}
                  role="menuitem"
                  tabIndex={-1}
                  type="button"
                >
                  <Icon aria-hidden className="h-3.5 w-3.5 text-white/65" />
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {longImageDialogOpen ? (
        <LongImageExportDialog
          onCancel={closeLongImageDialog}
          onStart={(settings) => {
            const started = onExportLongImage(settings);
            if (started) setLongImageDialogOpen(false);
            return started;
          }}
        />
      ) : null}
    </div>
  );
}
