import { contentSize, A4, DEFAULT_PAGE_GEOMETRY } from "../../../domain/plan/canvas/geometry";
import { PAGE_SCREEN_GAP } from "./PagedCanvasSurface";
import { useEffect, useRef } from "react";

export interface PlanMeasurement {
  heightPoints: number;
  pageBreakBeforeBlockIds: string[];
}

interface PlanBlockBounds {
  id: string;
  top: number;
  bottom: number;
}

interface PlanPageBreak extends PlanBlockBounds {
  spacerPoints: number;
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function isFiniteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function blockSpacerPoints(element: HTMLElement, scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0 || !element.classList.contains("bn-page-break-before")) {
    return 0;
  }

  const px = Number.parseFloat(element.style.getPropertyValue("--bn-page-break-space"));
  return Number.isFinite(px) && px > 0 ? px / scale : 0;
}

function cleanupBlock(element: HTMLElement): void {
  element.classList.remove("bn-page-break-before");
  element.style.removeProperty("--bn-page-break-space");
  element.removeAttribute("data-preshot-block-id");
}

function blockNoteEditorRoot(root: HTMLDivElement): HTMLElement | null {
  const editorRoot = root.querySelector(".bn-editor");
  return editorRoot instanceof HTMLElement ? editorRoot : null;
}

function topLevelBlockGroup(root: HTMLDivElement): HTMLElement | null {
  const editorRoot = blockNoteEditorRoot(root);
  if (!editorRoot) {
    return null;
  }

  return (
    Array.from(editorRoot.children).find(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && element.getAttribute("data-node-type") === "blockGroup",
    ) ?? null
  );
}

function topLevelBlocks(root: HTMLDivElement): HTMLElement[] {
  const blockGroup = topLevelBlockGroup(root);
  if (!blockGroup) {
    return [];
  }

  return Array.from(blockGroup.children).filter(
    (element): element is HTMLElement =>
      element instanceof HTMLElement && element.getAttribute("data-node-type") === "blockOuter",
  );
}

export function calculatePlanPageBreaks(input: {
  blocks: PlanBlockBounds[];
  pageContentHeightPoints: number;
  pageMarginPoints: number;
  pageSurfaceHeightPoints: number;
}): { pageBreaks: PlanPageBreak[]; pageBreakBeforeBlockIds: string[]; totalSpacerPoints: number } {
  const pageBreaks: PlanPageBreak[] = [];
  const { blocks, pageContentHeightPoints, pageMarginPoints, pageSurfaceHeightPoints } = input;
  if (
    !Number.isFinite(pageContentHeightPoints) ||
    pageContentHeightPoints <= 0 ||
    !Number.isFinite(pageSurfaceHeightPoints) ||
    pageSurfaceHeightPoints <= 0
  ) {
    return { pageBreaks, pageBreakBeforeBlockIds: [], totalSpacerPoints: 0 };
  }

  let totalSpacerPoints = 0;

  for (const block of blocks) {
    if (!isFiniteNonNegative(block.top) || !isFiniteNonNegative(block.bottom) || block.bottom < block.top) {
      continue;
    }

    const blockHeight = block.bottom - block.top;
    if (!Number.isFinite(blockHeight) || blockHeight <= 0) {
      continue;
    }

    const effectiveTop = block.top + totalSpacerPoints;
    const effectiveBottom = block.bottom + totalSpacerPoints;
    const pageIndex = Math.max(0, Math.floor(effectiveTop / pageSurfaceHeightPoints));
    const contentStart = pageIndex * pageSurfaceHeightPoints + pageMarginPoints;
    const contentEnd = contentStart + pageContentHeightPoints;
    const nextContentStart = (pageIndex + 1) * pageSurfaceHeightPoints + pageMarginPoints;

    if (blockHeight > pageContentHeightPoints) {
      continue;
    }

    const crossesBoundary = effectiveBottom > contentEnd + 0.01;
    const startsBeforeNextContent = effectiveTop < nextContentStart - 0.01;
    if (!crossesBoundary || !startsBeforeNextContent) {
      continue;
    }

    const spacerPoints = nextContentStart - effectiveTop;
    if (!Number.isFinite(spacerPoints) || spacerPoints <= 0) {
      continue;
    }

    totalSpacerPoints += spacerPoints;
    pageBreaks.push({ ...block, spacerPoints });
  }

  return {
    pageBreaks,
    pageBreakBeforeBlockIds: pageBreaks.map((block) => block.id),
    totalSpacerPoints,
  };
}

export function usePlanContentMeasurement(input: {
  componentId: string;
  scale: number;
  contentHeightPoints: number;
  onMeasure(id: string, measurement: PlanMeasurement): void;
}): { rootRef: React.RefObject<HTMLDivElement | null> } {
  const rootRef = useRef<HTMLDivElement>(null);
  const touchedBlocksRef = useRef<Set<HTMLElement>>(new Set());
  const observedBlocksRef = useRef<HTMLElement[]>([]);
  const lastMeasurementRef = useRef<PlanMeasurement | null>(null);
  const onMeasureRef = useRef(input.onMeasure);
  const mutationTargetRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    onMeasureRef.current = input.onMeasure;
  }, [input.onMeasure]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      recalculate();
    });
    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            scheduleRecalculate();
          });
    let scheduled = false;
    let disposed = false;

    const scheduleRecalculate = () => {
      if (scheduled) {
        return;
      }

      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (disposed) {
          return;
        }
        recalculate();
      });
    };

    const observeBlocks = (blocks: HTMLElement[]) => {
      const current = new Set(blocks);
      for (const block of observedBlocksRef.current) {
        if (!current.has(block)) {
          observer.unobserve(block);
        }
      }
      for (const block of blocks) {
        if (!observedBlocksRef.current.includes(block)) {
          observer.observe(block);
        }
      }
      observedBlocksRef.current = blocks;
    };

    const observeMutations = (target: HTMLElement | null) => {
      if (!mutationObserver || mutationTargetRef.current === target) {
        return;
      }

      mutationObserver.disconnect();
      mutationTargetRef.current = target;
      if (target) {
        mutationObserver.observe(target, { childList: true, subtree: true });
      }
    };

    const recalculate = () => {
      const scale = input.scale;
      const contentHeightPoints = input.contentHeightPoints;
      observeMutations(blockNoteEditorRoot(root));
      if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(contentHeightPoints) || contentHeightPoints <= 0) {
        observeBlocks([]);
        for (const block of touchedBlocksRef.current) {
          cleanupBlock(block);
        }
        touchedBlocksRef.current.clear();
        return;
      }

      const surface = root.closest('[data-testid="paged-canvas-surface"]');
      if (!(surface instanceof HTMLElement)) {
        return;
      }

      const surfaceRect = surface.getBoundingClientRect();
      const blocks = topLevelBlocks(root);
      observeBlocks(blocks);

      const currentBlocks = new Set(blocks);
      for (const block of touchedBlocksRef.current) {
        if (!currentBlocks.has(block)) {
          cleanupBlock(block);
        }
      }

      let accumulatedSpacerPoints = 0;
      const naturalBlocks = blocks
        .map((block, index) => {
          const runtimeId = `${input.componentId}:block-${index}`;
          block.setAttribute("data-preshot-block-id", runtimeId);
          const rect = block.getBoundingClientRect();
          const currentSpacerPoints = blockSpacerPoints(block, scale);
          const top = rect.top - surfaceRect.top;
          const bottom = rect.bottom - surfaceRect.top;
          if (!Number.isFinite(top) || !Number.isFinite(bottom)) {
            accumulatedSpacerPoints += currentSpacerPoints;
            return null;
          }

          const naturalTop = top / scale - accumulatedSpacerPoints - currentSpacerPoints;
          const naturalBottom = bottom / scale - accumulatedSpacerPoints - currentSpacerPoints;
          accumulatedSpacerPoints += currentSpacerPoints;
          return { element: block, id: runtimeId, top: naturalTop, bottom: naturalBottom };
        })
        .filter((block): block is PlanBlockBounds & { element: HTMLElement } => block !== null);

      const { pageBreaks, pageBreakBeforeBlockIds, totalSpacerPoints } = calculatePlanPageBreaks({
        blocks: naturalBlocks,
        pageContentHeightPoints: contentSize(DEFAULT_PAGE_GEOMETRY).height,
        pageMarginPoints: DEFAULT_PAGE_GEOMETRY.margin,
        pageSurfaceHeightPoints: A4.height + PAGE_SCREEN_GAP / scale,
      });

      const breakMap = new Map(pageBreaks.map((block) => [block.id, block.spacerPoints]));
      for (const block of blocks) {
        const runtimeId = block.getAttribute("data-preshot-block-id");
        const spacerPoints = runtimeId ? breakMap.get(runtimeId) : undefined;
        if (spacerPoints === undefined) {
          block.classList.remove("bn-page-break-before");
          block.style.removeProperty("--bn-page-break-space");
        } else {
          block.classList.add("bn-page-break-before");
          block.style.setProperty("--bn-page-break-space", `${spacerPoints * scale}px`);
        }
      }

      touchedBlocksRef.current = currentBlocks;
      const heightPoints = contentHeightPoints + totalSpacerPoints;
      if (!Number.isFinite(heightPoints) || heightPoints < 0) {
        return;
      }

      const nextMeasurement = { heightPoints, pageBreakBeforeBlockIds };
      const previous = lastMeasurementRef.current;
      if (
        previous &&
        Math.abs(previous.heightPoints - nextMeasurement.heightPoints) < 1 &&
        arraysEqual(previous.pageBreakBeforeBlockIds, nextMeasurement.pageBreakBeforeBlockIds)
      ) {
        return;
      }

      lastMeasurementRef.current = nextMeasurement;
      onMeasureRef.current(input.componentId, nextMeasurement);
    };

    observer.observe(root);
    recalculate();

    return () => {
      disposed = true;
      observer.disconnect();
      mutationObserver?.disconnect();
      mutationTargetRef.current = null;
      observeBlocks([]);
      lastMeasurementRef.current = null;
      for (const block of touchedBlocksRef.current) {
        cleanupBlock(block);
      }
      touchedBlocksRef.current.clear();
    };
  }, [input.componentId, input.contentHeightPoints, input.scale]);

  return { rootRef };
}
