/* eslint-disable react-refresh/only-export-components */
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  useDndContext,
  useDndMonitor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type PointerSensorProps,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  createImageDragSnapshot,
  deriveImageDragPreviewGroups,
  EMPTY_IMAGE_DROP_TARGET_HYSTERESIS_STATE,
  finalizeImageDrag,
  peekImageDropTargetHysteresis,
  projectImageDrag,
  resolveImageDragGroupOrder,
  resolveImageDragKeyboardTarget,
  resolveRowMajorImageDropTarget,
  startImageDragTransaction,
  updateImageDropTargetHysteresis,
  type ImageDragPreviewGroup,
  type ImageDragProjection,
  type ImageDragRevision,
  type ImageDragKeyboardCommand,
  type ImageDragTransaction,
  type ImageDropTarget,
  type ImageDropTargetHysteresisState,
  type MeasuredImageGroup,
  type MeasuredImageRow,
  type MeasuredImageTile,
  type ResolvedImageDropTarget,
  type ViewportRect,
} from "../../../domain/plan/blocknote/imageDragProjection";
import type {
  ReferenceComponent,
  ReferenceImage,
} from "../../../domain/plan/canvas/models";
import { usePrefersReducedMotion } from "../../../shared/hooks/usePrefersReducedMotion";
import {
  IMAGE_DRAG_TOKENS,
  imageDragAutoScrollVelocity,
  imageDragDropAnimation,
} from "../imageDragMotion";
import { ImageDragOverlay } from "./ImageDragOverlay";

const IMAGE_DRAGGABLE_PREFIX = "preshot-image";
const IMAGE_DROPPABLE_PREFIX = "preshot-image-drop";

export type ImageDragCancellationReason =
  | "explicit"
  | "escape"
  | "pointer-cancel"
  | "plan-revision"
  | "project-change"
  | "group-deleted"
  | "image-removed"
  | "asset-change"
  | "window-blur"
  | "visibility-hidden"
  | "unmount";

export interface ImageDragActiveMetadata {
  readonly image: ReferenceImage;
  readonly decodedSource: string | null;
  readonly sourceGroupId: string;
  readonly sourceIndex: number;
}

export interface ImageDragPlaceholderMetadata {
  readonly groupId: string;
  readonly imageId: string;
  readonly index: number;
}

export interface ImageDragControllerState {
  readonly status: "idle" | "dragging" | "landing";
  readonly transaction: ImageDragTransaction | null;
  readonly projection: ImageDragProjection | null;
  readonly previewGroups: readonly ImageDragPreviewGroup[];
  readonly active: ImageDragActiveMetadata | null;
  readonly sourceGroupId: string | null;
  readonly target: ImageDropTarget | null;
  readonly placeholder: ImageDragPlaceholderMetadata | null;
}

export interface ImageDragStartInput {
  readonly activeImageId: string;
  readonly sourceGroupId: string;
  readonly sourceIndex: number;
}

export interface ImageDragDraggableData extends ImageDragStartInput {
  readonly kind: "preshot-image";
}

export type ImageDragDroppableData =
  | {
      readonly kind: "preshot-image-group";
      readonly groupId: string;
    }
  | {
      readonly kind: "preshot-image-tile";
      readonly groupId: string;
      readonly imageId: string;
      readonly index: number;
      readonly row: number;
    };

export interface ImageDragPreviewController {
  readonly enabled: boolean;
  readonly state: ImageDragControllerState;
  readonly keyboardInstructions: string;
  start(input: ImageDragStartInput): boolean;
  project(target: ImageDropTarget | null): void;
  commit(): void;
  cancel(reason?: ImageDragCancellationReason): void;
  announceSelection(groupId: string, imageId: string, index: number): void;
  getPreviewGroup(groupId: string): ImageDragPreviewGroup | null;
  getPreviewImages(groupId: string): readonly ReferenceImage[];
  getDraggableData(
    groupId: string,
    imageId: string,
    index: number,
  ): ImageDragDraggableData;
  getGroupDroppableData(groupId: string): ImageDragDroppableData;
  getTileDroppableData(
    groupId: string,
    imageId: string,
    index: number,
    row: number,
  ): ImageDragDroppableData;
  isDestinationDuplicateSuppressed(groupId: string, imageId: string): boolean;
  isImageReady(file: string): boolean;
  isViewerSuppressed(): boolean;
}

interface ImageDragPreviewProviderProps {
  readonly children: ReactNode;
  readonly enabled?: boolean;
  readonly imageGroupOrder?: readonly string[];
  readonly imageGroups: readonly ReferenceComponent[];
  readonly imageSources: Readonly<Record<string, string>>;
  readonly onMoveImage: (
    fromGroupId: string,
    imageId: string,
    toGroupId: string,
    toIndex: number,
  ) => void;
  readonly planRevision: ImageDragRevision;
  readonly projectKey: string;
  readonly scrollContainerRef?: RefObject<HTMLElement | null>;
}

const IDLE_IMAGE_DRAG_STATE: ImageDragControllerState = Object.freeze({
  status: "idle",
  transaction: null,
  projection: null,
  previewGroups: Object.freeze([]),
  active: null,
  sourceGroupId: null,
  target: null,
  placeholder: null,
});

const KEYBOARD_INSTRUCTIONS =
  "聚焦图片后按空格键开始拖动，使用方向键移动，按空格键或回车键放下，按 Escape 键取消。";

const ImageDragPreviewContext =
  createContext<ImageDragPreviewController | null>(null);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

class PreshotPointerSensor extends PointerSensor {
  constructor(props: PointerSensorProps) {
    const event: unknown = props.event;
    const pointerType = isRecord(event) && typeof event.pointerType === "string"
      ? event.pointerType
      : "mouse";
    super({
      ...props,
      options: {
        ...props.options,
        activationConstraint:
          pointerType === "touch" || pointerType === "pen"
            ? {
                delay: IMAGE_DRAG_TOKENS.touchActivationDelayMs,
                tolerance: IMAGE_DRAG_TOKENS.touchActivationTolerance,
              }
            : {
                distance: IMAGE_DRAG_TOKENS.mouseActivationDistance,
              },
      },
    });
  }
}

function isImageDragDraggableData(
  value: unknown,
): value is ImageDragDraggableData {
  if (!isRecord(value)) return false;
  return (
    value.kind === "preshot-image" &&
    typeof value.activeImageId === "string" &&
    typeof value.sourceGroupId === "string" &&
    typeof value.sourceIndex === "number" &&
    Number.isInteger(value.sourceIndex)
  );
}

function isImageDragDroppableData(
  value: unknown,
): value is ImageDragDroppableData {
  if (!isRecord(value) || typeof value.groupId !== "string") return false;
  if (value.kind === "preshot-image-group") return true;
  return (
    value.kind === "preshot-image-tile" &&
    typeof value.imageId === "string" &&
    typeof value.index === "number" &&
    Number.isInteger(value.index) &&
    typeof value.row === "number" &&
    Number.isInteger(value.row)
  );
}

function draggableId(
  groupId: string,
  imageId: string,
): UniqueIdentifier {
  return `${IMAGE_DRAGGABLE_PREFIX}:${groupId}:${imageId}`;
}

function groupDroppableId(groupId: string): UniqueIdentifier {
  return `${IMAGE_DROPPABLE_PREFIX}:group:${groupId}`;
}

function tileDroppableId(
  groupId: string,
  imageId: string,
): UniqueIdentifier {
  return `${IMAGE_DROPPABLE_PREFIX}:tile:${groupId}:${imageId}`;
}

function viewportRect(rect: {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}): ViewportRect {
  return {
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
  };
}

function tileRows(tiles: readonly MeasuredImageTile[]): MeasuredImageRow[] {
  const sorted = [...tiles].sort(
    (left, right) =>
      left.row - right.row ||
      left.rect.left - right.rect.left ||
      left.index - right.index,
  );
  const rows = new Map<number, MeasuredImageTile[]>();
  for (const tile of sorted) {
    const rowTiles = rows.get(tile.row) ?? [];
    rowTiles.push(tile);
    rows.set(tile.row, rowTiles);
  }
  return [...rows].sort(([left], [right]) => left - right).map(([, row]) => {
    const tilesInRow = [...row].sort(
      (left, right) => left.rect.left - right.rect.left || left.index - right.index,
    );
    return {
      rect: {
        left: Math.min(...tilesInRow.map((tile) => tile.rect.left)),
        right: Math.max(...tilesInRow.map((tile) => tile.rect.right)),
        top: Math.min(...tilesInRow.map((tile) => tile.rect.top)),
        bottom: Math.max(...tilesInRow.map((tile) => tile.rect.bottom)),
      },
      tiles: tilesInRow,
    };
  });
}

function previewState(
  transaction: ImageDragTransaction,
  projection: ImageDragProjection,
  decodedSource: string | null,
): ImageDragControllerState {
  const previewGroups = deriveImageDragPreviewGroups(transaction, projection);
  const target =
    projection.kind === "projected" || projection.kind === "noop"
      ? projection.target
      : null;
  const placeholderGroup = target?.groupId ?? transaction.sourceGroupId;
  const placeholderPreview = previewGroups.find(
    (group) => group.groupId === placeholderGroup,
  );
  const placeholderIndex = placeholderPreview?.items.findIndex(
    (item) =>
      item.kind === "placeholder" &&
      item.image.id === transaction.activeImage.id,
  ) ?? -1;
  return {
    status: "dragging",
    transaction,
    projection,
    previewGroups,
    active: {
      image: transaction.activeImage,
      decodedSource,
      sourceGroupId: transaction.sourceGroupId,
      sourceIndex: transaction.sourceIndex,
    },
    sourceGroupId: transaction.sourceGroupId,
    target,
    placeholder: placeholderIndex < 0
      ? null
      : {
          groupId: placeholderGroup,
          imageId: transaction.activeImage.id,
          index: placeholderIndex,
        },
  };
}

function targetEquals(
  left: ImageDropTarget | null,
  right: ImageDropTarget | null,
): boolean {
  return left?.groupId === right?.groupId && left?.index === right?.index;
}

function keyboardCommand(event: KeyboardEvent): ImageDragKeyboardCommand | null {
  if ((event.ctrlKey || event.metaKey) && event.code === "ArrowLeft") {
    return "previous-group";
  }
  if ((event.ctrlKey || event.metaKey) && event.code === "ArrowRight") {
    return "next-group";
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.code === "ArrowLeft" || event.code === "ArrowUp") return "previous";
  if (event.code === "ArrowRight" || event.code === "ArrowDown") return "next";
  if (event.code === "Home") return "start";
  if (event.code === "End") return "end";
  return null;
}

function isPointerActivator(event: Event): event is Event & {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId: number;
} {
  const candidate = event as Event & {
    readonly clientX?: unknown;
    readonly clientY?: unknown;
    readonly pointerId?: unknown;
  };
  return (
    event.type.startsWith("pointer") &&
    typeof candidate.clientX === "number" &&
    typeof candidate.clientY === "number" &&
    typeof candidate.pointerId === "number"
  );
}

const silentAnnouncements: Announcements = {
  onDragStart: () => undefined,
  onDragOver: () => undefined,
  onDragEnd: () => undefined,
  onDragCancel: () => undefined,
};

function ImageDragAutoScroller({
  enabled,
  scrollContainerRef,
}: {
  readonly enabled: boolean;
  readonly scrollContainerRef?: RefObject<HTMLElement | null>;
}) {
  const {
    droppableContainers,
    measureDroppableContainers,
  } = useDndContext();
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const listenerDocumentRef = useRef<Document | null>(null);
  const pointerMoveListenerRef = useRef<
    ((event: PointerEvent) => void) | null
  >(null);
  const frameRef = useRef<number | null>(null);
  const lastTimestampRef = useRef<number | null>(null);
  const tickRef = useRef<FrameRequestCallback>(() => undefined);

  const detachPointerListener = useCallback(() => {
    const listenerDocument = listenerDocumentRef.current;
    const listener = pointerMoveListenerRef.current;
    if (listenerDocument && listener) {
      listenerDocument.removeEventListener("pointermove", listener, true);
    }
    listenerDocumentRef.current = null;
    pointerMoveListenerRef.current = null;
    pointerIdRef.current = null;
  }, []);

  const stop = useCallback(() => {
    detachPointerListener();
    pointerRef.current = null;
    lastTimestampRef.current = null;
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, [detachPointerListener]);

  const schedule = useCallback(() => {
    if (frameRef.current === null && pointerRef.current) {
      frameRef.current = window.requestAnimationFrame((timestamp) => {
        tickRef.current(timestamp);
      });
    }
  }, []);

  const tick = useCallback((timestamp: number) => {
    frameRef.current = null;
    const scroller = scrollContainerRef?.current;
    const point = pointerRef.current;
    if (!enabled || !scroller || !point) {
      stop();
      return;
    }
    const velocity = imageDragAutoScrollVelocity(
      point,
      scroller.getBoundingClientRect(),
    );
    if (velocity.x === 0 && velocity.y === 0) {
      lastTimestampRef.current = null;
      return;
    }
    const previousTimestamp = lastTimestampRef.current;
    const elapsed = previousTimestamp === null
      ? 1000 / 60
      : Math.min(32, Math.max(1, timestamp - previousTimestamp));
    lastTimestampRef.current = timestamp;
    const beforeLeft = scroller.scrollLeft;
    const beforeTop = scroller.scrollTop;
    scroller.scrollBy({
      behavior: "auto",
      left: velocity.x * elapsed / (1000 / 60),
      top: velocity.y * elapsed / (1000 / 60),
    });
    if (
      scroller.scrollLeft !== beforeLeft ||
      scroller.scrollTop !== beforeTop
    ) {
      measureDroppableContainers(
        droppableContainers.getEnabled().map((container) => container.id),
      );
    }
    schedule();
  }, [
    droppableContainers,
    enabled,
    measureDroppableContainers,
    schedule,
    scrollContainerRef,
    stop,
  ]);
  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  useDndMonitor({
    onDragStart(event) {
      if (!isPointerActivator(event.activatorEvent)) return;
      stop();
      pointerIdRef.current = event.activatorEvent.pointerId;
      pointerRef.current = {
        x: event.activatorEvent.clientX,
        y: event.activatorEvent.clientY,
      };
      const onPointerMove = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId !== pointerIdRef.current) return;
        pointerRef.current = {
          x: pointerEvent.clientX,
          y: pointerEvent.clientY,
        };
        schedule();
      };
      document.addEventListener("pointermove", onPointerMove, {
        capture: true,
        passive: true,
      });
      listenerDocumentRef.current = document;
      pointerMoveListenerRef.current = onPointerMove;
      schedule();
    },
    onDragCancel: stop,
    onDragEnd: stop,
  });

  useEffect(() => {
    if (!enabled) stop();
  }, [enabled, stop]);
  useEffect(() => stop, [stop]);
  return null;
}

export function ImageDragPreviewProvider({
  children,
  enabled = false,
  imageGroupOrder,
  imageGroups,
  imageSources,
  onMoveImage,
  planRevision,
  projectKey,
  scrollContainerRef,
}: ImageDragPreviewProviderProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [state, setState] = useState<ImageDragControllerState>(
    IDLE_IMAGE_DRAG_STATE,
  );
  const [announcement, setAnnouncement] = useState("");
  const stateRef = useRef(state);
  const imageGroupOrderRef = useRef(
    imageGroupOrder ?? imageGroups.map((group) => group.id),
  );
  const imageGroupsRef = useRef(imageGroups);
  const imageSourcesRef = useRef(imageSources);
  const onMoveImageRef = useRef(onMoveImage);
  const planRevisionRef = useRef(planRevision);
  const previousProjectKeyRef = useRef(projectKey);
  const projectedTargetRef = useRef<ImageDropTarget | null>(null);
  const collisionTargetRef = useRef<ResolvedImageDropTarget | null>(null);
  const hysteresisRef = useRef<ImageDropTargetHysteresisState>(
    EMPTY_IMAGE_DROP_TARGET_HYSTERESIS_STATE,
  );
  const pendingTargetRef = useRef<ImageDropTarget | null>(null);
  const pendingTargetSetRef = useRef(false);
  const projectionFrameRef = useRef<number | null>(null);
  const landingTimerRef = useRef<number | null>(null);
  const suppressViewerUntilRef = useRef(0);
  const keyboardTargetRef = useRef<ImageDropTarget | null>(null);
  const keyboardFocusProxyRef = useRef<HTMLButtonElement | null>(null);
  const keyboardFocusImageIdRef = useRef<string | null>(null);

  const announce = useCallback((message: string) => {
    setAnnouncement((current) => current === message ? current : message);
  }, []);

  const groupDescription = useCallback((
    groupId: string,
    snapshot?: ImageDragTransaction["snapshot"],
  ) => {
    const order = snapshot?.groupOrder ?? resolveImageDragGroupOrder(
      imageGroupOrderRef.current,
      imageGroupsRef.current,
    );
    const index = order.indexOf(groupId);
    const name = imageGroupsRef.current.find((group) => group.id === groupId)
      ?.name ?? groupId;
    return `第 ${Math.max(0, index) + 1} 个图片组“${name}”`;
  }, []);

  const targetAnnouncement = useCallback((
    transaction: ImageDragTransaction,
    projection: ImageDragProjection,
  ) => {
    if (projection.kind === "outside") {
      return "很抱歉，当前位置不能放置图片；继续移动，或按 Escape 键取消。";
    }
    if (projection.kind === "invalid-target") {
      return "很抱歉，该放置位置已失效；本次移动不会提交。";
    }
    return `移动预览：将放到${groupDescription(
      projection.target.groupId,
      transaction.snapshot,
    )}的第 ${projection.normalizedIndex + 1} 位。`;
  }, [groupDescription]);

  useEffect(() => {
    imageGroupOrderRef.current = imageGroupOrder ??
      imageGroups.map((group) => group.id);
    imageGroupsRef.current = imageGroups;
    imageSourcesRef.current = imageSources;
    onMoveImageRef.current = onMoveImage;
    planRevisionRef.current = planRevision;
  }, [
    imageGroupOrder,
    imageGroups,
    imageSources,
    onMoveImage,
    planRevision,
  ]);

  const keyboardCoordinateGetter = useCallback<KeyboardCoordinateGetter>(
    (event, { context, currentCoordinates }) => {
      if (event.defaultPrevented) return undefined;
      const command = keyboardCommand(event);
      const current = stateRef.current;
      if (!command || !current.transaction || !current.projection) {
        return undefined;
      }
      const result = resolveImageDragKeyboardTarget(
        current.transaction,
        current.projection,
        command,
      );
      if (result.kind === "invalid") {
        announce(
          result.reason === "group-boundary"
            ? "很抱歉，已经没有相邻的图片组。"
            : "很抱歉，已经到达当前图片组的边界。",
        );
        return undefined;
      }
      const enabledContainers = context.droppableContainers.getEnabled();
      const groupContainer = enabledContainers.find((container) => {
        const data: unknown = container.data.current;
        return (
          isImageDragDroppableData(data) &&
          data.kind === "preshot-image-group" &&
          data.groupId === result.target.groupId
        );
      });
      const groupRect = groupContainer
        ? context.droppableRects.get(groupContainer.id)
        : null;
      if (!groupRect) {
        announce("很抱歉，目标图片组当前不可用。");
        return undefined;
      }
      const tiles = enabledContainers.flatMap((container) => {
        const data: unknown = container.data.current;
        const rect = context.droppableRects.get(container.id);
        return (
            rect &&
            isImageDragDroppableData(data) &&
            data.kind === "preshot-image-tile" &&
            data.groupId === result.target.groupId
          )
          ? [{ data, rect }]
          : [];
      }).sort((left, right) => left.data.index - right.data.index);
      const next = tiles.find(
        (tile) => tile.data.index >= result.target.index,
      );
      const previous = [...tiles].reverse().find(
        (tile) => tile.data.index < result.target.index,
      );
      const x = next && previous
        ? (
            (previous.rect.left + previous.rect.right) / 2 +
            (next.rect.left + next.rect.right) / 2
          ) / 2
        : next
          ? (next.rect.left * 3 + next.rect.right) / 4
          : previous
            ? (previous.rect.left + previous.rect.right * 3) / 4
            : (groupRect.left + groupRect.right) / 2;
      const y = next
        ? (next.rect.top + next.rect.bottom) / 2
        : previous
          ? (previous.rect.top + previous.rect.bottom) / 2
          : (groupRect.top + groupRect.bottom) / 2;
      keyboardTargetRef.current = result.target;
      const collisionCenter = context.collisionRect
        ? {
            x: (context.collisionRect.left + context.collisionRect.right) / 2,
            y: (context.collisionRect.top + context.collisionRect.bottom) / 2,
          }
        : { x, y };
      return {
        x: currentCoordinates.x + x - collisionCenter.x,
        y: currentCoordinates.y + y - collisionCenter.y,
      };
    },
    [announce],
  );

  const sensors = useSensors(
    useSensor(PreshotPointerSensor, {
      activationConstraint: {
        distance: IMAGE_DRAG_TOKENS.mouseActivationDistance,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: keyboardCoordinateGetter,
      keyboardCodes: {
        start: ["Space"],
        cancel: ["Escape"],
        end: ["Space", "Enter"],
      },
    }),
  );

  const resetProjectionScheduling = useCallback(() => {
    if (projectionFrameRef.current !== null) {
      window.cancelAnimationFrame(projectionFrameRef.current);
      projectionFrameRef.current = null;
    }
    pendingTargetRef.current = null;
    pendingTargetSetRef.current = false;
    projectedTargetRef.current = null;
    collisionTargetRef.current = null;
    keyboardTargetRef.current = null;
    hysteresisRef.current = EMPTY_IMAGE_DROP_TARGET_HYSTERESIS_STATE;
  }, []);

  const clear = useCallback(() => {
    resetProjectionScheduling();
    if (landingTimerRef.current !== null) {
      window.clearTimeout(landingTimerRef.current);
      landingTimerRef.current = null;
    }
    stateRef.current = IDLE_IMAGE_DRAG_STATE;
    setState(IDLE_IMAGE_DRAG_STATE);
    const keyboardFocusImageId = keyboardFocusImageIdRef.current;
    keyboardFocusImageIdRef.current = null;
    if (keyboardFocusImageId) {
      window.requestAnimationFrame(() => {
        const frame = [...document.querySelectorAll<HTMLElement>(
          "[data-image-id]",
        )].find((candidate) =>
          candidate.dataset.imageId === keyboardFocusImageId
        );
        frame?.querySelector<HTMLElement>(
          '[data-image-drag-activator="true"]',
        )?.focus({ preventScroll: true });
      });
    }
  }, [resetProjectionScheduling]);

  const cancel = useCallback((
    reason: ImageDragCancellationReason = "explicit",
  ) => {
    const current = stateRef.current;
    if (current.transaction && current.projection) {
      finalizeImageDrag(current.transaction, current.projection, {
        action: "cancel",
        currentRevision: planRevisionRef.current,
      });
      const message = reason === "group-deleted"
        ? "图片组已被删除，本次移动已取消，布局已恢复。"
        : reason === "image-removed"
          ? "图片已被删除，本次移动已取消，布局已恢复。"
          : reason === "asset-change"
            ? "图片尺寸或解码状态已变化，本次移动已取消，布局已恢复。"
            : reason === "plan-revision" || reason === "project-change"
              ? "方案已发生变化，本次移动已取消，布局已恢复。"
              : reason === "window-blur" || reason === "visibility-hidden"
                ? "窗口已失去焦点，本次移动已取消，布局已恢复。"
                : "已取消移动，图片已恢复到原位置。";
      announce(message);
    }
    clear();
  }, [announce, clear]);

  const start = useCallback((input: ImageDragStartInput): boolean => {
    if (landingTimerRef.current !== null) {
      window.clearTimeout(landingTimerRef.current);
      landingTimerRef.current = null;
    }
    const source = imageGroupsRef.current.find(
      (group) => group.id === input.sourceGroupId,
    );
    const image = source?.images[input.sourceIndex];
    if (
      !source ||
      !image ||
      image.id !== input.activeImageId ||
      !imageSourcesRef.current[image.file] ||
      stateRef.current.status === "dragging"
    ) {
      announce("很抱歉，图片尚未解码完成，暂时不能移动。");
      return false;
    }
    resetProjectionScheduling();
    const snapshot = createImageDragSnapshot(
      planRevisionRef.current,
      imageGroupsRef.current,
      imageGroupOrderRef.current,
    );
    const transaction = startImageDragTransaction(snapshot, input);
    const projection = projectImageDrag(transaction, null);
    const next = previewState(
      transaction,
      projection,
      imageSourcesRef.current[transaction.activeImage.file] ?? null,
    );
    stateRef.current = next;
    setState(next);
    announce(
      `已拿起${groupDescription(
        input.sourceGroupId,
        snapshot,
      )}中的第 ${input.sourceIndex + 1} 张图片。${KEYBOARD_INSTRUCTIONS}`,
    );
    return true;
  }, [announce, groupDescription, resetProjectionScheduling]);

  const applyProjection = useCallback((target: ImageDropTarget | null) => {
    const current = stateRef.current;
    if (!current.transaction) return;
    if (
      !Object.is(
        current.transaction.snapshot.revision,
        planRevisionRef.current,
      )
    ) {
      cancel("plan-revision");
      return;
    }
    const projection = projectImageDrag(current.transaction, target);
    projectedTargetRef.current = target;
    const next = previewState(
      current.transaction,
      projection,
      current.active?.decodedSource ?? null,
    );
    stateRef.current = next;
    setState(next);
    announce(targetAnnouncement(current.transaction, projection));
  }, [announce, cancel, targetAnnouncement]);

  const projectKeyboardCommand = useCallback((
    command: ImageDragKeyboardCommand,
  ) => {
    const current = stateRef.current;
    if (!current.transaction || !current.projection) return;
    const result = resolveImageDragKeyboardTarget(
      current.transaction,
      current.projection,
      command,
    );
    if (result.kind === "invalid") {
      announce(
        result.reason === "group-boundary"
          ? "很抱歉，已经没有相邻的图片组。"
          : "很抱歉，已经到达当前图片组的边界。",
      );
      return;
    }
    keyboardTargetRef.current = result.target;
    applyProjection(result.target);
  }, [announce, applyProjection]);

  const project = useCallback((target: ImageDropTarget | null) => {
    const current = stateRef.current;
    if (!current.transaction) return;
    if (
      targetEquals(target, projectedTargetRef.current) ||
      (
        pendingTargetSetRef.current &&
        targetEquals(target, pendingTargetRef.current)
      )
    ) {
      return;
    }
    pendingTargetRef.current = target;
    pendingTargetSetRef.current = true;
    if (projectionFrameRef.current !== null) return;
    projectionFrameRef.current = window.requestAnimationFrame(() => {
      projectionFrameRef.current = null;
      if (!pendingTargetSetRef.current) return;
      const nextTarget = pendingTargetRef.current;
      pendingTargetSetRef.current = false;
      applyProjection(nextTarget);
    });
  }, [applyProjection]);

  const stableCollisionTarget = useCallback(() => {
    const sample = collisionTargetRef.current;
    const result = updateImageDropTargetHysteresis(
      hysteresisRef.current,
      sample,
    );
    hysteresisRef.current = result.state;
    return result.target;
  }, []);

  const projectCollisionTarget = useCallback((event?: DragMoveEvent) => {
    if (event?.activatorEvent.type.startsWith("key")) {
      project(keyboardTargetRef.current);
      return;
    }
    project(stableCollisionTarget());
  }, [project, stableCollisionTarget]);

  const commit = useCallback(() => {
    const current = stateRef.current;
    if (!current.transaction || !current.projection) return;
    const finalization = finalizeImageDrag(
      current.transaction,
      current.projection,
      {
        action: "commit",
        currentRevision: planRevisionRef.current,
      },
    );
    if (finalization.kind !== "committed") {
      announce(
        finalization.reason === "stale-snapshot"
          ? "方案已发生变化，本次移动已取消，布局已恢复。"
          : "很抱歉，当前位置不能放置图片，本次移动已取消。",
      );
      clear();
      return;
    }
    const transaction = current.transaction;
    const projection = current.projection;
    clear();
    if (!finalization.commit) {
      announce("图片位置未变化，已结束移动。");
      return;
    }
    const move = finalization.commit;
    onMoveImageRef.current(
      move.fromGroupId,
      move.imageId,
      move.toGroupId,
      move.toIndex,
    );
    announce(
      `已将图片放到${groupDescription(
        move.toGroupId,
        transaction.snapshot,
      )}的第 ${
        projection.kind === "projected"
          ? projection.normalizedIndex + 1
          : move.toIndex + 1
      } 位。`,
    );
  }, [announce, clear, groupDescription]);

  const commitWithLanding = useCallback(() => {
    const current = stateRef.current;
    if (!current.transaction || !current.projection) return;
    const finalization = finalizeImageDrag(
      current.transaction,
      current.projection,
      {
        action: "commit",
        currentRevision: planRevisionRef.current,
      },
    );
    resetProjectionScheduling();
    suppressViewerUntilRef.current = Date.now() + 500;
    if (finalization.kind !== "committed" || !finalization.commit) {
      announce(
        finalization.kind === "cancelled" &&
            finalization.reason === "stale-snapshot"
          ? "方案已发生变化，本次移动已取消，布局已恢复。"
          : finalization.kind === "committed"
            ? "图片位置未变化，已结束移动。"
            : "很抱歉，当前位置不能放置图片，本次移动已取消。",
      );
      clear();
      return;
    }
    const move = finalization.commit;
    const landingState: ImageDragControllerState = {
      ...current,
      status: "landing",
      transaction: null,
      projection: null,
      previewGroups: Object.freeze([]),
      placeholder: null,
    };
    stateRef.current = landingState;
    setState(landingState);
    onMoveImageRef.current(
      move.fromGroupId,
      move.imageId,
      move.toGroupId,
      move.toIndex,
    );
    announce(
      `已将图片放到${groupDescription(
        move.toGroupId,
        current.transaction.snapshot,
      )}的第 ${
        current.projection.kind === "projected"
          ? current.projection.normalizedIndex + 1
          : move.toIndex + 1
      } 位。`,
    );
    landingTimerRef.current = window.setTimeout(
      clear,
      IMAGE_DRAG_TOKENS.dropDurationMs,
    );
  }, [announce, clear, groupDescription, resetProjectionScheduling]);

  const collisionDetection = useMemo<CollisionDetection>(() => (input) => {
    const groupContainers = new Map<string, {
      readonly id: UniqueIdentifier;
      readonly rect: ViewportRect;
    }>();
    const tiles = new Map<string, MeasuredImageTile[]>();
    for (const container of input.droppableContainers) {
      const data: unknown = container.data.current;
      const rect = input.droppableRects.get(container.id);
      if (!rect || !isImageDragDroppableData(data)) continue;
      if (data.kind === "preshot-image-group") {
        groupContainers.set(data.groupId, {
          id: container.id,
          rect: viewportRect(rect),
        });
        continue;
      }
      const groupTiles = tiles.get(data.groupId) ?? [];
      groupTiles.push({
        imageId: data.imageId,
        index: data.index,
        row: data.row,
        rect: viewportRect(rect),
      });
      tiles.set(data.groupId, groupTiles);
    }
    const groups: MeasuredImageGroup[] = [...groupContainers].map(
      ([groupId, container]) => ({
        groupId,
        rect: container.rect,
        rows: tileRows(tiles.get(groupId) ?? []),
      }),
    );
    const point = input.pointerCoordinates ?? {
      x: (input.collisionRect.left + input.collisionRect.right) / 2,
      y: (input.collisionRect.top + input.collisionRect.bottom) / 2,
    };
    const target = resolveRowMajorImageDropTarget(groups, point);
    collisionTargetRef.current = target;
    if (!target) return [];
    const container = groupContainers.get(target.groupId);
    return container ? [{ id: container.id }] : [];
  }, []);

  const onDragStart = useCallback((event: DragStartEvent) => {
    const data: unknown = event.active.data.current;
    if (!isImageDragDraggableData(data)) return;
    const keyboard = event.activatorEvent.type.startsWith("key");
    if (!start(data)) return;
    if (keyboard) {
      keyboardFocusImageIdRef.current = data.activeImageId;
      keyboardFocusProxyRef.current?.focus({ preventScroll: true });
    }
  }, [start]);

  const onDragOver = useCallback((event: DragOverEvent) => {
    projectCollisionTarget(event);
  }, [projectCollisionTarget]);

  const onDragEnd = useCallback((event: DragEndEvent) => {
    if (event.activatorEvent.type.startsWith("key")) {
      const target = keyboardTargetRef.current;
      if (!targetEquals(target, projectedTargetRef.current)) {
        applyProjection(target);
      }
      commitWithLanding();
      return;
    }
    if (projectionFrameRef.current !== null) {
      window.cancelAnimationFrame(projectionFrameRef.current);
      projectionFrameRef.current = null;
    }
    pendingTargetRef.current = null;
    pendingTargetSetRef.current = false;
    const releaseTarget = peekImageDropTargetHysteresis(
      hysteresisRef.current,
      collisionTargetRef.current,
    );
    if (!targetEquals(releaseTarget, projectedTargetRef.current)) {
      applyProjection(releaseTarget);
    }
    commitWithLanding();
  }, [applyProjection, commitWithLanding]);

  useEffect(() => {
    const transaction = stateRef.current.transaction;
    if (!transaction) return;
    const currentGroupIds = new Set(imageGroups.map((group) => group.id));
    if (
      transaction.snapshot.groupOrder.some(
        (groupId) => !currentGroupIds.has(groupId),
      )
    ) {
      cancel("group-deleted");
      return;
    }
    const source = imageGroups.find(
      (group) => group.id === transaction.sourceGroupId,
    );
    const active = source?.images.find(
      (image) => image.id === transaction.activeImage.id,
    );
    if (!active) {
      cancel("image-removed");
      return;
    }
    const snapshotImage = transaction.activeImage;
    if (
      active.file !== snapshotImage.file ||
      active.sourceWidth !== snapshotImage.sourceWidth ||
      active.sourceHeight !== snapshotImage.sourceHeight ||
      active.aspectRatio !== snapshotImage.aspectRatio ||
      active.frameWidth !== snapshotImage.frameWidth ||
      active.frameHeight !== snapshotImage.frameHeight ||
      imageSources[active.file] !== stateRef.current.active?.decodedSource
    ) {
      cancel("asset-change");
      return;
    }
    if (!Object.is(transaction.snapshot.revision, planRevision)) {
      cancel("plan-revision");
    }
  }, [cancel, imageGroups, imageSources, planRevision]);

  useEffect(() => {
    if (previousProjectKeyRef.current !== projectKey) {
      cancel("project-change");
      previousProjectKeyRef.current = projectKey;
    }
  }, [cancel, projectKey]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (stateRef.current.status !== "dragging") return;
      const command = keyboardCommand(event);
      if (command) {
        event.preventDefault();
        event.stopPropagation();
        projectKeyboardCommand(command);
        return;
      }
      if (
        event.code === "Tab" ||
        event.code === "Enter" ||
        event.code === "Space"
      ) {
        event.preventDefault();
      }
      if (event.key === "Escape") {
        cancel("escape");
      }
    };
    const onPointerCancel = () => {
      if (stateRef.current.status === "dragging") {
        cancel("pointer-cancel");
      }
    };
    const onBlur = () => {
      if (stateRef.current.status === "dragging") cancel("window-blur");
    };
    const onVisibilityChange = () => {
      if (
        document.visibilityState === "hidden" &&
        stateRef.current.status === "dragging"
      ) {
        cancel("visibility-hidden");
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [cancel, projectKeyboardCommand]);

  useEffect(() => () => {
    resetProjectionScheduling();
    if (landingTimerRef.current !== null) {
      window.clearTimeout(landingTimerRef.current);
    }
    stateRef.current = IDLE_IMAGE_DRAG_STATE;
  }, [resetProjectionScheduling]);

  const controller = useMemo<ImageDragPreviewController>(() => ({
    enabled,
    state,
    keyboardInstructions: KEYBOARD_INSTRUCTIONS,
    start,
    project,
    commit,
    cancel,
    announceSelection(groupId, imageId, index) {
      const source = imageGroupsRef.current.find(
        (group) => group.id === groupId,
      );
      if (!source?.images.some((image) => image.id === imageId)) return;
      announce(
        `已选择${groupDescription(groupId)}中的第 ${index + 1} 张图片。`,
      );
    },
    getPreviewGroup(groupId) {
      return state.previewGroups.find((group) => group.groupId === groupId) ?? null;
    },
    getPreviewImages(groupId) {
      return state.previewGroups
        .find((group) => group.groupId === groupId)
        ?.items.map((item) => item.image) ?? [];
    },
    getDraggableData(groupId, imageId, index) {
      return {
        kind: "preshot-image",
        activeImageId: imageId,
        sourceGroupId: groupId,
        sourceIndex: index,
      };
    },
    getGroupDroppableData(groupId) {
      return { kind: "preshot-image-group", groupId };
    },
    getTileDroppableData(groupId, imageId, index, row) {
      return {
        kind: "preshot-image-tile",
        groupId,
        imageId,
        index,
        row,
      };
    },
    isDestinationDuplicateSuppressed(groupId, imageId) {
      return (
        state.status === "landing" &&
        state.active?.image.id === imageId &&
        state.target?.groupId === groupId
      );
    },
    isImageReady(file) {
      return Boolean(imageSourcesRef.current[file]);
    },
    isViewerSuppressed() {
      return Date.now() < suppressViewerUntilRef.current;
    },
  }), [
    announce,
    cancel,
    commit,
    enabled,
    groupDescription,
    project,
    start,
    state,
  ]);

  const overlay = (
    <DragOverlay
      dropAnimation={imageDragDropAnimation(prefersReducedMotion)}
      zIndex={220}
    >
      {state.active ? (
        <ImageDragOverlay
          decodedSource={state.active.decodedSource}
          image={state.active.image}
        />
      ) : null}
    </DragOverlay>
  );

  return (
    <ImageDragPreviewContext.Provider value={controller}>
      <button
        aria-label="键盘图片移动焦点"
        className="sr-only"
        data-testid="image-drag-keyboard-focus"
        ref={keyboardFocusProxyRef}
        tabIndex={-1}
        type="button"
      />
      <DndContext
        accessibility={{
          announcements: silentAnnouncements,
          screenReaderInstructions: {
            draggable: KEYBOARD_INSTRUCTIONS,
          },
        }}
        autoScroll={false}
        collisionDetection={collisionDetection}
        measuring={{
          droppable: { strategy: MeasuringStrategy.Always },
        }}
        onDragCancel={() => cancel("pointer-cancel")}
        onDragEnd={onDragEnd}
        onDragMove={projectCollisionTarget}
        onDragOver={onDragOver}
        onDragStart={onDragStart}
        sensors={sensors}
      >
        {children}
        <ImageDragAutoScroller
          enabled={state.status === "dragging"}
          scrollContainerRef={scrollContainerRef}
        />
        {typeof document === "undefined"
          ? overlay
          : createPortal(overlay, document.body)}
      </DndContext>
      <div
        aria-atomic="true"
        aria-live="polite"
        className="sr-only"
        data-testid="image-drag-announcement"
        role="status"
      >
        {announcement}
      </div>
    </ImageDragPreviewContext.Provider>
  );
}

export function useImageDragPreview(): ImageDragPreviewController {
  const controller = useContext(ImageDragPreviewContext);
  if (!controller) {
    throw new Error("Image drag preview controller is unavailable");
  }
  return controller;
}

export interface ImageDragActivatorBinding {
  readonly attributes: DraggableAttributes;
  readonly listeners: DraggableSyntheticListeners;
  readonly setNodeRef: (element: HTMLElement | null) => void;
  readonly setActivatorNodeRef: (element: HTMLElement | null) => void;
  readonly isDragging: boolean;
  readonly start: () => boolean;
  readonly cancel: () => void;
}

export function useImageDragActivator(
  groupId: string,
  imageId: string,
  index: number,
  file?: string,
): ImageDragActivatorBinding {
  const controller = useImageDragPreview();
  const data = controller.getDraggableData(groupId, imageId, index);
  const draggable = useDraggable({
    id: draggableId(groupId, imageId),
    data,
    disabled:
      !controller.enabled ||
      (file !== undefined && !controller.isImageReady(file)),
    attributes: {
      role: "button",
      roleDescription: "可拖动参考图",
      tabIndex: 0,
    },
  });
  return {
    attributes: draggable.attributes,
    listeners: draggable.listeners,
    setNodeRef: draggable.setNodeRef,
    setActivatorNodeRef: draggable.setActivatorNodeRef,
    isDragging: draggable.isDragging,
    start: () => controller.start(data),
    cancel: () => controller.cancel(),
  };
}

export function useImageGroupDroppable(groupId: string) {
  const controller = useImageDragPreview();
  return useDroppable({
    id: groupDroppableId(groupId),
    data: controller.getGroupDroppableData(groupId),
    disabled: !controller.enabled,
  });
}

export function useImageTileDroppable(
  groupId: string,
  imageId: string,
  index: number,
  row: number,
) {
  const controller = useImageDragPreview();
  return useDroppable({
    id: tileDroppableId(groupId, imageId),
    data: controller.getTileDroppableData(groupId, imageId, index, row),
    disabled: !controller.enabled,
  });
}
