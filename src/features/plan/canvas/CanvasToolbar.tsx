import { useTranslation } from "react-i18next";
import { SaveStatus, type SaveState } from "../SaveStatus";

export interface CanvasToolbarProps {
  disabled: boolean;
  exporting: boolean;
  saveState: SaveState;
  onExport(): void;
}

export function CanvasToolbar({
  disabled,
  exporting,
  saveState,
  onExport,
}: CanvasToolbarProps) {
  const { t } = useTranslation();

  return (
    <>
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
