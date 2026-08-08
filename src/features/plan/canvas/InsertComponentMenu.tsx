import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";

export interface InsertComponentMenuProps {
  onInsert: (type: "plan" | "reference") => void;
  disabled?: boolean;
}

export function InsertComponentMenu({ onInsert, disabled = false }: InsertComponentMenuProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || disabled) return;

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
  }, [disabled, isOpen]);

  const handleInsert = (type: "plan" | "reference") => {
    onInsert(type);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="rounded-md border border-white/10 bg-white/[0.08] px-3 py-2 text-xs font-bold text-white transition-[background-color,transform] duration-200 hover:bg-white/15 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-app-functional disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        {t("canvas.insert")}
      </button>

      {isOpen && !disabled && (
        <div
          className="absolute left-0 top-full z-10 mt-2 w-48 rounded-lg border border-[#343840] bg-[#202329] py-1 text-white shadow-[0_10px_28px_rgb(0_0_0_/_24%)]"
          role="menu"
        >
          <button
            className="block w-full px-4 py-2 text-left text-xs text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            onClick={() => handleInsert("plan")}
            role="menuitem"
            type="button"
          >
            {t("canvas.insertPlan")}
          </button>
          <button
            className="block w-full px-4 py-2 text-left text-xs text-white/80 transition-colors hover:bg-white/10 hover:text-white"
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
