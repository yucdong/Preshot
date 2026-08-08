import { useTranslation } from "react-i18next";
import type { ReferenceComponent } from "../../../domain/plan/canvas/models";

interface DragOverlayPreviewProps {
  activeId: string;
  component: ReferenceComponent;
  imageSrc: (file: string) => string | undefined;
}

export function DragOverlayPreview({
  activeId,
  component,
  imageSrc,
}: DragOverlayPreviewProps) {
  const { t } = useTranslation();

  const image = component.images.find((entry) => entry.id === activeId);
  if (image) {
    return (
        <div
          className="w-44 rounded-lg border border-paper-primary bg-white/95 p-3 text-paper-ink shadow-[var(--app-shadow)]"
          data-testid="drag-overlay-preview"
        >
          <div className="overflow-hidden rounded-lg border border-paper-border bg-[#eef3f1]">
            {imageSrc(image.file) ? (
              <img
                alt={t("reference.imageAlt")}
                className="max-h-32 w-full object-contain"
                draggable={false}
                src={imageSrc(image.file)}
              />
            ) : (
              <div className="flex h-24 items-center justify-center text-xs text-paper-muted">
                {t("reference.loading")}
              </div>
            )}
          </div>
          <div className="mt-2 text-xs text-paper-muted">{component.name}</div>
        </div>
    );
  }
  return null;
}
