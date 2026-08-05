import type { ComponentFragmentPlacement } from "../../../domain/plan/canvas/engine";

interface ActiveDisplayDrag {
  type: "component" | "image";
  componentId: string;
}

function sortPlacements(placements: ComponentFragmentPlacement[]): ComponentFragmentPlacement[] {
  return [...placements].sort((left, right) => {
    if (left.pageIndex !== right.pageIndex) {
      return left.pageIndex - right.pageIndex;
    }
    if (left.rect.y !== right.rect.y) {
      return left.rect.y - right.rect.y;
    }
    if (left.rect.x !== right.rect.x) {
      return left.rect.x - right.rect.x;
    }
    return left.fragmentIndex - right.fragmentIndex;
  });
}

function shiftTrailingPlacements(
  basePlacements: ComponentFragmentPlacement[],
  previewPlacements: ComponentFragmentPlacement[],
  originPlacement: ComponentFragmentPlacement,
): ComponentFragmentPlacement[] {
  const originBaseIndex = basePlacements.findIndex((placement) => placement.fragmentId === originPlacement.fragmentId);
  if (originBaseIndex === -1) {
    return previewPlacements;
  }

  const sortedPreviewPlacements = sortPlacements(previewPlacements);
  const anchorBasePlacement = basePlacements
    .slice(originBaseIndex + 1)
    .find((placement) => sortedPreviewPlacements.some((previewPlacement) => previewPlacement.fragmentId === placement.fragmentId));

  if (!anchorBasePlacement) {
    return previewPlacements;
  }

  const previewAnchorIndex = sortedPreviewPlacements.findIndex(
    (placement) => placement.fragmentId === anchorBasePlacement.fragmentId,
  );
  if (previewAnchorIndex === -1) {
    return previewPlacements;
  }

  const pageDelta = anchorBasePlacement.pageIndex - sortedPreviewPlacements[previewAnchorIndex]!.pageIndex;
  if (pageDelta === 0) {
    return previewPlacements;
  }

  const trailingFragmentIds = new Set(
    sortedPreviewPlacements.slice(previewAnchorIndex).map((placement) => placement.fragmentId),
  );

  return previewPlacements.map((placement) =>
    trailingFragmentIds.has(placement.fragmentId)
      ? { ...placement, pageIndex: placement.pageIndex + pageDelta }
      : placement,
  );
}

export function buildDisplayPlacements(input: {
  activeDrag: ActiveDisplayDrag | null;
  basePlacements: ComponentFragmentPlacement[];
  previewPlacements: ComponentFragmentPlacement[];
  imageOriginPlacement: ComponentFragmentPlacement | null;
}): ComponentFragmentPlacement[] {
  const activeDrag = input.activeDrag;

  if (activeDrag?.type === "component") {
    return sortPlacements([
      ...input.previewPlacements.filter((placement) => placement.componentId !== activeDrag.componentId),
      ...input.basePlacements.filter((placement) => placement.componentId === activeDrag.componentId),
    ]);
  }

  if (activeDrag?.type === "image" && input.imageOriginPlacement) {
    const imageOriginPlacement = input.imageOriginPlacement;
    const previewHasOrigin = input.previewPlacements.some(
      (placement) => placement.fragmentId === imageOriginPlacement.fragmentId,
    );
    const adjustedPreviewPlacements = previewHasOrigin
      ? input.previewPlacements
      : shiftTrailingPlacements(input.basePlacements, input.previewPlacements, imageOriginPlacement);

    return sortPlacements([
      ...adjustedPreviewPlacements.filter((placement) => placement.fragmentId !== imageOriginPlacement.fragmentId),
      imageOriginPlacement,
    ]);
  }

  return input.previewPlacements;
}

export function pageCountForDisplayedPlacements(
  placements: ComponentFragmentPlacement[],
  fallbackPageCount: number,
): number {
  const highestPageIndex = placements.reduce(
    (max, placement) => Math.max(max, placement.pageIndex),
    -1,
  );

  return Math.max(fallbackPageCount, highestPageIndex + 1);
}
