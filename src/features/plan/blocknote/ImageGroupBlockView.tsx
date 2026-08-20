import { Camera, Images, Plus, Trash2 } from "lucide-react";
import {
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  DOCUMENT_IMAGE_GROUP_INSET,
  layoutDocumentImageGroupForWidth,
  type DocumentImageGroupSlot,
} from "../../../domain/plan/canvas/documentImageGroupLayout";
import { imageCropForView, imageViewCss } from "../../../domain/plan/canvas/imageView";
import type { ReferenceImage } from "../../../domain/plan/canvas/models";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { useBlockNoteEditor } from "@blocknote/react";
import { useImageGroupBlockController } from "./ImageGroupBlockContext";
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

export function ImageGroupBlockView({
  blockId,
  groupId,
}: {
  blockId: string;
  groupId: string;
}) {
  const controller = useImageGroupBlockController();
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
  const suppressViewerUntilRef = useRef(0);

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

  const displayImages = group.images.map((image) =>
    imageWithPreview(image, framePreview),
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
    Math.max(displayedGroup.height, layout.height);
  const imagesById = new Map(displayImages.map((image) => [image.id, image]));

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

  const startImageDrag = (
    image: ReferenceImage,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    controller.selectImage?.(image.id);
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;
    let targetGroupId = groupId;
    let targetIndex = group.images.findIndex((entry) => entry.id === image.id);
    const button = event.currentTarget;
    const move = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (!dragging && Math.hypot(dx, dy) < 6) return;
      dragging = true;
      button.style.translate = `${dx}px ${dy}px`;
      button.style.zIndex = "1000";
      const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
      const targetGroup = target?.closest<HTMLElement>("[data-image-group-id]");
      if (!targetGroup) return;
      targetGroupId = targetGroup.dataset.imageGroupId ?? groupId;
      const frames = Array.from(
        targetGroup.querySelectorAll<HTMLElement>("[data-image-id]"),
      ).filter((frame) => frame.dataset.imageId !== image.id);
      const before = frames.find((frame) => {
        const rect = frame.getBoundingClientRect();
        return moveEvent.clientY < rect.top + rect.height / 2 ||
          (
            moveEvent.clientY <= rect.bottom &&
            moveEvent.clientX < rect.left + rect.width / 2
          );
      });
      targetIndex = before ? frames.indexOf(before) : frames.length;
      document.querySelectorAll<HTMLElement>("[data-image-drop-target]")
        .forEach((entry) => delete entry.dataset.imageDropTarget);
      targetGroup.dataset.imageDropTarget = "true";
    };
    const cleanup = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", cancel);
      button.style.removeProperty("translate");
      button.style.removeProperty("z-index");
      document.querySelectorAll<HTMLElement>("[data-image-drop-target]")
        .forEach((target) => delete target.dataset.imageDropTarget);
    };
    const finish = () => {
      cleanup();
      if (dragging) {
        suppressViewerUntilRef.current = Date.now() + 500;
        controller.moveImage(groupId, image.id, targetGroupId, targetIndex);
      }
    };
    const cancel = () => {
      cleanup();
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
      <div
        className="preshot-blocknote-image-group bn-drag-exclude relative rounded border border-app-border bg-app-panel p-2"
        data-image-group-id={groupId}
        onPointerDown={startGroupBlockDrag}
        ref={rootRef}
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
            <button className="grid h-full w-full place-items-center rounded border border-dashed border-app-border bg-white text-xs text-app-muted" onClick={() => controller.addImages(groupId)} type="button">
              添加图片
            </button>
          ) : null}
          {layout.slots.map((slot, index) => {
            const image = imagesById.get(slot.id);
            if (!image) return null;
            const src = controller.getImageSrc(image.file);
            const selected = controller.selectedImageId === image.id;
            return (
              <div
                className={`group absolute overflow-visible rounded border bg-[#e7e8ea] ${
                  selected
                    ? "border-app-accent ring-2 ring-app-accent/40"
                    : "border-app-border"
                }`}
                data-image-id={image.id}
                data-selected={selected ? "true" : "false"}
                key={image.id}
                style={{ height: slot.height, left: slot.x, top: slot.y, width: slot.width }}
              >
                <button
                  aria-label={`选择参考图 ${index + 1}`}
                  aria-pressed={selected}
                  className="absolute inset-0 h-full w-full cursor-pointer overflow-hidden"
                  onClick={(event) => {
                    event.stopPropagation();
                    controller.selectImage?.(image.id);
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    if (Date.now() < suppressViewerUntilRef.current) return;
                    controller.openImage(groupId, image.id, image.file);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    controller.openImage(groupId, image.id, image.file);
                  }}
                  onPointerDown={(event) => startImageDrag(image, event)}
                  type="button"
                >
                  {src ? <img alt="参考图" className="absolute max-w-none" draggable={false} src={src} style={imageViewCss(imageCropForView(image))} /> : <span className="grid h-full place-items-center text-xs text-app-muted">加载中…</span>}
                </button>
                <button
                  aria-label={`删除参考图 ${index + 1}`}
                  className="absolute right-1 top-1 z-[60] grid h-[18px] w-[18px] place-items-center rounded bg-[#202329]/85 text-white opacity-0 group-hover:opacity-100 focus:opacity-100"
                  onClick={(event) => { event.stopPropagation(); setPendingDelete(image.id); }}
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
                    onPointerDown={(event) => startImageResize(image, slot, direction, event)}
                    role="separator"
                    style={resizeHandleStyle(direction)}
                    tabIndex={0}
                  />
                ))}
              </div>
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
      </div>
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
