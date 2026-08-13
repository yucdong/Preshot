import { Minus, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ReferenceComponent } from "../../../domain/plan/canvas/models";
import { cropForResizedFrame } from "../../../domain/plan/canvas/imageView";
import {
  COMPONENT_INSET,
  packReferenceFrames,
  REFERENCE_HEADER_GAP,
  REFERENCE_TITLE_ROW_HEIGHT,
  type ReferenceFlowSlot,
} from "../../../domain/plan/canvas/referenceLayout";
import type { AlignmentGuides } from "../../../domain/plan/canvas/geometry";
import { RichTextEditor } from "../RichTextEditor";
import { GroupImageGrid } from "../GroupImageGrid";
import { ImageActionButtons } from "../ImageActionButtons";
import type { ImageImportProgress } from "../imageImportProgress";
import { useNaturalHeight } from "./useNaturalHeight";
import { maximumFittingReferenceAverageHeight } from "../../../domain/plan/canvas/referenceContinuation";

const GROUP_IMAGE_HEIGHT_MINIMUM = 24;
const GROUP_IMAGE_HEIGHT_STEP = 4;
const POINTS_TO_PIXELS = 4 / 3;

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
  onSetImageFrame?: (
    componentId: string,
    imageId: string,
    frame: { frameWidth: number; frameHeight: number },
  ) => void;
  onSetImageCrop?: (
    componentId: string,
    imageId: string,
    crop: { x: number; y: number; width: number; height: number },
  ) => void;
  onMeasureDescription?: (id: string, heightPoints: number) => void;
  onScaleImages?: (componentId: string, scale: number) => void;
}

interface ImageFramePreview {
  imageId: string;
  frameWidth: number;
  frameHeight: number;
  guides: AlignmentGuides;
}

function hasIntroductionContent(html: string): boolean {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .trim().length > 0;
}

function averageFrameHeight(component: ReferenceComponent): number {
  if (component.images.length === 0) {
    return 0;
  }
  return component.images.reduce((total, image) => total + image.frameHeight, 0) /
    component.images.length;
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
  onSetImageFrame,
  onSetImageCrop,
  onMeasureDescription,
  onScaleImages,
}: ReferenceComponentViewProps) {
  const { t } = useTranslation();
  const [addingIntroduction, setAddingIntroduction] = useState(false);
  const [imageFramePreview, setImageFramePreview] =
    useState<ImageFramePreview | null>(null);
  const [measuredDescriptionHeight, setMeasuredDescriptionHeight] = useState<number | undefined>();
  const hasIntroduction = hasIntroductionContent(component.description);
  const descriptionRef = useNaturalHeight({
    id: component.id,
    scale,
    onHeight: (id, heightPoints) => {
      setMeasuredDescriptionHeight(heightPoints);
      onMeasureDescription?.(id, heightPoints);
    },
  });

  const showIntroductionEditor = hasIntroduction || addingIntroduction;
  const currentAverageHeight = averageFrameHeight(component);
  const displayAverageHeight = Math.max(
    GROUP_IMAGE_HEIGHT_MINIMUM,
    GROUP_IMAGE_HEIGHT_MINIMUM +
      Math.round((currentAverageHeight - GROUP_IMAGE_HEIGHT_MINIMUM) / GROUP_IMAGE_HEIGHT_STEP) *
        GROUP_IMAGE_HEIGHT_STEP,
  );
  const maximumAverageHeight = maximumFittingReferenceAverageHeight(component, {
    minimum: GROUP_IMAGE_HEIGHT_MINIMUM,
    step: GROUP_IMAGE_HEIGHT_STEP,
    measuredDescriptionHeight,
  });
  const currentPixels = Math.round(displayAverageHeight * POINTS_TO_PIXELS);
  const minimumPixels = Math.round(GROUP_IMAGE_HEIGHT_MINIMUM * POINTS_TO_PIXELS);
  const maximumPixels = Math.floor(maximumAverageHeight * POINTS_TO_PIXELS);
  const [sizeDraft, setSizeDraft] = useState<string | null>(null);
  const [sizeError, setSizeError] = useState("");
  const commitPixelSize = () => {
    const pixels = Number(sizeDraft ?? currentPixels);
    if (
      !Number.isInteger(pixels) ||
      pixels < minimumPixels ||
      pixels > maximumPixels ||
      currentAverageHeight <= 0
    ) {
      setSizeDraft(null);
      setSizeError(`请输入 ${minimumPixels}-${maximumPixels}px`);
      return;
    }
    setSizeError("");
    setSizeDraft(null);
    const targetPoints = pixels / POINTS_TO_PIXELS;
    onScaleImages?.(component.id, targetPoints / currentAverageHeight);
  };
  const groupPreviewComponent = component;
  const displayComponent =
    imageFramePreview === null
      ? groupPreviewComponent
      : {
          ...groupPreviewComponent,
          images: groupPreviewComponent.images.map((image) =>
            image.id === imageFramePreview.imageId
              ? {
                  ...image,
                  frameWidth: imageFramePreview.frameWidth,
                  frameHeight: imageFramePreview.frameHeight,
                  crop: cropForResizedFrame(image, imageFramePreview),
                }
              : image,
          ),
        };
  const displaySlots =
    imageFramePreview === null
      ? slots
      : packReferenceFrames({
          images: displayComponent.images,
          innerWidth: Math.max(0, displayComponent.width - COMPONENT_INSET * 2),
        });

  return (
    <div
      className="h-full min-h-0 overflow-hidden"
      data-testid="reference-component-content"
      style={{
        paddingBottom: `${COMPONENT_INSET * scale}px`,
        paddingTop: `${COMPONENT_INSET * scale}px`,
      }}
    >
      <div
        className="flex w-fit items-center rounded-lg border border-white/10 bg-[#202329] px-1 text-white shadow-[0_6px_18px_rgb(17_18_22_/_18%)]"
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
        <div
          className="ml-1 flex items-center text-white/70"
          style={{ gap: `${4 * scale}px` }}
          title={t("reference.groupImageHeight")}
        >
          <button
            aria-label={t("reference.decreaseGroupImageHeight")}
            className="flex items-center justify-center rounded border border-white/10 bg-white/[0.06] transition-[background-color,transform] duration-200 hover:bg-white/15 hover:text-white active:scale-[0.9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional disabled:cursor-not-allowed disabled:opacity-30"
            disabled={
              component.images.length === 0 ||
              onScaleImages === undefined ||
              displayAverageHeight <= GROUP_IMAGE_HEIGHT_MINIMUM
            }
            onClick={() => {
              const target = Math.max(
                GROUP_IMAGE_HEIGHT_MINIMUM,
                displayAverageHeight - GROUP_IMAGE_HEIGHT_STEP,
              );
              if (currentAverageHeight > 0) {
                onScaleImages?.(component.id, target / currentAverageHeight);
              }
            }}
            style={{ height: `${20 * scale}px`, width: `${20 * scale}px` }}
            type="button"
          >
            <Minus aria-hidden="true" style={{ height: `${12 * scale}px`, width: `${12 * scale}px` }} />
          </button>
          <label className="flex items-center rounded border border-white/10 bg-white/[0.06] px-1">
            <span className="sr-only">整体图片高度（像素）</span>
            <input
              aria-describedby={sizeError ? `${component.id}-image-size-error` : undefined}
              aria-invalid={sizeError ? "true" : undefined}
              aria-label="整体图片高度（像素）"
              className="w-14 appearance-none border-0 bg-transparent p-0 text-right text-[10px] tabular-nums text-white outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              inputMode="numeric"
              max={maximumPixels}
              min={minimumPixels}
              onBlur={commitPixelSize}
              onChange={(event) => {
                setSizeDraft(event.target.value);
                setSizeError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                  setSizeDraft(null);
                  setSizeError("");
                  event.currentTarget.blur();
                }
              }}
              type="number"
              value={sizeDraft ?? String(currentPixels)}
            />
            <span className="text-[9px] text-white/55">px</span>
          </label>
          <button
            aria-label={t("reference.increaseGroupImageHeight")}
            className="flex items-center justify-center rounded border border-white/10 bg-white/[0.06] transition-[background-color,transform] duration-200 hover:bg-white/15 hover:text-white active:scale-[0.9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional disabled:cursor-not-allowed disabled:opacity-30"
            disabled={
              component.images.length === 0 ||
              onScaleImages === undefined ||
              displayAverageHeight + GROUP_IMAGE_HEIGHT_STEP > maximumAverageHeight
            }
            onClick={() => {
              const target = Math.min(
                maximumAverageHeight,
                displayAverageHeight + GROUP_IMAGE_HEIGHT_STEP,
              );
              if (currentAverageHeight > 0) {
                onScaleImages?.(component.id, target / currentAverageHeight);
              }
            }}
            style={{ height: `${20 * scale}px`, width: `${20 * scale}px` }}
            type="button"
          >
            <Plus aria-hidden="true" style={{ height: `${12 * scale}px`, width: `${12 * scale}px` }} />
          </button>
        </div>
        {sizeError ? (
          <span
            className="ml-2 whitespace-nowrap text-[9px] text-app-danger"
            id={`${component.id}-image-size-error`}
            role="alert"
          >
            {sizeError}
          </span>
        ) : null}
        {importProgress ? (
          <div className="ml-auto flex min-w-0 items-center gap-2" role="status">
            <progress
              aria-label={t("reference.importProgress")}
              aria-valuemax={importProgress.total}
              aria-valuemin={0}
              aria-valuenow={importProgress.completed}
              className="h-2 w-24 accent-paper-primary"
              max={importProgress.total}
              value={importProgress.completed}
            />
            <span className="text-xs text-paper-muted">
              {t("reference.importProgressText", {
                completed: importProgress.completed,
                total: importProgress.total,
                failed: importProgress.failed,
              })}
            </span>
          </div>
        ) : captureStatus ? (
          <div className="ml-auto flex items-center gap-2 text-xs text-paper-muted" role="status">
            <span>
              {captureStatus === "waiting"
                ? t("reference.captureWaiting")
                : t("reference.captureImporting")}
            </span>
            {captureStatus === "waiting" ? (
              <button
                className="rounded-md border border-paper-border px-2 transition-colors hover:border-paper-primary hover:text-paper-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-primary"
                onClick={onCancelCapture}
                type="button"
              >
                {t("reference.cancelCapture")}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {showIntroductionEditor ? (
        <section
          data-testid="reference-introduction"
          style={{
            marginBottom: `${REFERENCE_HEADER_GAP * scale}px`,
            marginTop: `${REFERENCE_HEADER_GAP * scale}px`,
          }}
        >
          <div
            className="mb-1 font-medium text-paper-ink"
            style={{ fontSize: `${12 * scale}px` }}
          >
            {t("reference.introductionLabel")}
          </div>
          <RichTextEditor
            ariaLabel={t("reference.descriptionAria")}
            compact
            html={component.description}
            onChange={(html) => onSetDescription(component.id, html)}
            rootRef={descriptionRef}
            placeholder={t("reference.descriptionPlaceholder")}
          />
        </section>
      ) : (
        <button
          aria-label={t("reference.addIntroduction")}
          className="my-1 rounded-md border border-dashed border-paper-border px-2 py-1 text-xs text-paper-muted transition-colors hover:border-paper-primary hover:bg-paper-primary-soft hover:text-paper-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-primary"
          onClick={() => setAddingIntroduction(true)}
          type="button"
        >
          {t("reference.addIntroduction")}
        </button>
      )}

      <div data-testid="reference-component-body">
        <GroupImageGrid
          enableReorder={enableReorder}
          group={displayComponent}
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
          imageGuides={imageFramePreview?.guides}
          onResizeCancel={() => setImageFramePreview(null)}
          onResizeFrame={(componentId, imageId, frame) => {
            setImageFramePreview(null);
            onSetImageFrame?.(componentId, imageId, frame);
          }}
          onSetCrop={onSetImageCrop}
          onResizePreview={(imageId, frame, guides) => {
            setImageFramePreview({
              imageId,
              frameWidth: frame.frameWidth,
              frameHeight: frame.frameHeight,
              guides,
            });
            return frame;
          }}
          slots={displaySlots}
          scale={scale}
        />
      </div>
    </div>
  );
}
