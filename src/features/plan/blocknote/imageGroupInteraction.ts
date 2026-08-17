import type { CSSProperties } from "react";
import type { ReferenceImage } from "../../../domain/plan/canvas/models";

export type ResizeDirection =
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export const RESIZE_DIRECTIONS: readonly ResizeDirection[] = [
  "left",
  "right",
  "top",
  "bottom",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

export interface FramePreview {
  imageId: string;
  frameWidth: number;
  frameHeight: number;
  frameOffsetX: number;
  frameOffsetY: number;
}

export interface GroupPreview {
  x: number;
  width: number;
  height: number;
  frameOffsetY: number;
}

export interface GuideState {
  vertical?: { x: number; label: string };
  horizontal?: { y: number; label: string };
  dimension?: string;
}

export interface ResizeRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface ImageResizeCandidate {
  id: string;
  frameWidth: number;
  frameHeight: number;
  rect: ResizeRect;
}

export interface ImageResizeSnapState {
  widthKey: string | null;
  heightKey: string | null;
  verticalKey: string | null;
  horizontalKey: string | null;
}

export interface FrameResizeResult {
  preview: FramePreview;
  guide: GuideState;
  snapState: ImageResizeSnapState;
}

export interface SnapCandidate<T> {
  key: string;
  value: number;
  priority: number;
  data: T;
}

export function nearestSnap<T>(
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

export function affects(
  direction: ResizeDirection,
  edge: "left" | "right" | "top" | "bottom",
): boolean {
  return direction === edge || direction.includes(edge);
}

export function resizeCursor(direction: ResizeDirection): string {
  return direction === "left" || direction === "right"
    ? "ew-resize"
    : direction === "top" || direction === "bottom"
      ? "ns-resize"
      : direction === "top-left" || direction === "bottom-right"
        ? "nwse-resize"
        : "nesw-resize";
}

export function resizeHandleStyle(
  direction: ResizeDirection,
): CSSProperties {
  const corner = direction.includes("-");
  if (corner) {
    return {
      [direction.includes("top") ? "top" : "bottom"]: 0,
      [direction.includes("left") ? "left" : "right"]: 0,
      cursor: resizeCursor(direction),
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
        cursor: resizeCursor(direction),
        position: "absolute",
        top: 24,
        width: 20,
        zIndex: 50,
      }
    : {
        [direction]: 0,
        cursor: resizeCursor(direction),
        height: 20,
        left: 24,
        position: "absolute",
        right: 24,
        zIndex: 50,
      };
}

function resizedRect(
  startRect: ResizeRect | null,
  direction: ResizeDirection,
  frameWidth: number,
  frameHeight: number,
): ResizeRect {
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
}

export function frameResizePreview({
  start,
  startRect,
  direction,
  deltaX,
  deltaY,
  candidates,
  snapState,
  groupRect,
}: {
  start: FramePreview;
  startRect: ResizeRect | null;
  direction: ResizeDirection;
  deltaX: number;
  deltaY: number;
  candidates: readonly ImageResizeCandidate[];
  snapState: ImageResizeSnapState;
  groupRect: Pick<ResizeRect, "left" | "top"> | null;
}): FrameResizeResult {
  const horizontalResize =
    affects(direction, "left") || affects(direction, "right");
  const verticalResize =
    affects(direction, "top") || affects(direction, "bottom");
  let frameWidth = Math.max(
    32,
    start.frameWidth +
      (affects(direction, "right")
        ? deltaX
        : affects(direction, "left")
          ? -deltaX
          : 0),
  );
  let frameHeight = Math.max(
    32,
    start.frameHeight +
      (affects(direction, "bottom")
        ? deltaY
        : affects(direction, "top")
          ? -deltaY
          : 0),
  );
  const widthMatch = horizontalResize
    ? nearestSnap(
        frameWidth,
        candidates.map((candidate) => ({
          key: `width:${candidate.id}`,
          value: candidate.frameWidth,
          priority: 0,
          data: candidate,
        })),
        snapState.widthKey,
      )
    : null;
  const heightMatch = verticalResize
    ? nearestSnap(
        frameHeight,
        candidates.map((candidate) => ({
          key: `height:${candidate.id}`,
          value: candidate.frameHeight,
          priority: 0,
          data: candidate,
        })),
        snapState.heightKey,
      )
    : null;
  if (widthMatch) frameWidth = widthMatch.data.frameWidth;
  if (heightMatch) frameHeight = heightMatch.data.frameHeight;

  let activeRect = resizedRect(startRect, direction, frameWidth, frameHeight);
  let verticalMatch: ReturnType<typeof nearestSnap<{ label: string }>> = null;
  let horizontalMatch: ReturnType<typeof nearestSnap<{ label: string }>> = null;
  if (!widthMatch && horizontalResize) {
    const movingX = affects(direction, "left")
      ? activeRect.left
      : activeRect.right;
    verticalMatch = nearestSnap(
      movingX,
      candidates.flatMap((candidate) => [
        {
          key: `x:${candidate.id}:left`,
          value: candidate.rect.left,
          priority: 1,
          data: { label: "左边对齐" },
        },
        {
          key: `x:${candidate.id}:right`,
          value: candidate.rect.right,
          priority: 1,
          data: { label: "右边对齐" },
        },
        {
          key: `x:${candidate.id}:center`,
          value: (candidate.rect.left + candidate.rect.right) / 2,
          priority: 2,
          data: { label: "水平中心" },
        },
      ]),
      snapState.verticalKey,
    );
    if (verticalMatch) {
      const correction = verticalMatch.value - movingX;
      frameWidth = Math.max(
        32,
        frameWidth +
          (affects(direction, "left") ? -correction : correction),
      );
      activeRect = resizedRect(startRect, direction, frameWidth, frameHeight);
    }
  }

  if (!heightMatch && verticalResize) {
    const movingY = affects(direction, "top")
      ? activeRect.top
      : activeRect.bottom;
    horizontalMatch = nearestSnap(
      movingY,
      candidates.flatMap((candidate) => [
        {
          key: `y:${candidate.id}:top`,
          value: candidate.rect.top,
          priority: 1,
          data: { label: "上边对齐" },
        },
        {
          key: `y:${candidate.id}:bottom`,
          value: candidate.rect.bottom,
          priority: 1,
          data: { label: "下边对齐" },
        },
        {
          key: `y:${candidate.id}:center`,
          value: (candidate.rect.top + candidate.rect.bottom) / 2,
          priority: 2,
          data: { label: "垂直中心" },
        },
      ]),
      snapState.horizontalKey,
    );
    if (horizontalMatch) {
      const correction = horizontalMatch.value - movingY;
      frameHeight = Math.max(
        32,
        frameHeight +
          (affects(direction, "top") ? -correction : correction),
      );
    }
  }

  return {
    preview: {
      imageId: start.imageId,
      frameWidth,
      frameHeight,
      frameOffsetX: affects(direction, "left")
        ? start.frameOffsetX + start.frameWidth - frameWidth
        : start.frameOffsetX,
      frameOffsetY: affects(direction, "top")
        ? start.frameOffsetY + start.frameHeight - frameHeight
        : start.frameOffsetY,
    },
    guide: {
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
            ]
              .filter(Boolean)
              .join(" · "),
          }
        : {}),
    },
    snapState: {
      widthKey: widthMatch?.key ?? null,
      heightKey: heightMatch?.key ?? null,
      verticalKey: verticalMatch?.key ?? null,
      horizontalKey: horizontalMatch?.key ?? null,
    },
  };
}

export function groupResizePreview(
  initial: GroupPreview,
  direction: ResizeDirection,
  deltaX: number,
  deltaY: number,
  availableWidth: number,
): GroupPreview {
  let x = initial.x;
  let width = initial.width;
  let height = initial.height;
  let frameOffsetY = initial.frameOffsetY;
  if (affects(direction, "left")) {
    width = Math.max(120, initial.width - deltaX);
    x = initial.x + initial.width - width;
  } else if (affects(direction, "right")) {
    width = Math.max(120, initial.width + deltaX);
  }
  width = Math.min(width, availableWidth);
  x = Math.max(0, Math.min(x, Math.max(0, availableWidth - width)));
  if (affects(direction, "top")) {
    frameOffsetY = initial.frameOffsetY + deltaY;
    height = Math.max(80, initial.height - deltaY);
  } else if (affects(direction, "bottom")) {
    height = Math.max(80, initial.height + deltaY);
  }
  return { x, width, height, frameOffsetY };
}

export function imageWithPreview(
  image: ReferenceImage,
  preview: FramePreview | null,
): ReferenceImage {
  return preview?.imageId === image.id ? { ...image, ...preview } : image;
}
