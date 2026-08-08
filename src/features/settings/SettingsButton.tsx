import { Settings } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsPanel } from "./SettingsPanel";

export function SettingsButton() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label={t("settings.open")}
        onClick={() => setOpen(true)}
        className="rounded-lg border border-white/10 bg-white/[0.06] p-2 text-white/70 transition-colors duration-200 hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
      >
        <Settings aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} />
      </button>
      <SettingsPanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}
