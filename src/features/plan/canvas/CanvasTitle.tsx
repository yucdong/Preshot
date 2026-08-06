import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SetPlanTitleResult } from "../../../domain/plan/canvas/naming";

export interface CanvasTitleProps {
  title: string;
  onCommit(title: string): SetPlanTitleResult;
}

export function CanvasTitle({ title, onCommit }: CanvasTitleProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(title);
  const [titleError, setTitleError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(title);
    setTitleError(null);
  }, [title]);

  const commit = () => {
    const result = onCommit(draft);
    if (result.ok) {
      setDraft(result.plan.title);
      setTitleError(null);
    } else {
      setTitleError(t("canvas.documentTitleEmpty"));
    }
  };

  return (
    <div className="relative">
      <input
        aria-describedby={titleError ? "canvas-title-error" : undefined}
        aria-label={t("canvas.documentTitle")}
        className="w-full border-0 bg-transparent px-0 text-2xl font-semibold text-stone-900 outline-none focus:ring-2 focus:ring-amber-500 dark:text-stone-100"
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setDraft(title);
            setTitleError(null);
          }
        }}
        type="text"
        value={draft}
      />
      {titleError ? (
        <div className="text-sm text-red-600 dark:text-red-400" id="canvas-title-error" role="alert">
          {titleError}
        </div>
      ) : null}
    </div>
  );
}
