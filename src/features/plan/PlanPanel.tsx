import { useState } from "react";
import { PhotographyPlanTab } from "./PhotographyPlanTab";
import { ReferenceImagesTab, type ReferenceImagesTabProps } from "./ReferenceImagesTab";

type PlanTab = "photography" | "references";

interface PlanPanelProps extends ReferenceImagesTabProps {
  error?: string | null;
}

const tabButton =
  "px-4 py-2 text-sm font-medium border-b-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500";

export function PlanPanel({ error, ...referenceProps }: PlanPanelProps) {
  const [tab, setTab] = useState<PlanTab>("references");

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div aria-label="Plan tabs" className="flex gap-2 border-b border-black/10 px-6 pt-4" role="tablist">
        <button
          aria-selected={tab === "photography"}
          className={`${tabButton} ${tab === "photography" ? "border-amber-500 text-stone-900" : "border-transparent text-stone-500"}`}
          onClick={() => setTab("photography")}
          role="tab"
          type="button"
        >
          Photography Plan
        </button>
        <button
          aria-selected={tab === "references"}
          className={`${tabButton} ${tab === "references" ? "border-amber-500 text-stone-900" : "border-transparent text-stone-500"}`}
          onClick={() => setTab("references")}
          role="tab"
          type="button"
        >
          Reference Images
        </button>
      </div>

      {error ? (
        <div className="mx-6 mt-4 rounded-lg border border-rose-300 bg-rose-50 px-4 py-2 text-sm text-rose-700" role="alert">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "photography" ? <PhotographyPlanTab /> : <ReferenceImagesTab {...referenceProps} />}
      </div>
    </section>
  );
}
