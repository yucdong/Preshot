import { Camera, Images, Plus, Trash2 } from "lucide-react";
import {
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { layoutDocumentImageGroup } from "../../../domain/plan/canvas/documentImageGroupLayout";
import { imageCropForView, imageViewCss } from "../../../domain/plan/canvas/imageView";
import type { ReferenceImage } from "../../../domain/plan/canvas/models";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { useImageGroupBlockController } from "./ImageGroupBlockContext";
import { isLegacyDefaultImageGroup } from "./canvasViewport";

type ResizeDirection =
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

const DIRECTIONS: readonly ResizeDirection[] = [
  "left",
  "right",
  "top",
  "bottom",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

interface FramePreview {
  imageId: string;
  frameWidth: number;
  frameHeight: number;
  frameOffsetX: number;
  frameOffsetY: number;
}

interface GroupPreview {
  x: number;
  width: number;
  height: number;
  frameOffsetY: number;
}

interface GuideState {
  vertical?: { x: number; label: string };
  horizontal?: { y: number; label: string };
  dimension?: string;
}

interface SnapCandidate<T> {
  key: string;
  value: number;
  priority: number;
  data: T;
}

function nearestSnap<T>(
  value: number,
  candidates: readonly SnapCandidate<T>[],
  activeKey: string | null,
): (SnapCandidate<T> & { distance: number }) | null {
  return candidates
    .map((candidate) => ({
      ...candidate,
      distance: Math.abs(candidate.value - value),
    }))
    .filter((candidate) =>
      candidate.distance <= (candidate.key === activeKey ? 10 : 6),
    )
    .sort((left, right) =>
      left.priority - right.priority || left.distance - right.distance,
    )[0] ?? null;
}

function affects(direction: ResizeDirection, edge: "left" | "right" | "top" | "bottom") {
  return direction === edge || direction.includes(edge);
}

function cursor(direction: ResizeDirection): string {
  return direction === "left" || direction === "right"
    ? "ew-resize"
    : direction === "top" || direction === "bottom"
      ? "ns-resize"
      : direction === "top-left" || direction === "bottom-right"
        ? "nwse-resize"
        : "nesw-resize";
}

function handleStyle(direction: ResizeDirection): React.CSSProperties {
  const corner = direction.includes("-");
  if (corner) {
    return {
      [direction.includes("top") ? "top" : "bottom"]: 0,
      [direction.includes("left") ? "left" : "right"]: 0,
      cursor: cursor(direction),
      height: 24,
      position: "absolute",
      width: 24,
      zIndex: 50,
    };
  }
  return direction === "left" || direction === "right"
    ? {
        [direction]: 0,
        bottom: 24,
        cursor: cursor(direction),
        position: "absolute",
        top: 24,
        width: 20,
        zIndex: 50,
      }
    : {
        [direction]: 0,
        cursor: cursor(direction),
        height: 20,
        left: 24,
        position: "absolute",
        right: 24,
        zIndex: 50,
      };
}

function imageWithPreview(
  image: ReferenceImage,
  preview: FramePreview | null,
): ReferenceImage {
  return preview?.imageId === image.id ? { ...image, ...preview } : image;
}

export function ImageGroupBlockView({ groupId }: { groupId: string }) {
  const controller = useImageGroupBlockController();
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
  const layout = layoutDocumentImageGroup(
    displayImages,
    constrainedWidth,
    displayedGroup.height,
  );
  const imagesById = new Map(displayImages.map((image) => [image.id, image]));

  const startImageResize = (
    image: ReferenceImage,
    direction: ResizeDirection,
    event: ReactPointerEvent<HTMLSpanElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = image.frameWidth;
    const startHeight = image.frameHeight;
    const startOffsetX = image.frameOffsetX ?? 0;
    const startOffsetY = image.frameOffsetY ?? 0;
    const frameElement = event.currentTarget.closest<HTMLElement>("[data-image-id]");
    const groupElement = rootRef.current;
    const startRect = frameElement?.getBoundingClientRect();
    const groupRect = groupElement?.getBoundingClientRect();
    const candidates = group.images
      .filter((candidate) => candidate.id !== image.id)
      .flatMap((candidate) => {
        const element = groupElement?.querySelector<HTMLElement>(
          `[data-image-id="${CSS.escape(candidate.id)}"]`,
        );
        if (!element) return [];
        const rect = element.getBoundingClientRect();
        return [{
          id: candidate.id,
          frameWidth: candidate.frameWidth,
          frameHeight: candidate.frameHeight,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          centerX: rect.left + rect.width / 2,
          centerY: rect.top + rect.height / 2,
        }];
      });
    let widthKey: string | null = null;
    let heightKey: string | null = null;
    let verticalKey: string | null = null;
    let horizontalKey: string | null = null;
    let next: FramePreview = {
      imageId: image.id,
      frameWidth: startWidth,
      frameHeight: startHeight,
      frameOffsetX: startOffsetX,
      frameOffsetY: startOffsetY,
    };

    const move = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      let frameWidth = Math.max(
        32,
        startWidth + (affects(direction, "right") ? dx : affects(direction, "left") ? -dx : 0),
      );
      let frameHeight = Math.max(
        32,
        startHeight + (affects(direction, "bottom") ? dy : affects(direction, "top") ? -dy : 0),
      );
      const widthMatch = affects(direction, "left") || affects(direction, "right")
        ? nearestSnap(
            frameWidth,
            candidates.map((candidate) => ({
              key: `width:${candidate.id}`,
              value: candidate.frameWidth,
              priority: 0,
              data: candidate,
            })),
            widthKey,
          )
        : null;
      const heightMatch = affects(direction, "top") || affects(direction, "bottom")
        ? nearestSnap(
            frameHeight,
            candidates.map((candidate) => ({
              key: `height:${candidate.id}`,
              value: candidate.frameHeight,
              priority: 0,
              data: candidate,
            })),
            heightKey,
          )
        : null;
      widthKey = widthMatch?.key ?? null;
      heightKey = heightMatch?.key ?? null;
      if (widthMatch) frameWidth = widthMatch.data.frameWidth;
      if (heightMatch) frameHeight = heightMatch.data.frameHeight;

      const screenRect = () => {
        const left = affects(direction, "left") && startRect
          ? startRect.right - frameWidth
          : startRect?.left ?? 0;
        const top = affects(direction, "top") && startRect
          ? startRect.bottom - frameHeight
          : startRect?.top ?? 0;
        return {
          left,
          right: left + frameWidth,
          top,
          bottom: top + frameHeight,
        };
      };
      let activeRect = screenRect();
      let verticalMatch: ReturnType<typeof nearestSnap<{
        label: string;
      }>> = null;
      let horizontalMatch: ReturnType<typeof nearestSnap<{
        label: string;
      }>> = null;
      if (!widthMatch && (affects(direction, "left") || affects(direction, "right"))) {
        const movingX = affects(direction, "left") ? activeRect.left : activeRect.right;
        verticalMatch = nearestSnap(
          movingX,
          candidates.flatMap((candidate) => [
            { key: `x:${candidate.id}:left`, value: candidate.left, priority: 1, data: { label: "左边对齐" } },
            { key: `x:${candidate.id}:right`, value: candidate.right, priority: 1, data: { label: "右边对齐" } },
            { key: `x:${candidate.id}:center`, value: candidate.centerX, priority: 2, data: { label: "水平中心" } },
          ]),
          verticalKey,
        );
        verticalKey = verticalMatch?.key ?? null;
        if (verticalMatch) {
          const correction = verticalMatch.value - movingX;
          frameWidth = Math.max(
            32,
            frameWidth + (affects(direction, "left") ? -correction : correction),
          );
          activeRect = screenRect();
        }
      } else {
        verticalKey = null;
      }
      if (!heightMatch && (affects(direction, "top") || affects(direction, "bottom"))) {
        const movingY = affects(direction, "top") ? activeRect.top : activeRect.bottom;
        horizontalMatch = nearestSnap(
          movingY,
          candidates.flatMap((candidate) => [
            { key: `y:${candidate.id}:top`, value: candidate.top, priority: 1, data: { label: "上边对齐" } },
            { key: `y:${candidate.id}:bottom`, value: candidate.bottom, priority: 1, data: { label: "下边对齐" } },
            { key: `y:${candidate.id}:center`, value: candidate.centerY, priority: 2, data: { label: "垂直中心" } },
          ]),
          horizontalKey,
        );
        horizontalKey = horizontalMatch?.key ?? null;
        if (horizontalMatch) {
          const correction = horizontalMatch.value - movingY;
          frameHeight = Math.max(
            32,
            frameHeight + (affects(direction, "top") ? -correction : correction),
          );
          activeRect = screenRect();
        }
      } else {
        horizontalKey = null;
      }
      next = {
        imageId: image.id,
        frameWidth,
        frameHeight,
        frameOffsetX: affects(direction, "left")
          ? startOffsetX + startWidth - frameWidth
          : startOffsetX,
        frameOffsetY: affects(direction, "top")
          ? startOffsetY + startHeight - frameHeight
          : startOffsetY,
      };
      setFramePreview(next);
      setGuide({
        ...(verticalMatch && groupRect
          ? {
              vertical: {
                x: verticalMatch.value - groupRect.left,
                label: verticalMatch.data.label,
              },
            }
          : {}),
        ...(horizontalMatch && groupRect
          ? {
              horizontal: {
                y: horizontalMatch.value - groupRect.top,
                label: horizontalMatch.data.label,
              },
            }
          : {}),
        ...(widthMatch || heightMatch
          ? {
              dimension: [
                widthMatch ? `同宽 ${Math.round(frameWidth)}` : "",
                heightMatch ? `同高 ${Math.round(frameHeight)}` : "",
              ].filter(Boolean).join(" · "),
            }
          : {}),
      });
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
      targetGroup.dataset.imageDropTarget = "true";
    };
    const finish = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", cancel);
      button.style.removeProperty("translate");
      button.style.removeProperty("z-index");
      document.querySelectorAll<HTMLElement>("[data-image-drop-target]")
        .forEach((target) => delete target.dataset.imageDropTarget);
      if (dragging) {
        controller.moveImage(groupId, image.id, targetGroupId, targetIndex);
      } else {
        controller.openImage(groupId, image.id, image.file);
      }
    };
    const cancel = () => {
      dragging = false;
      finish();
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
      let x = constrainedX;
      let width = constrainedWidth;
      let height = initial.height;
      let frameOffsetY = initial.frameOffsetY;
      if (affects(direction, "left")) {
        width = Math.max(120, constrainedWidth - dx);
        x = constrainedX + constrainedWidth - width;
      } else if (affects(direction, "right")) {
        width = Math.max(120, constrainedWidth + dx);
      }
      width = Math.min(width, availableWidth);
      x = Math.max(0, Math.min(x, Math.max(0, availableWidth - width)));
      if (affects(direction, "top")) {
        frameOffsetY = initial.frameOffsetY + dy;
        height = Math.max(80, initial.height - dy);
      } else if (affects(direction, "bottom")) {
        height = Math.max(80, initial.height + dy);
      }
      next = { x, width, height, frameOffsetY };
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

  return (
    <div
      className="preshot-blocknote-image-group-shell relative w-full min-w-0"
      contentEditable={false}
    >
      <div
        className="preshot-blocknote-image-group bn-drag-exclude relative rounded border border-app-border bg-app-panel p-2"
        data-image-group-id={groupId}
        ref={rootRef}
        style={{
          height: `${displayedGroup.height}px`,
          marginLeft: `${constrainedX}px`,
          translate: `0 ${displayedGroup.frameOffsetY ?? 0}px`,
          width: `${constrainedWidth}px`,
          maxWidth: "100%",
        }}
      >
        <div className="absolute right-0 top-[-34px] z-20 flex h-[30px] items-center gap-1 rounded border border-white/10 bg-[#202329] px-1 text-white shadow-lg">
          <span className="flex h-6 items-center gap-1 rounded bg-app-functional/20 px-2 text-[10px] font-bold text-cyan-100">
            <Images aria-hidden size={14} />图片组
          </span>
          <button aria-label="添加图片" className="grid h-6 w-6 place-items-center rounded hover:bg-white/10" onClick={() => controller.addImages(groupId)} type="button">
            <Plus aria-hidden size={14} />
          </button>
          {controller.captureImage ? (
            <button
              aria-label="截图"
              className="grid h-6 w-6 place-items-center rounded hover:bg-white/10"
              onClick={() => controller.captureImage?.(groupId)}
              type="button"
            >
              <Camera aria-hidden size={14} />
            </button>
          ) : null}
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
            return (
              <div
                className="group absolute overflow-visible rounded border border-app-border bg-[#e7e8ea]"
                data-image-id={image.id}
                key={image.id}
                style={{ height: slot.height, left: slot.x, top: slot.y, width: slot.width }}
              >
                <button
                  aria-label={`选择参考图 ${index + 1}`}
                  className="absolute inset-0 h-full w-full cursor-pointer overflow-hidden"
                  onPointerDown={(event) => startImageDrag(image, event)}
                  type="button"
                >
                  {src ? <img alt="参考图" className="absolute max-w-none" draggable={false} src={src} style={imageViewCss(imageCropForView(image))} /> : <span className="grid h-full place-items-center text-xs text-app-muted">加载中…</span>}
                </button>
                <button
                  aria-label={`删除参考图 ${index + 1}`}
                  className="absolute right-1 top-1 z-[60] grid h-[18px] w-[18px] place-items-center rounded bg-[#202329]/85 text-white opacity-0 group-hover:opacity-100 focus:opacity-100"
                  onClick={(event) => { event.stopPropagation(); setPendingDelete(image.id); }}
                  type="button"
                >
                  <Trash2 aria-hidden size={10} />
                </button>
                {DIRECTIONS.map((direction) => (
                  <span
                    aria-label={`从${direction}调整参考图 ${index + 1}`}
                    data-image-resize-edge={direction}
                    key={direction}
                    onPointerDown={(event) => startImageResize(image, direction, event)}
                    role="separator"
                    style={handleStyle(direction)}
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
        {DIRECTIONS.map((direction) => (
          <span
            aria-label={`调整图片组${direction}`}
            data-group-resize-edge={direction}
            key={direction}
            onPointerDown={(event) => startGroupResize(direction, event)}
            role="separator"
            style={handleStyle(direction)}
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
