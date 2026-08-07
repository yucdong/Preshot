import { useTranslation } from "react-i18next";
import type { ReferenceComponent } from "../../../domain/plan/canvas/models";
import {
  COMPONENT_INSET,
  REFERENCE_HEADER_GAP,
  REFERENCE_TITLE_ROW_HEIGHT,
  type ReferenceFlowSlot,
} from "../../../domain/plan/canvas/referenceLayout";
import { RichTextEditor } from "../RichTextEditor";
import { GroupImageGrid } from "../GroupImageGrid";
import { ImageActionButtons } from "../ImageActionButtons";
import type { ImageImportProgress } from "../imageImportProgress";

interface ReferenceComponentViewProps {
  component: ReferenceComponent;
  imageSrc: (file: string) => string | undefined;
  onSetDescription: (id: string, description: string) => void;
  onAddImage: (id: string) => void;
  onRemoveImage: (componentId: string, imageId: string) => void;
  onOpenImage: (file: string) => void;
  onSelectImage?: (imageId: string, toggle: boolean) => void;
  selectedImageIds?: ReadonlySet<string>;
  enableReorder?: boolean;
  slots: ReferenceFlowSlot[];
  scale: number;
  hiddenImageId?: string;
  placeholderImage?: { id: string; file: string; caption?: string };
  placeholderSlot?: ReferenceFlowSlot;
  placeholderIndex?: number;
  importProgress?: ImageImportProgress;
  onCaptureImage?: (componentId: string) => void;
  onCancelCapture?: () => void;
  captureStatus?: "waiting" | "importing";
  onAddImages?: (id: string) => void;
}

export function ReferenceComponentView({
  component,
  imageSrc,
  onSetDescription,
  onAddImage,
  onRemoveImage,
  onOpenImage,
  onSelectImage = () => undefined,
  selectedImageIds = new Set<string>(),
  enableReorder = false,
  slots,
  scale,
  hiddenImageId,
  placeholderImage,
  placeholderSlot,
  placeholderIndex,
  importProgress,
  onCaptureImage,
  onCancelCapture,
  captureStatus,
  onAddImages,
}: ReferenceComponentViewProps) {
  const { t } = useTranslation();

  return (
    <div
      className="h-full overflow-auto"
      data-testid="reference-component-content"
      style={{
        paddingBottom: `${COMPONENT_INSET * scale}px`,
        paddingTop: `${COMPONENT_INSET * scale}px`,
      }}
    >
      <div
        className="flex items-center"
        data-testid="reference-title-row"
        style={{ height: `${REFERENCE_TITLE_ROW_HEIGHT * scale}px` }}
      >
        <ImageActionButtons
          disabled={importProgress !== undefined || captureStatus !== undefined}
          onCapture={onCaptureImage ? () => onCaptureImage(component.id) : undefined}
          onImport={() => (onAddImages ?? onAddImage)(component.id)}
          scale={scale}
          variant="toolbar"
        />
        {importProgress ? (
          <div className="ml-auto flex min-w-0 items-center gap-2" role="status">
            <progress
              aria-label={t("reference.importProgress")}
              aria-valuemax={importProgress.total}
              aria-valuemin={0}
              aria-valuenow={importProgress.completed}
              className="h-2 w-24 accent-amber-500"
              max={importProgress.total}
              value={importProgress.completed}
            />
            <span className="text-xs text-stone-600 dark:text-stone-300">
              {t("reference.importProgressText", {
                completed: importProgress.completed,
                total: importProgress.total,
                failed: importProgress.failed,
              })}
            </span>
          </div>
        ) : captureStatus ? (
          <div className="ml-auto flex items-center gap-2 text-xs text-stone-600 dark:text-stone-300" role="status">
            <span>
              {captureStatus === "waiting"
                ? t("reference.captureWaiting")
                : t("reference.captureImporting")}
            </span>
            {captureStatus === "waiting" ? (
              <button
                className="rounded border border-stone-300 px-2 dark:border-stone-600"
                onClick={onCancelCapture}
                type="button"
              >
                {t("reference.cancelCapture")}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div style={{ marginBottom: `${REFERENCE_HEADER_GAP * scale}px`, marginTop: `${REFERENCE_HEADER_GAP * scale}px` }}>
        <RichTextEditor
          ariaLabel={t("reference.descriptionAria")}
          compact
          html={component.description}
          onChange={(html) => onSetDescription(component.id, html)}
          placeholder={t("reference.descriptionPlaceholder")}
        />
      </div>

      <div data-testid="reference-component-body">
        <GroupImageGrid
          enableReorder={enableReorder}
          group={component}
          hiddenImageId={hiddenImageId}
          imageSrc={imageSrc}
          onOpenImage={onOpenImage}
          onSelectImage={onSelectImage}
          selectedImageIds={selectedImageIds}
          placeholderImage={placeholderImage}
          placeholderIndex={placeholderIndex}
          placeholderSlot={placeholderSlot}
          onRemoveImage={onRemoveImage}
          onAddImages={onAddImages ?? onAddImage}
          onCaptureImage={onCaptureImage}
          imageActionsDisabled={importProgress !== undefined || captureStatus !== undefined}
          slots={slots}
          scale={scale}
        />
      </div>
    </div>
  );
}
