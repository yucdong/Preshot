import { useTranslation } from "react-i18next";
import { RichTextEditor } from "./RichTextEditor";

interface PhotographyPlanTabProps {
  html: string;
  onChange(html: string): void;
}

export function PhotographyPlanTab({ html, onChange }: PhotographyPlanTabProps) {
  const { t } = useTranslation();
  return (
    <section aria-label={t("plan.photographyPlan")} className="border-b border-black/10 bg-white/60 px-6 py-5">
      <p className="text-xs font-medium uppercase tracking-[0.24em] text-amber-700">{t("plan.photographyPlan")}</p>
      <h3 className="mt-2 mb-3 text-xl font-semibold text-stone-900">{t("plan.shotNotes")}</h3>
      <RichTextEditor ariaLabel={t("plan.photographyPlan")} html={html} onChange={onChange} placeholder={t("plan.planPlaceholder")} />
    </section>
  );
}
