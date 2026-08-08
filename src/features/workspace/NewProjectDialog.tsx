import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface NewProjectDialogProps {
  onClose(): void;
  onCreate(name: string): Promise<void> | void;
}

const buttonClassName =
  "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition-[background-color,border-color,color,transform] duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-app-functional disabled:cursor-not-allowed disabled:opacity-50";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6 backdrop-blur-[2px]">
      <div
        aria-labelledby={`${inputId}-title`}
        aria-modal="true"
        className="w-full max-w-lg rounded-lg border border-app-border bg-app-panel-strong p-6 text-app-ink shadow-[var(--app-shadow)]"
        ref={dialogRef}
        role="dialog"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-app-primary">
              {t("dialog.eyebrow")}
            </p>
            <h2 className="font-editorial mt-2 text-2xl font-bold" id={`${inputId}-title`}>
              {t("dialog.title")}
            </h2>
          </div>
        </div>
        <form className="mt-6 space-y-6" onSubmit={handleSubmit}>
          <label className="block text-sm font-medium text-app-muted" htmlFor={inputId}>
            {t("dialog.projectName")}
          </label>
          <input
            className="mt-2 w-full rounded-lg border border-app-border bg-app-panel px-4 py-3 text-base text-app-ink outline-none transition-colors placeholder:text-app-muted focus:border-app-primary focus:ring-2 focus:ring-app-primary/25"
            disabled={isSubmitting}
            id={inputId}
            onChange={(event) => setValue(event.target.value)}
            ref={inputRef}
            value={value}
          />
          <div className="flex justify-end gap-3">
            <button
              className={`${buttonClassName} border border-app-border text-app-muted hover:border-app-primary hover:text-app-primary`}
              disabled={isSubmitting}
              onClick={onClose}
              type="button"
            >
              {t("dialog.cancel")}
            </button>
            <button
              className={`${buttonClassName} bg-app-accent text-white hover:bg-app-accent-hover active:scale-[0.98]`}
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
