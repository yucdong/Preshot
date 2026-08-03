import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";

export interface InsertComponentMenuProps {
  onInsert: (type: "plan" | "reference") => void;
}

export function InsertComponentMenu({ onInsert }: InsertComponentMenuProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  const handleInsert = (type: "plan" | "reference") => {
    onInsert(type);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="rounded-md bg-stone-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        {t("canvas.insert")}
      </button>

      {isOpen && (
        <div
          className="absolute left-0 top-full z-10 mt-1 w-48 rounded-md bg-white py-1 shadow-lg ring-1 ring-black/5"
          role="menu"
        >
          <button
            className="block w-full px-4 py-2 text-left text-sm text-stone-900 hover:bg-stone-100"
            onClick={() => handleInsert("plan")}
            role="menuitem"
            type="button"
          >
            {t("canvas.insertPlan")}
          </button>
          <button
            className="block w-full px-4 py-2 text-left text-sm text-stone-900 hover:bg-stone-100"
            onClick={() => handleInsert("reference")}
            role="menuitem"
            type="button"
          >
            {t("canvas.insertReference")}
          </button>
        </div>
      )}
    </div>
  );
}
