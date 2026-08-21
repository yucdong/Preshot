import { Camera, Images, Plus, Trash2 } from "lucide-react";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  DOCUMENT_IMAGE_GROUP_INSET,
  layoutDocumentImageGroupForWidth,
  type DocumentImageGroupSlot,
} from "../../../domain/plan/canvas/documentImageGroupLayout";
import { imageCropForView, imageViewCss } from "../../../domain/plan/canvas/imageView";
import {
  MIN_COMPONENT_HEIGHT,
  type ReferenceImage,
} from "../../../domain/plan/canvas/models";
import { usePrefersReducedMotion } from "../../../shared/hooks/usePrefersReducedMotion";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { useBlockNoteEditor } from "@blocknote/react";
import {
  createImageDragMotionStyle,
  IMAGE_DRAG_TOKENS,
} from "../imageDragMotion";
import { useImageGroupBlockController } from "./ImageGroupBlockContext";
import {
  useImageDragActivator,
  useImageDragPreview,
  useImageGroupDroppable,
  useImageTileDroppable,
} from "./ImageDragPreviewContext";
import {
  EmptyImageGroupDropSlot,
  ImageDragSourcePlaceholder,
  ImageDragTargetGroup,
  ImageDragTargetInsertion,
} from "./ImageDragPresentation";
import { isLegacyDefaultImageGroup } from "./canvasViewport";
import { startBlockPointerDrag } from "./blockPointerDrag";
import type {
  PreshotBlockNoteEditor,
  PreshotEditorBlock,
} from "./blockOperations";
import {
  groupResizePreview,
  IMAGE_RESIZE_DIRECTIONS,
  imageGroupFrameResizePreview,
  imageWithPreview,
  RESIZE_DIRECTIONS,
  resizeHandleStyle,
  type FramePreview,
  type GroupPreview,
  type GuideState,
  type ImageResizeCandidate,
  type ImageResizeSnapState,
  type ResizeDirection,
} from "./imageGroupInteraction";

function imageSlotRows(
  slots: readonly DocumentImageGroupSlot[],
): ReadonlyMap<string, number> {
  const rowByY = new Map<number, number>();
  const rows = new Map<string, number>();
  for (const slot of slots) {
    let row = rowByY.get(slot.y);
    if (row === undefined) {
      row = rowByY.size;
      rowByY.set(slot.y, row);
    }
    rows.set(slot.id, row);
  }
  return rows;
}

function InteractiveImageTile({
  groupId,
  image,
  index,
  row,
  slot,
  selected,
  src,
  onDelete,
  onOpen,
  onResize,
  onSelect,
}: {
  groupId: string;
  image: ReferenceImage;
  index: number;
  row: number;
  slot: DocumentImageGroupSlot;
  selected: boolean;
  src: string | undefined;
  onDelete(): void;
  onOpen(): void;
  onResize(
    direction: ResizeDirection,
    event: ReactPointerEvent<HTMLSpanElement>,
  ): void;
  onSelect(): void;
}) {
  const drag = useImageDragPreview();
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef: setDraggableNodeRef,
  } = useImageDragActivator(groupId, image.id, index, image.file);
  const {
    setNodeRef: setDroppableNodeRef,
  } = useImageTileDroppable(groupId, image.id, index, row);
  const prefersReducedMotion = usePrefersReducedMotion();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const previousRectRef = useRef<DOMRect | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const dragging = drag.state.status === "dragging";

  const setFrameNode = useCallback((node: HTMLDivElement | null) => {
    frameRef.current = node;
    setDraggableNodeRef(node);
    setDroppableNodeRef(node);
  }, [setDraggableNodeRef, setDroppableNodeRef]);

  useLayoutEffect(() => {
    const element = frameRef.current;
    if (!element) return;
    const current = element.getBoundingClientRect();
    const previous = previousRectRef.current;
    previousRectRef.current = current;
    if (
      !dragging ||
      prefersReducedMotion ||
      !previous ||
      current.width <= 0 ||
      current.height <= 0
    ) {
      return;
    }
    const deltaX = previous.left - current.left;
    const deltaY = previous.top - current.top;
    if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return;
    element.style.transition = "none";
    element.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      element.style.transition =
        `transform ${IMAGE_DRAG_TOKENS.reflowDurationMs}ms ${IMAGE_DRAG_TOKENS.easing}, opacity ${IMAGE_DRAG_TOKENS.reflowDurationMs}ms ${IMAGE_DRAG_TOKENS.easing}`;
      element.style.transform = "translate3d(0, 0, 0)";
    });
    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [dragging, prefersReducedMotion, slot.x, slot.y]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    listeners?.onKeyDown?.(event);
    if (drag.state.status === "dragging") return;
    if (event.defaultPrevented || event.key !== "Enter") return;
    event.preventDefault();
    onOpen();
  };

  return (
    <div
      className={`group preshot-image-drag-tile absolute overflow-visible rounded border bg-[#e7e8ea] ${
        selected
          ? "border-app-accent ring-2 ring-app-accent/40"
          : "border-app-border"
      }`}
      data-image-id={image.id}
      data-image-index={index}
      data-image-row={row}
      data-selected={selected ? "true" : "false"}
      ref={setFrameNode}
      style={{
        height: slot.height,
        left: slot.x,
        top: slot.y,
        width: slot.width,
        ...createImageDragMotionStyle({
          isDragging: true,
          prefersReducedMotion,
          opacity: isDragging ? 0 : 1,
        }),
      }}
    >
      <button
        {...attributes}
        {...listeners}
        aria-label={`选择参考图 ${index + 1}`}
        aria-pressed={selected}
        className={`absolute inset-0 h-full w-full overflow-hidden ${
          src ? "cursor-grab active:cursor-grabbing" : "cursor-default"
        }`}
        data-image-drag-activator="true"
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          if (drag.isViewerSuppressed()) return;
          onOpen();
        }}
        onFocus={() => drag.announceSelection(groupId, image.id, index)}
        onKeyDown={handleKeyDown}
        ref={setActivatorNodeRef}
        type="button"
      >
        {src ? (
          <img
            alt="参考图"
            className="absolute max-w-none"
            draggable={false}
            src={src}
            style={imageViewCss(imageCropForView(image))}
          />
        ) : (
          <span className="grid h-full place-items-center text-xs text-app-muted">
            加载中…
          </span>
        )}
      </button>
      <button
        aria-label={`删除参考图 ${index + 1}`}
        className="absolute right-1 top-1 z-[60] grid h-[18px] w-[18px] place-items-center rounded bg-[#202329]/85 text-white opacity-0 group-hover:opacity-100 focus:opacity-100"
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        onPointerDown={(event) => event.stopPropagation()}
        type="button"
      >
        <Trash2 aria-hidden size={10} />
      </button>
      {IMAGE_RESIZE_DIRECTIONS.map((direction) => (
        <span
          aria-label={`从${direction}调整参考图 ${index + 1}`}
          aria-orientation="vertical"
          data-image-resize-edge={direction}
          key={direction}
          onPointerDown={(event) => onResize(direction, event)}
          role="separator"
          style={resizeHandleStyle(direction)}
          tabIndex={0}
        />
      ))}
    </div>
  );
}

export function ImageGroupBlockView({
  blockId,
  groupId,
}: {
  blockId: string;
  groupId: string;
}) {
  const controller = useImageGroupBlockController();
  const drag = useImageDragPreview();
  const groupDroppable = useImageGroupDroppable(groupId);
  const editor = useBlockNoteEditor();
  const group = useSyncExternalStore(
    controller.subscribe,
    () => controller.getGroup(groupId),
    () => controller.getGroup(groupId),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [framePreview, setFramePreview] = useState<FramePreview | null>(null);
  const [groupPreview, setGroupPreview] = useState<GroupPreview | null>(null);
  const [guide, setGuide] = useState<GuideState>({});
  const [availableWidth, setAvailableWidth] = useState(group?.width ?? 0);
  const setRootNode = useCallback((node: HTMLDivElement | null) => {
    rootRef.current = node;
    groupDroppable.setNodeRef(node);
  }, [groupDroppable]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const container = root?.closest<HTMLElement>(".bn-block-content");
    if (!container || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const width = container.clientWidth;
      if (Number.isFinite(width) && width > 0) {
        setAvailableWidth(width);
      }
    };
    const observer = new ResizeObserver(update);
    observer.observe(container);
    update();
    return () => observer.disconnect();
  }, [groupId]);

  if (!group) {
    return (
      <div
        className="bn-drag-exclude rounded border border-app-danger bg-app-danger-soft p-3 text-xs text-app-danger"
        contentEditable={false}
      >
        图片组数据缺失：{groupId}
      </div>
    );
  }

  const dragPreview = drag.state.status === "dragging"
    ? drag.getPreviewGroup(groupId)
    : null;
  const previewItems = dragPreview?.items ?? group.images.map((image) => ({
    kind: "image" as const,
    image,
  }));
  const displayImages = previewItems.map((item) =>
    imageWithPreview(item.image, framePreview),
  );
  const displayedGroup = groupPreview ?? group;
  const requestedWidth =
    !groupPreview && isLegacyDefaultImageGroup(group) && availableWidth > 0
      ? availableWidth
      : displayedGroup.width;
  const constrainedWidth = Math.max(
    1,
    Math.min(requestedWidth, availableWidth || requestedWidth),
  );
  const constrainedX = Math.max(
    0,
    Math.min(displayedGroup.x, Math.max(0, availableWidth - constrainedWidth)),
  );
  const layout = layoutDocumentImageGroupForWidth(
    displayImages,
    constrainedWidth,
  );
  const displayedHeight = framePreview?.groupHeight ??
    Math.max(MIN_COMPONENT_HEIGHT, displayedGroup.height, layout.height);
  const imagesById = new Map(displayImages.map((image) => [image.id, image]));
  const itemById = new Map(previewItems.map((item) => [item.image.id, item]));
  const rowByImageId = imageSlotRows(layout.slots);
  const committedLayout = layoutDocumentImageGroupForWidth(
    group.images,
    constrainedWidth,
  );
  const sourcePlaceholderSlot =
    drag.state.status === "dragging" &&
    drag.state.sourceGroupId === groupId &&
    drag.state.active
      ? committedLayout.slots.find(
          (slot) => slot.id === drag.state.active?.image.id,
        )
      : undefined;
  const targetActive =
    (drag.state.status === "dragging" || drag.state.status === "landing") &&
    drag.state.target?.groupId === groupId;

  const startImageResize = (
    image: ReferenceImage,
    renderedSlot: DocumentImageGroupSlot,
    direction: ResizeDirection,
    event: ReactPointerEvent<HTMLSpanElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = image.frameWidth;
    const startHeight = image.frameHeight;
    const startOffsetX = image.frameOffsetX ?? 0;
    const startOffsetY = image.frameOffsetY ?? 0;
    const frameElement = event.currentTarget.closest<HTMLElement>("[data-image-id]");
    const renderedRect = frameElement?.getBoundingClientRect();
    const zoomScale =
      renderedRect && renderedSlot.width > 0
        ? renderedRect.width / renderedSlot.width
        : 1;
    const pointerScale =
      Number.isFinite(zoomScale) && zoomScale > 0 ? zoomScale : 1;
    const naturalLayout = layoutDocumentImageGroupForWidth(
      group.images,
      constrainedWidth,
    );
    const startSlot = naturalLayout.slots.find((slot) => slot.id === image.id);
    const startRect = startSlot
      ? {
          left: startSlot.x,
          right: startSlot.x + startSlot.width,
          top: startSlot.y,
          bottom: startSlot.y + startSlot.height,
        }
      : null;
    const candidates = group.images
      .filter((candidate) => candidate.id !== image.id)
      .flatMap((candidate) => {
        const slot = naturalLayout.slots.find(
          (entry) => entry.id === candidate.id,
        );
        if (!slot) return [];
        return [{
          id: candidate.id,
          frameWidth: candidate.frameWidth,
          frameHeight: candidate.frameHeight,
          rect: {
            left: slot.x,
            right: slot.x + slot.width,
            top: slot.y,
            bottom: slot.y + slot.height,
          },
        }] satisfies ImageResizeCandidate[];
      });
    let snapState: ImageResizeSnapState = {
      widthKey: null,
      heightKey: null,
      verticalKey: null,
      horizontalKey: null,
    };
    let next: FramePreview = {
      imageId: image.id,
      frameWidth: startWidth,
      frameHeight: startHeight,
      frameOffsetX: startOffsetX,
      frameOffsetY: startOffsetY,
    };

    const move = (moveEvent: PointerEvent) => {
      const dx = (moveEvent.clientX - startX) / pointerScale;
      const result = imageGroupFrameResizePreview({
        images: group.images,
        groupWidth: constrainedWidth,
        start: {
          imageId: image.id,
          frameWidth: startWidth,
          frameHeight: startHeight,
          frameOffsetX: startOffsetX,
          frameOffsetY: startOffsetY,
        },
        startRect: startRect ?? null,
        direction,
        deltaX: dx,
        deltaY: 0,
        candidates,
        snapState,
        groupRect: {
          left: 0,
          right: Math.max(
            1,
            constrainedWidth - DOCUMENT_IMAGE_GROUP_INSET * 2,
          ),
          top: 0,
          bottom: naturalLayout.height,
        },
      });
      next = result.preview;
      snapState = result.snapState;
      setFramePreview(next);
      setGuide(result.guide);
    };
    const finish = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", cancel);
      setFramePreview(null);
      setGuide({});
      controller.setImageFrame(groupId, image.id, next);
    };
    const cancel = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", cancel);
      setFramePreview(null);
      setGuide({});
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", cancel);
  };

  const startGroupResize = (
    direction: ResizeDirection,
    event: ReactPointerEvent<HTMLSpanElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const initial = {
      x: constrainedX,
      width: constrainedWidth,
      height: group.height,
      frameOffsetY: group.frameOffsetY ?? 0,
    };
    let next = initial;
    const move = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      next = groupResizePreview(
        initial,
        direction,
        dx,
        dy,
        availableWidth,
      );
      setGroupPreview(next);
    };
    const finish = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", cancel);
      setGroupPreview(null);
      controller.resizeGroup(groupId, next);
    };
    const cancel = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", cancel);
      setGroupPreview(null);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", cancel);
  };

  const startGroupBlockDrag = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (
      target.closest(
        "button, [data-image-id], [data-image-resize-edge], [data-group-resize-edge]",
      )
    ) {
      return;
    }
    const block = editor.getBlock(blockId) as
      | PreshotEditorBlock
      | undefined;
    if (!block || block.type !== "imageGroup") return;
    startBlockPointerDrag({
      editor: editor as unknown as PreshotBlockNoteEditor,
      source: block,
      clientX: event.clientX,
      clientY: event.clientY,
    });
  };

  return (
    <div
      className="preshot-blocknote-image-group-shell relative w-full min-w-0"
      contentEditable={false}
    >
      <ImageDragTargetGroup
        active={targetActive}
        className="preshot-blocknote-image-group bn-drag-exclude relative rounded border border-app-border bg-app-panel p-2"
        data-image-group-id={groupId}
        onPointerDown={startGroupBlockDrag}
        ref={setRootNode}
        style={{
          height: `${displayedHeight}px`,
          marginLeft: `${constrainedX}px`,
          translate: `0 ${displayedGroup.frameOffsetY ?? 0}px`,
          width: `${constrainedWidth}px`,
          maxWidth: "100%",
        }}
      >
        <div className="preshot-blocknote-image-group-toolbar absolute right-0 top-[-34px] z-20 flex h-[30px] items-center gap-1 rounded border border-white/10 bg-[#202329] px-1 text-white shadow-lg">
          <span
            className="flex h-6 items-center gap-1 rounded bg-app-functional/20 px-2 text-[10px] font-bold text-cyan-100"
            title="拖动图片组"
          >
            <Images aria-hidden size={14} />图片组
          </span>
          <button aria-label="添加图片" className="grid h-6 w-6 place-items-center rounded hover:bg-white/10" onClick={() => controller.addImages(groupId)} title="插入图片" type="button">
            <Plus aria-hidden size={14} />
          </button>
          {controller.captureImage ? (
            <button
              aria-label="截图"
              className="grid h-6 w-6 place-items-center rounded hover:bg-white/10"
              onClick={() => controller.captureImage?.(groupId)}
              title="截图"
              type="button"
            >
              <Camera aria-hidden size={14} />
            </button>
          ) : null}
          <button
            aria-label="删除图片组"
            className="grid h-6 w-6 place-items-center rounded text-rose-200 hover:bg-app-danger hover:text-white"
            onClick={() => controller.removeBlock?.(blockId)}
            title="删除图片组"
            type="button"
          >
            <Trash2 aria-hidden size={14} />
          </button>
        </div>
        <div className="relative h-full overflow-hidden">
          {group.images.length === 0 ? (
            <EmptyImageGroupDropSlot
              active={targetActive}
              className="absolute inset-0"
            />
          ) : null}
          {group.images.length === 0 && drag.state.status === "idle" ? (
            <button className="grid h-full w-full place-items-center rounded border border-dashed border-app-border bg-white text-xs text-app-muted" onClick={() => controller.addImages(groupId)} type="button">
              添加图片
            </button>
          ) : null}
          {sourcePlaceholderSlot ? (
            <ImageDragSourcePlaceholder
              className="absolute z-10"
              height={sourcePlaceholderSlot.height}
              style={{
                left: sourcePlaceholderSlot.x,
                top: sourcePlaceholderSlot.y,
              }}
              width={sourcePlaceholderSlot.width}
            />
          ) : null}
          {layout.slots.map((slot) => {
            const image = imagesById.get(slot.id);
            if (!image) return null;
            const item = itemById.get(slot.id);
            const committedIndex = group.images.findIndex(
              (entry) => entry.id === image.id,
            );
            const landingSuppressed =
              drag.isDestinationDuplicateSuppressed(groupId, image.id);
            if (item?.kind === "placeholder" || landingSuppressed) {
              const Placeholder =
                targetActive
                  ? ImageDragTargetInsertion
                  : ImageDragSourcePlaceholder;
              return (
                <Placeholder
                  className="absolute z-20"
                  data-image-placeholder-id={image.id}
                  height={slot.height}
                  key={`placeholder:${image.id}`}
                  style={{ left: slot.x, top: slot.y }}
                  width={slot.width}
                />
              );
            }
            if (committedIndex < 0) return null;
            const src = controller.getImageSrc(image.file);
            const selected = controller.selectedImageId === image.id;
            return (
              <InteractiveImageTile
                groupId={groupId}
                image={image}
                index={committedIndex}
                key={image.id}
                onDelete={() => setPendingDelete(image.id)}
                onOpen={() =>
                  controller.openImage(groupId, image.id, image.file)}
                onResize={(direction, event) =>
                  startImageResize(image, slot, direction, event)}
                onSelect={() => controller.selectImage?.(image.id)}
                row={rowByImageId.get(image.id) ?? 0}
                selected={selected}
                slot={slot}
                src={src}
              />
            );
          })}
          {guide.vertical ? <div className="pointer-events-none absolute inset-y-1 z-[70] border-l border-dashed border-app-accent" style={{ left: guide.vertical.x }}><span className="absolute left-1 top-1 whitespace-nowrap rounded bg-app-accent px-1.5 py-1 text-[8px] font-bold text-white">{guide.vertical.label}</span></div> : null}
          {guide.horizontal ? <div className="pointer-events-none absolute inset-x-1 z-[70] border-t border-dashed border-app-accent" style={{ top: guide.horizontal.y }}><span className="absolute left-1 top-1 whitespace-nowrap rounded bg-app-accent px-1.5 py-1 text-[8px] font-bold text-white">{guide.horizontal.label}</span></div> : null}
          {guide.dimension ? <span className="pointer-events-none absolute bottom-2 left-1/2 z-[80] -translate-x-1/2 rounded border border-app-accent bg-white px-2 py-1 text-[8px] font-bold text-app-accent">{guide.dimension}</span> : null}
        </div>
        {RESIZE_DIRECTIONS.map((direction) => (
          <span
            aria-label={`调整图片组${direction}`}
            data-group-resize-edge={direction}
            key={direction}
            onPointerDown={(event) => startGroupResize(direction, event)}
            role="separator"
            style={resizeHandleStyle(direction)}
            tabIndex={0}
          />
        ))}
      </ImageDragTargetGroup>
      <ConfirmDialog
        cancelLabel="取消"
        confirmLabel="删除"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => { if (pendingDelete) controller.removeImage(groupId, pendingDelete); setPendingDelete(null); }}
        open={pendingDelete !== null}
        title="删除图片？"
      />
    </div>
  );
}
