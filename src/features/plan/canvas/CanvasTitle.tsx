import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { SetPlanTitleResult } from "../../../domain/plan/canvas/naming";
import { DOCUMENT_TITLE_HEIGHT } from "../../../domain/plan/canvas/models";

export interface CanvasTitleProps {
  title: string;
  scale?: number;
  onCommit(title: string): SetPlanTitleResult;
}

export function CanvasTitle({ title, scale = 1, onCommit }: CanvasTitleProps) {
  return <CanvasTitleInput key={title} onCommit={onCommit} scale={scale} title={title} />;
}

function CanvasTitleInput({ title, scale = 1, onCommit }: CanvasTitleProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(title);
  const [titleError, setTitleError] = useState<string | null>(null);
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;

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
        className="font-editorial w-full border-0 bg-transparent px-0 font-bold text-paper-ink outline-none focus:ring-2 focus:ring-paper-primary"
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
        style={{
          fontSize: `${(DOCUMENT_TITLE_HEIGHT * 2 / 3) * safeScale}px`,
          lineHeight: `${DOCUMENT_TITLE_HEIGHT * safeScale}px`,
        }}
        type="text"
        value={draft}
      />
      {titleError ? (
        <div className="text-sm text-paper-danger" id="canvas-title-error" role="alert">
          {titleError}
        </div>
      ) : null}
    </div>
  );
}
