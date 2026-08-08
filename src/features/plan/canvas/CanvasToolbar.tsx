import { useTranslation } from "react-i18next";
import { SaveStatus, type SaveState } from "../SaveStatus";
import { InsertComponentMenu } from "./InsertComponentMenu";

export interface CanvasToolbarProps {
  disabled: boolean;
  exporting: boolean;
  saveState: SaveState;
  onInsert(type: "plan" | "reference"): void;
  onExport(): void;
}

export function CanvasToolbar({
  disabled,
  exporting,
  saveState,
  onInsert,
  onExport,
}: CanvasToolbarProps) {
  const { t } = useTranslation();

  return (
    <>
      <div className="absolute left-1/2 top-3 z-40 flex min-h-11 max-w-[calc(100%-2rem)] -translate-x-1/2 items-center rounded-[9px] border border-white/10 bg-[#202329] px-1.5 py-1.5 text-white shadow-[0_8px_26px_rgb(17_18_22_/_25%)]">
        <InsertComponentMenu disabled={disabled} onInsert={onInsert} />
      </div>
      <div className="fixed right-44 top-[21px] z-50">
        <SaveStatus state={saveState} />
      </div>
      <button
        className="fixed right-4 top-[11px] z-50 h-9 rounded-lg bg-app-accent px-4 text-xs font-bold text-app-on-accent shadow-[0_4px_12px_rgb(194_56_92_/_28%)] transition-[background-color,transform] duration-200 hover:bg-app-accent-hover active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-app-functional disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled || exporting}
        onClick={onExport}
        type="button"
      >
        {exporting ? t("plan.exporting") : t("plan.exportPdf")}
      </button>
    </>
  );
}
