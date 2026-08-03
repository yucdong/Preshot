import { useTranslation } from "react-i18next";
import { PhotographyPlanTab } from "./PhotographyPlanTab";
import { ReferenceImagesTab, type ReferenceImagesTabProps } from "./ReferenceImagesTab";
import { SaveStatus, type SaveState } from "./SaveStatus";

interface PlanPanelProps extends ReferenceImagesTabProps {
  error?: string | null;
  saveState: SaveState;
  photographyPlan: string;
  onSetPhotographyPlan(html: string): void;
  exporting: boolean;
  onExport(): void;
}

export function PlanPanel({ error, saveState, photographyPlan, onSetPhotographyPlan, exporting, onExport, ...referenceProps }: PlanPanelProps) {
  const { t } = useTranslation();
  return (
    <section aria-label="Plan" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-end gap-3 border-b border-black/10 px-6 py-2">
        <button
          className="rounded-full bg-stone-900 px-3 py-1 text-xs font-medium text-white hover:bg-stone-700 disabled:opacity-50"
          disabled={exporting}
          onClick={onExport}
          type="button"
        >
          {exporting ? t("plan.exporting") : t("plan.exportPdf")}
        </button>
        <SaveStatus state={saveState} />
      </div>

      {error ? (
        <div className="mx-6 mt-4 rounded-lg border border-rose-300 bg-rose-50 px-4 py-2 text-sm text-rose-700" role="alert">
          {t("errors.plan")}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <PhotographyPlanTab html={photographyPlan} onChange={onSetPhotographyPlan} />
        <ReferenceImagesTab {...referenceProps} />
      </div>
    </section>
  );
}
