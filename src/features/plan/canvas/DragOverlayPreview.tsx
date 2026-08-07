import { useTranslation } from "react-i18next";
import type { PlanComponent } from "../../../domain/plan/canvas/models";

interface DragOverlayPreviewProps {
  active: { type: "component" | "image"; id: string };
  component: PlanComponent;
  imageSrc: (file: string) => string | undefined;
}

function plainTextSummary(html: string): string {
  if (typeof document !== "undefined") {
    const container = document.createElement("div");
    container.innerHTML = html;
    return container.textContent?.replace(/\s+/g, " ").trim() ?? "";
  }

  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function summaryCharacterCount(text: string): number {
  return text.replace(/\s+/g, "").length;
}

export function DragOverlayPreview({
  active,
  component,
  imageSrc,
}: DragOverlayPreviewProps) {
  const { t } = useTranslation();

  if (active.type === "image" && component.type === "reference") {
    const image = component.images.find((entry) => entry.id === active.id);
    if (image) {
      return (
        <div
          className="w-44 rounded-xl border border-amber-400 bg-white/95 p-3 shadow-xl dark:border-amber-300 dark:bg-stone-900/95"
          data-testid="drag-overlay-preview"
        >
          <div className="overflow-hidden rounded-lg border border-black/10 bg-stone-100 dark:border-white/10 dark:bg-stone-800">
            {imageSrc(image.file) ? (
              <img
                alt={t("reference.imageAlt")}
                className="max-h-32 w-full object-contain"
                draggable={false}
                src={imageSrc(image.file)}
              />
            ) : (
              <div className="flex h-24 items-center justify-center text-xs text-stone-500">
                {t("reference.loading")}
              </div>
            )}
          </div>
          <div className="mt-2 text-xs text-stone-500 dark:text-stone-400">{component.name}</div>
        </div>
      );
    }
  }

  const typeLabel = component.type === "plan" ? t("canvas.typePlan") : t("canvas.typeReference");
  const detail = component.type === "plan" ? plainTextSummary(component.html).slice(0, 80) : component.name;
  const compactSummary =
    component.type === "plan"
      ? t("canvas.planCharacterCount", { count: summaryCharacterCount(plainTextSummary(component.html)) })
      : t("canvas.referenceImageCount", { count: component.images.length });

  return (
    <div
      className="max-h-40 w-56 rounded-xl border border-amber-400 bg-white/95 p-3 shadow-xl dark:border-amber-300 dark:bg-stone-900/95"
      data-testid="drag-overlay-preview"
    >
      <div className="text-xs text-stone-500 dark:text-stone-400">{typeLabel}</div>
      <div className="mt-1 line-clamp-4 text-sm font-medium text-stone-900 dark:text-stone-100">{detail}</div>
      <div className="mt-2 text-xs text-stone-500 dark:text-stone-400">{compactSummary}</div>
    </div>
  );
}
