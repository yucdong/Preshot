export type SaveState = "saved" | "unsaved" | "saving";

const STATUS: Record<SaveState, { label: string; dot: string }> = {
  saving: { label: "Saving…", dot: "bg-amber-400 animate-pulse" },
  unsaved: { label: "Unsaved changes", dot: "bg-stone-400" },
  saved: { label: "All changes saved", dot: "bg-emerald-500" },
};

export function SaveStatus({ state }: { state: SaveState }) {
  const { label, dot } = STATUS[state];

  return (
    <span
      aria-live="polite"
      className="inline-flex items-center gap-2 text-xs text-stone-500"
      data-testid="save-status"
      role="status"
    >
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
