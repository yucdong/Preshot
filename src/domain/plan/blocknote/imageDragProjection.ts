import {
  layoutDocumentImageGroupForWidth,
  type DocumentImageGroupLayout,
} from "../canvas/documentImageGroupLayout";
import {
  MIN_COMPONENT_HEIGHT,
  type ReferenceComponent,
  type ReferenceImage,
} from "../canvas/models";

export type ImageDragRevision = number | string;

export interface ImageDragSnapshotGroup {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly images: readonly ReferenceImage[];
}

export interface ImageDragSnapshot {
  readonly revision: ImageDragRevision;
  readonly groupOrder: readonly string[];
  readonly groups: Readonly<Record<string, ImageDragSnapshotGroup>>;
}

export interface ImageDragTransaction {
  readonly snapshot: ImageDragSnapshot;
  readonly activeImage: ReferenceImage;
  readonly sourceGroupId: string;
  readonly sourceIndex: number;
}

export interface ImageDropTarget {
  readonly groupId: string;
  /**
   * Insertion boundary in the measured, committed array. Same-group projection
   * normalizes this boundary after removing the active image.
   */
  readonly index: number;
}

export interface ImageMoveCommitArguments {
  readonly fromGroupId: string;
  readonly imageId: string;
  readonly toGroupId: string;
  readonly toIndex: number;
}

export type ImageDragProjection =
  | {
      readonly kind: "outside";
      readonly groups: ImageDragSnapshot["groups"];
    }
  | {
      readonly kind: "invalid-target";
      readonly groups: ImageDragSnapshot["groups"];
      readonly target: ImageDropTarget;
      readonly reason: string;
    }
  | {
      readonly kind: "noop";
      readonly groups: ImageDragSnapshot["groups"];
      readonly target: ImageDropTarget;
      readonly normalizedIndex: number;
    }
  | {
      readonly kind: "projected";
      readonly groups: ImageDragSnapshot["groups"];
      readonly target: ImageDropTarget;
      readonly normalizedIndex: number;
      readonly commit: ImageMoveCommitArguments;
    };

export type ImageDragPreviewItem =
  | {
      readonly kind: "image";
      readonly image: ReferenceImage;
    }
  | {
      readonly kind: "placeholder";
      readonly image: ReferenceImage;
      readonly sourceGroupId: string;
      readonly sourceIndex: number;
    };

export interface ImageDragPreviewGroup {
  readonly groupId: string;
  readonly role: "source" | "target" | "source-target" | "unchanged";
  readonly items: readonly ImageDragPreviewItem[];
  readonly layout: DocumentImageGroupLayout;
  readonly previousHeight: number;
  readonly height: number;
  readonly heightChanged: boolean;
}

export interface ViewportRect {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export interface MeasuredImageTile {
  readonly imageId: string;
  readonly index: number;
  readonly row: number;
  readonly rect: ViewportRect;
}

export interface MeasuredImageRow {
  readonly rect: ViewportRect;
  readonly tiles: readonly MeasuredImageTile[];
}

export interface MeasuredImageGroup {
  readonly groupId: string;
  readonly rect: ViewportRect;
  readonly rows: readonly MeasuredImageRow[];
}

export interface ResolvedImageDropTarget extends ImageDropTarget {
  /**
   * Distance inside the current midpoint cell. Hysteresis can accept a target
   * immediately once this reaches its release threshold.
   */
  readonly boundaryDistance: number;
}

export interface ImageDropTargetHysteresisState {
  readonly stable: ResolvedImageDropTarget | null;
  readonly pending: ResolvedImageDropTarget | null;
  readonly pendingSamples: number;
}

export interface ImageDropTargetHysteresisResult {
  readonly state: ImageDropTargetHysteresisState;
  readonly target: ResolvedImageDropTarget | null;
  readonly inDeadZone: boolean;
}

export type ImageDragKeyboardCommand =
  | "previous"
  | "next"
  | "previous-group"
  | "next-group"
  | "start"
  | "end";

export type ImageDragKeyboardTargetResult =
  | {
      readonly kind: "target";
      readonly target: ImageDropTarget;
      readonly position: number;
    }
  | {
      readonly kind: "invalid";
      readonly reason: "group-boundary" | "item-boundary";
    };

export type ImageDragFinalization =
  | {
      readonly kind: "cancelled";
      readonly reason:
        | "explicit"
        | "outside"
        | "invalid-target"
        | "stale-snapshot";
      readonly groups: ImageDragSnapshot["groups"];
    }
  | {
      readonly kind: "committed";
      readonly commit: ImageMoveCommitArguments | null;
      readonly groups: ImageDragSnapshot["groups"];
    };

type ImageGroupInput = Pick<
  ReferenceComponent,
  "id" | "width" | "height" | "images"
>;

const TARGET_RELEASE_DISTANCE = 8;

function freezeImage(image: ReferenceImage): ReferenceImage {
  return Object.freeze({
    ...image,
    ...(image.crop ? { crop: Object.freeze({ ...image.crop }) } : {}),
  });
}

function targetEquals(
  left: ImageDropTarget | null,
  right: ImageDropTarget | null,
): boolean {
  return left?.groupId === right?.groupId && left?.index === right?.index;
}

function projectedLocation(
  transaction: ImageDragTransaction,
  projection: ImageDragProjection,
): { readonly groupId: string; readonly position: number } {
  if (projection.kind === "projected" || projection.kind === "noop") {
    return {
      groupId: projection.target.groupId,
      position: projection.normalizedIndex,
    };
  }
  return {
    groupId: transaction.sourceGroupId,
    position: transaction.sourceIndex,
  };
}

function itemCountAfterSourceRemoval(
  transaction: ImageDragTransaction,
  groupId: string,
): number {
  const count = transaction.snapshot.groups[groupId]?.images.length ?? 0;
  return groupId === transaction.sourceGroupId ? Math.max(0, count - 1) : count;
}

function rawTargetIndex(
  transaction: ImageDragTransaction,
  groupId: string,
  position: number,
): number {
  return groupId === transaction.sourceGroupId &&
      position > transaction.sourceIndex
    ? position + 1
    : position;
}

export function resolveImageDragKeyboardTarget(
  transaction: ImageDragTransaction,
  projection: ImageDragProjection,
  command: ImageDragKeyboardCommand,
): ImageDragKeyboardTargetResult {
  const current = projectedLocation(transaction, projection);
  const groupIndex = transaction.snapshot.groupOrder.indexOf(current.groupId);
  if (groupIndex < 0) {
    return { kind: "invalid", reason: "group-boundary" };
  }

  if (command === "previous-group" || command === "next-group") {
    const offset = command === "previous-group" ? -1 : 1;
    const nextGroupId = transaction.snapshot.groupOrder[groupIndex + offset];
    if (!nextGroupId) {
      return { kind: "invalid", reason: "group-boundary" };
    }
    const position = Math.min(
      current.position,
      itemCountAfterSourceRemoval(transaction, nextGroupId),
    );
    return {
      kind: "target",
      target: {
        groupId: nextGroupId,
        index: rawTargetIndex(transaction, nextGroupId, position),
      },
      position,
    };
  }

  const count = itemCountAfterSourceRemoval(transaction, current.groupId);
  const requested = command === "start"
    ? 0
    : command === "end"
      ? count
      : current.position + (command === "previous" ? -1 : 1);
  if (requested < 0 || requested > count || requested === current.position) {
    return { kind: "invalid", reason: "item-boundary" };
  }
  return {
    kind: "target",
    target: {
      groupId: current.groupId,
      index: rawTargetIndex(transaction, current.groupId, requested),
    },
    position: requested,
  };
}

function rectCenterY(rect: ViewportRect): number {
  return (rect.top + rect.bottom) / 2;
}

function containsPoint(
  rect: ViewportRect,
  point: { readonly x: number; readonly y: number },
): boolean {
  return (
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom
  );
}

function containingGroup(
  groups: readonly MeasuredImageGroup[],
  point: { readonly x: number; readonly y: number },
): MeasuredImageGroup | null {
  const matches = groups.filter((group) => containsPoint(group.rect, point));
  if (matches.length === 0) return null;
  return matches.reduce((nearest, group) =>
    Math.abs(rectCenterY(group.rect) - point.y) <
        Math.abs(rectCenterY(nearest.rect) - point.y)
      ? group
      : nearest,
  );
}

function nearestRow(
  rows: readonly MeasuredImageRow[],
  y: number,
): MeasuredImageRow {
  const containing = rows.filter((row) => y >= row.rect.top && y <= row.rect.bottom);
  const candidates = containing.length > 0 ? containing : rows;
  return candidates.reduce((nearest, row) =>
    Math.abs(rectCenterY(row.rect) - y) <
        Math.abs(rectCenterY(nearest.rect) - y)
      ? row
      : nearest,
  );
}

function freezeGroups(
  groups: Record<string, ImageDragSnapshotGroup>,
): ImageDragSnapshot["groups"] {
  return Object.freeze(groups);
}

export function resolveImageDragGroupOrder(
  visibleGroupOrder: readonly string[],
  inputGroups: readonly ImageGroupInput[],
): string[] {
  const availableIds = new Set(inputGroups.map((group) => group.id));
  const seen = new Set<string>();
  const ordered = visibleGroupOrder.filter((groupId) => {
    if (!availableIds.has(groupId) || seen.has(groupId)) return false;
    seen.add(groupId);
    return true;
  });
  const compatibilityOrphans = inputGroups
    .map((group) => group.id)
    .filter((groupId) => !seen.has(groupId))
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  return [...ordered, ...compatibilityOrphans];
}

export function createImageDragSnapshot(
  revision: ImageDragRevision,
  inputGroups: readonly ImageGroupInput[],
  visibleGroupOrder: readonly string[] = inputGroups.map((group) => group.id),
): ImageDragSnapshot {
  const groups: Record<string, ImageDragSnapshotGroup> = Object.create(null) as
    Record<string, ImageDragSnapshotGroup>;
  const imageOwners = new Map<string, string>();

  for (const input of inputGroups) {
    if (groups[input.id]) {
      throw new Error(`Duplicate image-group id "${input.id}".`);
    }
    const images = input.images.map((image) => {
      const owner = imageOwners.get(image.id);
      if (owner !== undefined) {
        throw new Error(
          `Duplicate image id "${image.id}" in groups "${owner}" and "${input.id}".`,
        );
      }
      imageOwners.set(image.id, input.id);
      return freezeImage(image);
    });
    groups[input.id] = Object.freeze({
      id: input.id,
      width: input.width,
      height: input.height,
      images: Object.freeze(images),
    });
  }

  return Object.freeze({
    revision,
    groupOrder: Object.freeze(
      resolveImageDragGroupOrder(visibleGroupOrder, inputGroups),
    ),
    groups: freezeGroups(groups),
  });
}

export function startImageDragTransaction(
  snapshot: ImageDragSnapshot,
  input: {
    readonly activeImageId: string;
    readonly sourceGroupId: string;
    readonly sourceIndex: number;
  },
): ImageDragTransaction {
  const source = snapshot.groups[input.sourceGroupId];
  if (!source) {
    throw new Error(`Unknown source image group "${input.sourceGroupId}".`);
  }
  if (!Number.isInteger(input.sourceIndex) || input.sourceIndex < 0) {
    throw new Error(`Invalid source index ${input.sourceIndex}.`);
  }
  const activeImage = source.images[input.sourceIndex];
  if (!activeImage || activeImage.id !== input.activeImageId) {
    throw new Error(
      `Image "${input.activeImageId}" is not at index ${input.sourceIndex} in group "${input.sourceGroupId}".`,
    );
  }
  return Object.freeze({
    snapshot,
    activeImage,
    sourceGroupId: input.sourceGroupId,
    sourceIndex: input.sourceIndex,
  });
}

export function projectImageDrag(
  transaction: ImageDragTransaction,
  target: ImageDropTarget | null,
): ImageDragProjection {
  const { snapshot, sourceGroupId, sourceIndex, activeImage } = transaction;
  if (!target) {
    return { kind: "outside", groups: snapshot.groups };
  }
  const targetGroup = snapshot.groups[target.groupId];
  if (!targetGroup) {
    return {
      kind: "invalid-target",
      groups: snapshot.groups,
      target,
      reason: `Unknown target image group "${target.groupId}".`,
    };
  }
  const maximumIndex = targetGroup.images.length;
  if (
    !Number.isInteger(target.index) ||
    target.index < 0 ||
    target.index > maximumIndex
  ) {
    return {
      kind: "invalid-target",
      groups: snapshot.groups,
      target,
      reason: `Target index ${target.index} is outside group "${target.groupId}".`,
    };
  }

  const sameGroup = sourceGroupId === target.groupId;
  const normalizedIndex =
    sameGroup && target.index > sourceIndex ? target.index - 1 : target.index;
  if (sameGroup && normalizedIndex === sourceIndex) {
    return {
      kind: "noop",
      groups: snapshot.groups,
      target,
      normalizedIndex,
    };
  }

  const groups = Object.assign(Object.create(null), snapshot.groups) as Record<
    string,
    ImageDragSnapshotGroup
  >;
  const source = snapshot.groups[sourceGroupId]!;
  const sourceImages = source.images.filter((_, index) => index !== sourceIndex);

  if (sameGroup) {
    const images = [
      ...sourceImages.slice(0, normalizedIndex),
      activeImage,
      ...sourceImages.slice(normalizedIndex),
    ];
    groups[sourceGroupId] = Object.freeze({
      ...source,
      images: Object.freeze(images),
    });
  } else {
    const targetImages = [
      ...targetGroup.images.slice(0, normalizedIndex),
      activeImage,
      ...targetGroup.images.slice(normalizedIndex),
    ];
    groups[sourceGroupId] = Object.freeze({
      ...source,
      images: Object.freeze(sourceImages),
    });
    groups[target.groupId] = Object.freeze({
      ...targetGroup,
      images: Object.freeze(targetImages),
    });
  }

  return {
    kind: "projected",
    groups: freezeGroups(groups),
    target,
    normalizedIndex,
    commit: Object.freeze({
      fromGroupId: sourceGroupId,
      imageId: activeImage.id,
      toGroupId: target.groupId,
      toIndex: normalizedIndex,
    }),
  };
}

export function deriveImageDragPreviewGroups(
  transaction: ImageDragTransaction,
  projection: ImageDragProjection,
): readonly ImageDragPreviewGroup[] {
  const targetGroupId =
    projection.kind === "projected" || projection.kind === "noop"
      ? projection.target.groupId
      : null;
  const previewGroups = transaction.snapshot.groupOrder.map((groupId) => {
    const original = transaction.snapshot.groups[groupId]!;
    const projected = projection.groups[groupId]!;
    const source = groupId === transaction.sourceGroupId;
    const target = groupId === targetGroupId;
    const items = projected.images.map<ImageDragPreviewItem>((image) =>
      image.id === transaction.activeImage.id
        ? Object.freeze({
            kind: "placeholder",
            image,
            sourceGroupId: transaction.sourceGroupId,
            sourceIndex: transaction.sourceIndex,
          })
        : Object.freeze({ kind: "image", image }),
    );
    const layout = layoutDocumentImageGroupForWidth(
      items.map((item) => item.image),
      original.width,
    );
    const changesGroup =
      projection.kind === "projected" && (source || target);
    const height = changesGroup
      ? Math.max(original.height, MIN_COMPONENT_HEIGHT, layout.height)
      : original.height;
    return Object.freeze({
      groupId,
      role: source && target
        ? "source-target"
        : source
          ? "source"
          : target
            ? "target"
            : "unchanged",
      items: Object.freeze(items),
      layout,
      previousHeight: original.height,
      height,
      heightChanged: changesGroup && height !== original.height,
    }) satisfies ImageDragPreviewGroup;
  });
  return Object.freeze(previewGroups);
}

export function resolveRowMajorImageDropTarget(
  groups: readonly MeasuredImageGroup[],
  point: { readonly x: number; readonly y: number },
): ResolvedImageDropTarget | null {
  const group = containingGroup(groups, point);
  if (!group) return null;
  if (group.rows.length === 0) {
    return {
      groupId: group.groupId,
      index: 0,
      boundaryDistance: Number.POSITIVE_INFINITY,
    };
  }

  const row = nearestRow(group.rows, point.y);
  const tiles = [...row.tiles].sort(
    (left, right) => left.rect.left - right.rect.left || left.index - right.index,
  );
  if (tiles.length === 0) {
    return {
      groupId: group.groupId,
      index: 0,
      boundaryDistance: Number.POSITIVE_INFINITY,
    };
  }

  const midpoints = tiles.map((tile) => (tile.rect.left + tile.rect.right) / 2);
  const firstAfterPointer = midpoints.findIndex((midpoint) => point.x < midpoint);
  if (firstAfterPointer === -1) {
    return {
      groupId: group.groupId,
      index: tiles.at(-1)!.index + 1,
      boundaryDistance: Math.max(0, point.x - midpoints.at(-1)!),
    };
  }

  const upperDistance = midpoints[firstAfterPointer]! - point.x;
  const lowerDistance =
    firstAfterPointer === 0
      ? Number.POSITIVE_INFINITY
      : point.x - midpoints[firstAfterPointer - 1]!;
  return {
    groupId: group.groupId,
    index: tiles[firstAfterPointer]!.index,
    boundaryDistance: Math.max(0, Math.min(lowerDistance, upperDistance)),
  };
}

export const EMPTY_IMAGE_DROP_TARGET_HYSTERESIS_STATE:
  ImageDropTargetHysteresisState = Object.freeze({
    stable: null,
    pending: null,
    pendingSamples: 0,
  });

export function updateImageDropTargetHysteresis(
  state: ImageDropTargetHysteresisState,
  sample: ResolvedImageDropTarget | null,
): ImageDropTargetHysteresisResult {
  if (!sample) {
    return {
      state: EMPTY_IMAGE_DROP_TARGET_HYSTERESIS_STATE,
      target: null,
      inDeadZone: false,
    };
  }
  if (!state.stable || targetEquals(state.stable, sample)) {
    const nextState = Object.freeze({
      stable: sample,
      pending: null,
      pendingSamples: 0,
    });
    return { state: nextState, target: sample, inDeadZone: false };
  }
  if (sample.boundaryDistance >= TARGET_RELEASE_DISTANCE) {
    const nextState = Object.freeze({
      stable: sample,
      pending: null,
      pendingSamples: 0,
    });
    return { state: nextState, target: sample, inDeadZone: false };
  }

  const pendingSamples = targetEquals(state.pending, sample)
    ? state.pendingSamples + 1
    : 1;
  if (pendingSamples >= 2) {
    const nextState = Object.freeze({
      stable: sample,
      pending: null,
      pendingSamples: 0,
    });
    return { state: nextState, target: sample, inDeadZone: false };
  }
  const nextState = Object.freeze({
    stable: state.stable,
    pending: sample,
    pendingSamples,
  });
  return { state: nextState, target: state.stable, inDeadZone: true };
}

export function peekImageDropTargetHysteresis(
  state: ImageDropTargetHysteresisState,
  currentTarget: ResolvedImageDropTarget | null,
): ResolvedImageDropTarget | null {
  return currentTarget ? state.stable : null;
}

export function finalizeImageDrag(
  transaction: ImageDragTransaction,
  projection: ImageDragProjection,
  input: {
    readonly action: "cancel" | "commit";
    readonly currentRevision: ImageDragRevision;
  },
): ImageDragFinalization {
  if (input.action === "cancel") {
    return {
      kind: "cancelled",
      reason: "explicit",
      groups: transaction.snapshot.groups,
    };
  }
  if (!Object.is(input.currentRevision, transaction.snapshot.revision)) {
    return {
      kind: "cancelled",
      reason: "stale-snapshot",
      groups: transaction.snapshot.groups,
    };
  }
  if (projection.kind === "outside" || projection.kind === "invalid-target") {
    return {
      kind: "cancelled",
      reason: projection.kind,
      groups: transaction.snapshot.groups,
    };
  }
  if (projection.kind === "noop") {
    return {
      kind: "committed",
      commit: null,
      groups: transaction.snapshot.groups,
    };
  }
  return {
    kind: "committed",
    commit: projection.commit,
    groups: projection.groups,
  };
}
