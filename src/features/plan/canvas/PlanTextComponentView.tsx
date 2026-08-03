import { useTranslation } from "react-i18next";
import type { PlanTextComponent } from "../../../domain/plan/canvas/models";
import { RichTextEditor } from "../RichTextEditor";

interface PlanTextComponentViewProps {
  component: PlanTextComponent;
  onChangeHtml: (id: string, html: string) => void;
}

export function PlanTextComponentView({ component, onChangeHtml }: PlanTextComponentViewProps) {
  const { t } = useTranslation();

  return (
    <RichTextEditor
      ariaLabel={t("plan.photographyPlan")}
      html={component.html}
      onChange={(html) => onChangeHtml(component.id, html)}
    />
  );
}
