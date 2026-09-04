import type { CSSProperties } from "react";
import {
  layoutDocumentImageGroupForWidth,
  type DocumentImageGroupLayout,
} from "../../../domain/plan/canvas/documentImageGroupLayout";
import { MIN_COMPONENT_HEIGHT } from "../../../domain/plan/canvas/models";
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

export const IMAGE_RESIZE_DIRECTIONS = RESIZE_DIRECTIONS;

export interface FramePreview {
  imageId: string;
  frameWidth: number;
  frameHeight: number;
  frameOffsetX: number;
  frameOffsetY: number;
  groupHeight?: number;
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

export interface ImageGroupFrameResizeResult extends FrameResizeResult {
  layout: DocumentImageGroupLayout;
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
  const eligibleCandidates = candidates
    .map((candidate) => ({
      ...candidate,
      distance: Math.abs(candidate.value - value),
    }))
    .filter((candidate) =>
      candidate.distance <= (candidate.key === activeKey ? 10 : 6),
    );
  if (eligibleCandidates.length === 0) return null;

  const winningPriority = Math.min(
    ...eligibleCandidates.map((candidate) => candidate.priority),
  );
  const activeCandidate = eligibleCandidates.find(
    (candidate) =>
      candidate.priority === winningPriority && candidate.key === activeKey,
  );
  if (activeCandidate) return activeCandidate;

  return eligibleCandidates.reduce<
    (SnapCandidate<T> & { distance: number }) | null
  >(
    (nearest, candidate) =>
      candidate.priority === winningPriority &&
        (nearest === null || candidate.distance < nearest.distance)
        ? candidate
        : nearest,
    null,
  );
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
      [direction.includes("top") ? "top" : "bottom"]: -10,
      [direction.includes("left") ? "left" : "right"]: -10,
      background: "transparent",
      border: 0,
      cursor: resizeCursor(direction),
      height: 28,
      position: "absolute",
      touchAction: "none",
      width: 28,
      zIndex: 50,
    };
  }
  return direction === "left" || direction === "right"
    ? {
        [direction]: 0,
        background: "transparent",
        border: 0,
        bottom: 20,
        cursor: resizeCursor(direction),
        position: "absolute",
        top: 20,
        touchAction: "none",
        width: 16,
        zIndex: 50,
      }
    : {
        [direction]: 0,
        background: "transparent",
        border: 0,
        cursor: resizeCursor(direction),
        height: 16,
        left: 20,
        position: "absolute",
        right: 20,
        touchAction: "none",
        zIndex: 50,
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
  groupRect: ResizeRect | null;
}): FrameResizeResult {
  const horizontalEdge = direction === "left" || direction === "right";
  const verticalEdge = direction === "top" || direction === "bottom";
  const corner = !horizontalEdge && !verticalEdge;
  const aspectRatio = Math.max(0.001, start.frameWidth / start.frameHeight);
  const minimumWidth = corner ? Math.max(32, 32 * aspectRatio) : 32;
  const maximumWidth = groupRect
    ? Math.max(minimumWidth, groupRect.right - groupRect.left)
    : Number.POSITIVE_INFINITY;
  if (verticalEdge) {
    const side = direction;
    const rawHeight = Math.min(
      4_096,
      Math.max(
        32,
        start.frameHeight + (side === "bottom" ? deltaY : -deltaY),
      ),
    );
    const fixedY = startRect
      ? side === "top" ? startRect.bottom : startRect.top
      : 0;
    const heightCandidates: SnapCandidate<{
      kind: "height" | "edge";
      label: string;
      guideY?: number;
    }>[] = candidates.map((candidate) => ({
      key: `height:${candidate.id}`,
      value: candidate.frameHeight,
      priority: 0,
      data: {
        kind: "height" as const,
        label: `同高 ${Math.round(candidate.frameHeight)}`,
      },
    }));
    const edgeTargets = [
      ...(groupRect
        ? [
            {
              key: "group:top",
              y: groupRect.top,
              label: "图片组上边缘",
            },
            {
              key: "group:bottom",
              y: groupRect.bottom,
              label: "图片组下边缘",
            },
          ]
        : []),
      ...candidates.flatMap((candidate) => [
        {
          key: `image:${candidate.id}:top`,
          y: candidate.rect.top,
          label: "图片上边缘",
        },
        {
          key: `image:${candidate.id}:bottom`,
          y: candidate.rect.bottom,
          label: "图片下边缘",
        },
      ]),
    ];
    for (const target of edgeTargets) {
      const targetHeight = side === "top"
        ? fixedY - target.y
        : target.y - fixedY;
      if (targetHeight < 32 || targetHeight > 4_096) continue;
      heightCandidates.push({
        key: target.key,
        value: targetHeight,
        priority: 1,
        data: {
          kind: "edge",
          label: target.label,
          guideY: target.y,
        },
      });
    }
    const activeKey = snapState.heightKey ?? snapState.horizontalKey;
    const match = nearestSnap(rawHeight, heightCandidates, activeKey);
    const frameHeight = match?.value ?? rawHeight;
    const edgeMatch = match?.data.kind === "edge" ? match : null;
    const dimensionMatch = match?.data.kind === "height" ? match : null;
    return {
      preview: {
        imageId: start.imageId,
        frameWidth: start.frameWidth,
        frameHeight,
        frameOffsetX: start.frameOffsetX,
        frameOffsetY: side === "top"
          ? start.frameOffsetY + start.frameHeight - frameHeight
          : start.frameOffsetY,
      },
      guide: {
        ...(edgeMatch?.data.guideY !== undefined && groupRect
          ? {
              horizontal: {
                y: edgeMatch.data.guideY - groupRect.top,
                label: edgeMatch.data.label,
              },
            }
          : {}),
        ...(dimensionMatch
          ? { dimension: dimensionMatch.data.label }
          : {}),
      },
      snapState: {
        widthKey: null,
        heightKey: match?.data.kind === "height" ? match.key : null,
        verticalKey: null,
        horizontalKey: match?.data.kind === "edge" ? match.key : null,
      },
    };
  }

  const side = affects(direction, "left") ? "left" : "right";
  let rawWidth: number;
  if (corner) {
    const requestedWidth =
      start.frameWidth + (side === "right" ? deltaX : -deltaX);
    const verticalSide = affects(direction, "top") ? "top" : "bottom";
    const requestedHeight =
      start.frameHeight +
      (verticalSide === "bottom" ? deltaY : -deltaY);
    const scaleX = requestedWidth / start.frameWidth;
    const scaleY = requestedHeight / start.frameHeight;
    const requestedScale =
      Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY;
    const minimumScale = minimumWidth / start.frameWidth;
    const maximumScale = maximumWidth / start.frameWidth;
    rawWidth = start.frameWidth *
      Math.min(maximumScale, Math.max(minimumScale, requestedScale));
  } else {
    rawWidth = Math.min(
      maximumWidth,
      Math.max(
        minimumWidth,
        start.frameWidth + (side === "right" ? deltaX : -deltaX),
      ),
    );
  }
  const fixedX = startRect
    ? side === "left" ? startRect.right : startRect.left
    : 0;
  const widthCandidates: SnapCandidate<{
    kind: "width" | "height" | "edge";
    label: string;
    guideX?: number;
  }>[] = [
    ...candidates.map((candidate) => ({
      key: `width:${candidate.id}`,
      value: candidate.frameWidth,
      priority: 0,
      data: {
        kind: "width" as const,
        label: `同宽 ${Math.round(candidate.frameWidth)}`,
      },
    })),
    ...(corner
      ? candidates.map((candidate) => ({
          key: `height:${candidate.id}`,
          value: candidate.frameHeight * aspectRatio,
          priority: 1,
          data: {
            kind: "height" as const,
            label: `同高 ${Math.round(candidate.frameHeight)}`,
          },
        }))
      : []),
  ];
  const edgeTargets = [
    ...(groupRect
      ? [
          {
            key: "group:left",
            x: groupRect.left,
            label: "图片组左边缘",
          },
          {
            key: "group:right",
            x: groupRect.right,
            label: "图片组右边缘",
          },
        ]
      : []),
    ...candidates.flatMap((candidate) => [
      {
        key: `image:${candidate.id}:left`,
        x: candidate.rect.left,
        label: "图片左边缘",
      },
      {
        key: `image:${candidate.id}:right`,
        x: candidate.rect.right,
        label: "图片右边缘",
      },
    ]),
  ];
  for (const target of edgeTargets) {
    const targetWidth = side === "left"
      ? fixedX - target.x
      : target.x - fixedX;
    if (targetWidth < minimumWidth || targetWidth > maximumWidth) continue;
    widthCandidates.push({
      key: target.key,
      value: targetWidth,
      priority: 2,
      data: {
        kind: "edge",
        label: target.label,
        guideX: target.x,
      },
    });
  }
  const activeKey =
    snapState.widthKey ?? snapState.heightKey ?? snapState.verticalKey;
  const match = nearestSnap(rawWidth, widthCandidates, activeKey);
  const frameWidth = match?.value ?? rawWidth;
  const frameHeight = corner
    ? frameWidth / aspectRatio
    : start.frameHeight;
  const dimensionMatch =
    match?.data.kind === "width" || match?.data.kind === "height"
      ? match
      : null;
  const edgeMatch = match?.data.kind === "edge" ? match : null;

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
      ...(edgeMatch?.data.guideX !== undefined && groupRect
        ? {
            vertical: {
              x: edgeMatch.data.guideX - groupRect.left,
              label: edgeMatch.data.label,
            },
          }
        : {}),
      ...(dimensionMatch
        ? { dimension: dimensionMatch.data.label }
        : {}),
    },
    snapState: {
      widthKey: match?.data.kind === "width" ? match.key : null,
      heightKey: match?.data.kind === "height" ? match.key : null,
      verticalKey: match?.data.kind === "edge" ? match.key : null,
      horizontalKey: null,
    },
  };
}

export function imageGroupFrameResizePreview({
  images,
  groupWidth,
  ...resize
}: Parameters<typeof frameResizePreview>[0] & {
  images: readonly ReferenceImage[];
  groupWidth: number;
}): ImageGroupFrameResizeResult {
  const result = frameResizePreview(resize);
  const previewImages = images.map((image) =>
    imageWithPreview(image, result.preview),
  );
  const layout = layoutDocumentImageGroupForWidth(previewImages, groupWidth);
  return {
    ...result,
    preview: {
      ...result.preview,
      groupHeight: Math.max(MIN_COMPONENT_HEIGHT, layout.height),
    },
    layout,
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
  if (preview?.imageId !== image.id) return image;
  return {
    ...image,
    frameWidth: preview.frameWidth,
    frameHeight: preview.frameHeight,
    frameOffsetX: preview.frameOffsetX,
    frameOffsetY: preview.frameOffsetY,
  };
}
