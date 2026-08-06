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
    <div className="flex items-center gap-4 border-b border-stone-200 bg-white px-6 py-3 dark:border-stone-700 dark:bg-stone-900">
      <InsertComponentMenu disabled={disabled} onInsert={onInsert} />
      <SaveStatus state={saveState} />
      <button
        className="ml-auto rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-stone-950 hover:bg-amber-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-amber-400 dark:hover:bg-amber-300"
        disabled={disabled || exporting}
        onClick={onExport}
        type="button"
      >
        {exporting ? t("plan.exporting") : t("plan.exportPdf")}
      </button>
    </div>
  );
}
