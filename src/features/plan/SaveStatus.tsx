import { useTranslation } from "react-i18next";

export type SaveState = "saved" | "unsaved" | "saving";

const DOT: Record<SaveState, string> = {
  saving: "bg-amber-400 animate-pulse",
  unsaved: "bg-stone-400",
  saved: "bg-emerald-500",
};

const LABEL_KEY: Record<SaveState, "save.saving" | "save.unsaved" | "save.saved"> = {
  saving: "save.saving",
  unsaved: "save.unsaved",
  saved: "save.saved",
};

export function SaveStatus({ state }: { state: SaveState }) {
  const { t } = useTranslation();
  return (
    <span
      aria-live="polite"
      className="inline-flex items-center gap-2 text-xs text-stone-500"
      data-testid="save-status"
      role="status"
    >
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${DOT[state]}`} />
      {t(LABEL_KEY[state])}
    </span>
  );
}
