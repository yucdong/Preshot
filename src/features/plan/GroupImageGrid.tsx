import { useDroppable } from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext } from "@dnd-kit/sortable";
import { useTranslation } from "react-i18next";
import { imageGroupDroppableId } from "./canvas/imageDropTarget";
import type { ReferenceFlowSlot } from "../../domain/plan/canvas/referenceLayout";
import type {
  AlignmentGuides,
  Rect,
} from "../../domain/plan/canvas/geometry";
import type { NormalizedImageCrop } from "../../domain/plan/canvas/imageView";
import { SortableImageTile } from "./SortableImageTile";
import { ImageActionButtons } from "./ImageActionButtons";

// Minimal shape that both v1 ReferenceGroup and v2+ ReferenceComponent satisfy
interface GroupLike {
  id: string;
  images: Array<{
    id: string;
    file: string;
    aspectRatio?: number;
    frameWidth?: number;
    frameHeight?: number;
    crop?: NormalizedImageCrop;
  }>;
}

interface GroupImageGridProps {
  group: GroupLike;
  imageSrc(file: string): string | undefined;
  onRemoveImage(groupId: string, imageId: string): void;
  onOpenImage(file: string): void;
  onSelectImage?: (imageId: string, toggle: boolean) => void;
  selectedImageIds?: ReadonlySet<string>;
  droppableId?: string;
  fragmentId?: string;
  enableReorder?: boolean;
  slots: ReferenceFlowSlot[];
  scale: number;
  hiddenImageId?: string;
  placeholderImage?: { id: string; file: string; caption?: string };
  placeholderSlot?: ReferenceFlowSlot;
  placeholderIndex?: number;
  onAddImages?: (componentId: string) => void;
  onCaptureImage?: (componentId: string) => void;
  imageActionsDisabled?: boolean;
  onResizeFrame?: (
    componentId: string,
    imageId: string,
    frame: { frameWidth: number; frameHeight: number },
  ) => void;
  onResizePreview?: (
    imageId: string,
    frame: { frameWidth: number; frameHeight: number },
    guides: AlignmentGuides,
  ) => { frameWidth: number; frameHeight: number } | undefined;
  onResizeCancel?: () => void;
  onSetCrop?: (
    componentId: string,
    imageId: string,
    crop: NormalizedImageCrop,
  ) => void;
  imageGuides?: AlignmentGuides;
}

export function GroupImageGrid({ 
  group, 
  imageSrc, 
  onRemoveImage, 
  onOpenImage, 
  onSelectImage = () => undefined,
  selectedImageIds = new Set<string>(),
  droppableId, 
  fragmentId,
  enableReorder = false, 
  slots,
  scale,
  hiddenImageId,
  placeholderImage,
  placeholderSlot,
  placeholderIndex,
  onAddImages,
  onCaptureImage,
  imageActionsDisabled = false,
  onResizeFrame,
  onResizePreview,
  onResizeCancel,
  onSetCrop,
  imageGuides,
}: GroupImageGridProps) {
  const { t } = useTranslation();
  const actualDroppableId = enableReorder ? imageGroupDroppableId(group.id, fragmentId) : (droppableId ?? `droppable-${group.id}`);
  const { setNodeRef } = useDroppable({ 
    id: actualDroppableId,
    data: enableReorder ? { type: "imagegroup", componentId: group.id, fragmentId } : undefined
  });
  const imagesById = new Map(group.images.map((image) => [image.id, image]));
  const topOffset = slots.length ? Math.min(...slots.map((slot) => slot.y)) : 0;
  const normalizedSlots = slots.map((slot) => ({
    ...slot,
    y: slot.y - topOffset,
  }));

  // Bottom of content is the maximum of all slot bottoms (handles differing aspect-ratio heights)
  const contentBottom = [
    ...normalizedSlots.map((slot) => slot.y + slot.height),
    placeholderSlot ? placeholderSlot.y - topOffset + placeholderSlot.height : 0,
  ].reduce((max, value) => Math.max(max, value), 0);
  const containerHeight = Math.ceil(contentBottom * scale);
  const displayHeight = Math.max(
    containerHeight,
    group.images.length === 0 ? 48 * scale : 0,
  );
  const normalizedPlaceholderSlot =
    placeholderSlot == null
      ? undefined
      : {
          ...placeholderSlot,
          y: placeholderSlot.y - topOffset,
        };
  const visibleImageIds = normalizedSlots
    .filter((slot) => slot.kind === "image" && slot.id !== hiddenImageId)
    .map((slot) => slot.id);
  const sortableIds =
    normalizedPlaceholderSlot && placeholderImage && !visibleImageIds.includes(placeholderImage.id)
      ? [...visibleImageIds, placeholderImage.id]
      : visibleImageIds;

  const gridContent = (
    <>
      {normalizedSlots.map((slot, index) => {
        if (slot.kind === "add") {
          return (
            <div
              className="group absolute overflow-hidden rounded-md border border-dashed border-[#bfc2c8] bg-[#fafafa] transition-colors hover:border-paper-primary"
              data-testid="image-add-slot"
              key={`${slot.id}:${slot.x}:${slot.y}`}
              style={{
                height: `${slot.height * scale}px`,
                left: `${slot.x * scale}px`,
                top: `${slot.y * scale}px`,
                width: `${slot.width * scale}px`,
              }}
            >
              <ImageActionButtons
                disabled={imageActionsDisabled}
                onCapture={
                  onCaptureImage ? () => onCaptureImage(group.id) : undefined
                }
                onImport={
                  onAddImages ? () => onAddImages(group.id) : undefined
                }
                scale={scale}
                variant="slot"
              />
            </div>
          );
        }

        if (slot.id === hiddenImageId) {
          return null;
        }

        const image = imagesById.get(slot.id);
        if (!image) {
          return null;
        }

        return (
          <SortableImageTile
            componentId={group.id}
            image={image}
            index={index}
            key={image.id}
            onOpen={onOpenImage}
            onRemove={(imageId) => onRemoveImage(group.id, imageId)}
            onSelect={onSelectImage}
            selected={selectedImageIds.has(image.id)}
            src={imageSrc(image.file)}
            draggable={enableReorder}
            onResizeCancel={onResizeCancel}
            onResizeFrame={
              onResizeFrame
                ? (imageId, frame) => onResizeFrame(group.id, imageId, frame)
                : undefined
            }
            onResizePreview={onResizePreview}
            onSetCrop={onSetCrop ? (imageId, crop) => onSetCrop(group.id, imageId, crop) : undefined}
            snapCandidates={normalizedSlots
              .filter(
                (candidate) =>
                  candidate.kind === "image" && candidate.id !== image.id,
              )
              .map(
                (candidate): Rect => ({
                  x: candidate.x,
                  y: candidate.y,
                  width: candidate.width,
                  height: candidate.height,
                }),
              )}
            slot={slot}
            scale={scale}
          />
        );

      })}
      {normalizedPlaceholderSlot && placeholderImage ? (
        <SortableImageTile
          componentId={group.id}
          image={placeholderImage}
          index={placeholderIndex ?? 0}
          key={`placeholder:${placeholderImage.id}:${fragmentId ?? group.id}`}
          onOpen={onOpenImage}
          onRemove={(imageId) => onRemoveImage(group.id, imageId)}
          onSelect={onSelectImage}
          selected={selectedImageIds.has(placeholderImage.id)}
          src={imageSrc(placeholderImage.file)}
          draggable={enableReorder}
          isPlaceholder
          slot={normalizedPlaceholderSlot}
          scale={scale}
        />
      ) : null}
      {imageGuides?.vertical != null ? (
        <div
          className="pointer-events-none absolute z-20 w-px bg-paper-primary/80"
          data-testid="image-alignment-guide-vertical"
          style={{
            height: `${displayHeight}px`,
            left: `${imageGuides.vertical * scale}px`,
            top: "0px",
          }}
        />
      ) : null}
      {imageGuides?.horizontal != null ? (
        <div
          className="pointer-events-none absolute z-20 h-px bg-paper-primary/80"
          data-testid="image-alignment-guide-horizontal"
          style={{
            left: "0px",
            top: `${imageGuides.horizontal * scale}px`,
            width: "100%",
          }}
        />
      ) : null}
    </>
  );

  const emptyDropZone = group.images.length === 0 ? (
    <div
      aria-label={t("reference.emptyDropTarget")}
      className="absolute inset-0 flex items-center justify-center rounded-md border border-dashed border-[#bfc2c8] bg-[#fafafa] text-xs text-paper-muted"
    >
      {t("reference.emptyDropTarget")}
    </div>
  ) : null;

  if (enableReorder) {
    return (
      <div
        className="relative"
        data-component-id={group.id}
        data-image-group-droppable-id={actualDroppableId}
        ref={setNodeRef}
        style={{ height: `${displayHeight}px` }}
      >
        {emptyDropZone}
        <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
          {gridContent}
        </SortableContext>
      </div>
    );
  }

  return (
    <div
      className="relative"
      style={{ height: `${displayHeight}px` }}
    >
      {emptyDropZone}
      {gridContent}
    </div>
  );
}
