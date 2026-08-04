import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface NewProjectDialogProps {
  onClose(): void;
  onCreate(name: string): Promise<void> | void;
}

const buttonClassName =
  "inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-50";

const focusableSelector = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function getFocusableElements(container: HTMLElement | null) {
  if (!container) {
    return [];
  }

  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true",
  );
}

export function NewProjectDialog({ onClose, onCreate }: NewProjectDialogProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isSubmittingRef = useRef(isSubmitting);
  const triggerRef = useRef<HTMLElement | null>(null);
  const trimmedValue = value.trim();

  useEffect(() => {
    isSubmittingRef.current = isSubmitting;
  }, [isSubmitting]);

  useEffect(() => {
    triggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();

    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (isSubmittingRef.current) {
          return;
        }

        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = getFocusableElements(dialogRef.current);
      if (!focusableElements.length) {
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const isFocusInsideDialog =
        activeElement !== null && dialogRef.current?.contains(activeElement);

      if (!isFocusInsideDialog) {
        event.preventDefault();
        (event.shiftKey ? lastElement : firstElement).focus();
        return;
      }

      if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
        return;
      }

      if (event.shiftKey && activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      }
    }

    document.addEventListener("keydown", handleDocumentKeyDown);

    return () => {
      document.removeEventListener("keydown", handleDocumentKeyDown);
      if (triggerRef.current?.isConnected) {
        triggerRef.current.focus();
      }
    };
  }, [onClose]);

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
        className="w-full max-w-lg rounded-[2rem] border border-stone-200 bg-white p-6 shadow-2xl shadow-black/30 dark:border-white/10 dark:bg-stone-950 dark:shadow-black/50"
        ref={dialogRef}
        role="dialog"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-stone-500 dark:text-stone-400">
              {t("dialog.eyebrow")}
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-stone-900 dark:text-white" id={`${inputId}-title`}>
              {t("dialog.title")}
            </h2>
          </div>
        </div>
        <form className="mt-6 space-y-6" onSubmit={handleSubmit}>
          <label className="block text-sm font-medium text-stone-700 dark:text-stone-200" htmlFor={inputId}>
            {t("dialog.projectName")}
          </label>
          <input
            className="mt-2 w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-base text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-amber-300 focus:ring-2 focus:ring-amber-300/30 dark:border-white/10 dark:bg-stone-900 dark:text-white dark:placeholder:text-stone-500"
            disabled={isSubmitting}
            id={inputId}
            onChange={(event) => setValue(event.target.value)}
            ref={inputRef}
            value={value}
          />
          <div className="flex justify-end gap-3">
            <button
              className={`${buttonClassName} border border-stone-300 text-stone-700 hover:border-stone-400 hover:bg-stone-50 dark:border-white/10 dark:text-stone-300 dark:hover:border-white/20 dark:hover:bg-white/5`}
              disabled={isSubmitting}
              onClick={onClose}
              type="button"
            >
              {t("dialog.cancel")}
            </button>
            <button
              className={`${buttonClassName} bg-amber-300 text-stone-950 hover:bg-amber-200`}
              disabled={!trimmedValue || isSubmitting}
              type="submit"
            >
              {isSubmitting ? t("dialog.creating") : t("dialog.create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
