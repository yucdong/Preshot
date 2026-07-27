import { useEffect, useId, useRef, useState } from "react";

interface NewProjectDialogProps {
  onClose(): void;
  onCreate(name: string): Promise<void> | void;
}

const buttonClassName =
  "inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-50";

export function NewProjectDialog({ onClose, onCreate }: NewProjectDialogProps) {
  const [value, setValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmedValue = value.trim();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!trimmedValue || isSubmitting) {
      return;
    }

    setValue(trimmedValue);
    setIsSubmitting(true);

    try {
      const created = await Promise.resolve(onCreate(trimmedValue)).then(
        () => true,
        () => false,
      );

      if (created) {
        onClose();
      } else {
        setValue(trimmedValue);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div
        aria-labelledby={`${inputId}-title`}
        aria-modal="true"
        className="w-full max-w-lg rounded-[2rem] border border-white/10 bg-stone-950 p-6 shadow-2xl shadow-black/50"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !isSubmitting) {
            event.preventDefault();
            onClose();
          }
        }}
        role="dialog"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-stone-400">
              New project
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-white" id={`${inputId}-title`}>
              Create a Preshot workspace
            </h2>
          </div>
        </div>
        <form className="mt-6 space-y-6" onSubmit={handleSubmit}>
          <label className="block text-sm font-medium text-stone-200" htmlFor={inputId}>
            Project name
          </label>
          <input
            className="mt-2 w-full rounded-2xl border border-white/10 bg-stone-900 px-4 py-3 text-base text-white outline-none transition placeholder:text-stone-500 focus:border-amber-300 focus:ring-2 focus:ring-amber-300/30"
            disabled={isSubmitting}
            id={inputId}
            onChange={(event) => setValue(event.target.value)}
            ref={inputRef}
            value={value}
          />
          <div className="flex justify-end gap-3">
            <button
              className={`${buttonClassName} border border-white/10 text-stone-300 hover:border-white/20 hover:bg-white/5`}
              disabled={isSubmitting}
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className={`${buttonClassName} bg-amber-300 text-stone-950 hover:bg-amber-200`}
              disabled={!trimmedValue || isSubmitting}
              type="submit"
            >
              {isSubmitting ? "Creating..." : "Create project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
