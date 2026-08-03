import { useTranslation } from "react-i18next";
import type { ReferenceComponent } from "../../../domain/plan/canvas/models";
import { RichTextEditor } from "../RichTextEditor";
import { GroupImageGrid } from "../GroupImageGrid";

interface ReferenceComponentViewProps {
  component: ReferenceComponent;
  imageSrc: (file: string) => string | undefined;
  onSetTitle: (id: string, title: string) => void;
  onSetDescription: (id: string, description: string) => void;
  onSetColumns: (id: string, columns: number) => void;
  onAddImage: (id: string) => void;
  onRemoveImage: (componentId: string, imageId: string) => void;
  onOpenImage: (file: string) => void;
}

export function ReferenceComponentView({
  component,
  imageSrc,
  onSetTitle,
  onSetDescription,
  onSetColumns,
  onAddImage,
  onRemoveImage,
  onOpenImage,
}: ReferenceComponentViewProps) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col">
      {/* Title input */}
      <input
        aria-label={t("reference.groupTitleAria")}
        className="mb-2 border-b border-stone-300 px-2 py-1 text-lg font-semibold focus:border-amber-500 focus:outline-none"
        onChange={(e) => onSetTitle(component.id, e.target.value)}
        type="text"
        value={component.title}
      />

      {/* Columns select */}
      <div className="mb-2 flex items-center gap-2">
        <label className="text-sm text-stone-600" htmlFor={`columns-${component.id}`}>
          {t("reference.imagesPerRow")}:
        </label>
        <select
          className="rounded border border-stone-300 px-2 py-1 text-sm"
          id={`columns-${component.id}`}
          onChange={(e) => onSetColumns(component.id, Number(e.target.value))}
          value={component.columnsPerRow}
        >
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      {/* Optional description editor */}
      {component.description.trim() && (
        <div className="mb-2">
          <RichTextEditor
            ariaLabel={t("reference.descriptionAria")}
            compact
            html={component.description}
            onChange={(html) => onSetDescription(component.id, html)}
            placeholder={t("reference.descriptionPlaceholder")}
          />
        </div>
      )}

      {/* Image grid (reuse GroupImageGrid) */}
      <div className="flex-1 overflow-auto">
        <GroupImageGrid
          group={component}
          imageSrc={imageSrc}
          onAddImage={onAddImage}
          onOpenImage={onOpenImage}
          onRemoveImage={onRemoveImage}
        />
      </div>
    </div>
  );
}
