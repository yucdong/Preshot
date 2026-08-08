import { useEffect, useRef } from "react";

export interface PlanMeasurement {
  heightPoints: number;
  pageBreakBeforeBlockIds: string[];
  blockHeightsPoints: number[];
  sourceHtml?: string;
  blocks?: readonly { html: string; heightPoints: number }[];
}

interface PlanBlockBounds {
  id: string;
  top: number;
  bottom: number;
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
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

function topLevelBlocksInGroup(blockGroup: HTMLElement | null): HTMLElement[] {
  if (!blockGroup) {
    return [];
  }

  return Array.from(blockGroup.children).filter(
    (element): element is HTMLElement =>
      element instanceof HTMLElement && element.getAttribute("data-node-type") === "blockOuter",
  );
}

function topLevelBlockIdentity(root: HTMLDivElement): {
  blockGroup: HTMLElement | null;
  blocks: HTMLElement[];
} {
  const blockGroup = topLevelBlockGroup(root);
  return { blockGroup, blocks: topLevelBlocksInGroup(blockGroup) };
}

function sameBlockIdentity(previous: readonly HTMLElement[], next: readonly HTMLElement[]): boolean {
  return previous.length === next.length && previous.every((block, index) => block === next[index]);
}

export function usePlanContentMeasurement(input: {
  componentId: string;
  contentKey: string;
  scale: number;
  contentHeightPoints: number;
  onMeasure(id: string, measurement: PlanMeasurement): void;
}): { rootRef: React.RefObject<HTMLDivElement | null> } {
  const rootRef = useRef<HTMLDivElement>(null);
  const touchedBlocksRef = useRef<Set<HTMLElement>>(new Set());
  const observedBlocksRef = useRef<HTMLElement[]>([]);
  const lastMeasurementRef = useRef<PlanMeasurement | null>(null);
  const onMeasureRef = useRef(input.onMeasure);

  useEffect(() => {
    onMeasureRef.current = input.onMeasure;
  }, [input.onMeasure]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") {
      return;
    }

    let disposed = false;
    let scheduledRecalculation: ReturnType<typeof setTimeout> | null = null;
    let observedIdentity = topLevelBlockIdentity(root);
    const observer = new ResizeObserver(() => {
      recalculate();
    });

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

    const scheduleRecalculation = () => {
      if (disposed || scheduledRecalculation !== null) {
        return;
      }

      scheduledRecalculation = setTimeout(() => {
        scheduledRecalculation = null;
        if (!disposed) {
          recalculate();
        }
      }, 0);
    };

    const recalculate = () => {
      const scale = input.scale;
      const contentHeightPoints = input.contentHeightPoints;
      if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(contentHeightPoints) || contentHeightPoints <= 0) {
        observeBlocks([]);
        for (const block of touchedBlocksRef.current) {
          cleanupBlock(block);
        }
        touchedBlocksRef.current.clear();
        return;
      }

      const identity = topLevelBlockIdentity(root);
      const blocks = identity.blocks;
      observedIdentity = identity;
      observeBlocks(blocks);

      const currentBlocks = new Set(blocks);
      for (const block of touchedBlocksRef.current) {
        if (!currentBlocks.has(block)) {
          cleanupBlock(block);
        }
      }

      const naturalBlocks = blocks
        .map((block, index) => {
          const runtimeId = `${input.componentId}:block-${index}`;
          block.setAttribute("data-preshot-block-id", runtimeId);
          block.classList.remove("bn-page-break-before");
          block.style.removeProperty("--bn-page-break-space");
          const rect = block.getBoundingClientRect();
          const height = rect.bottom - rect.top;
          if (!Number.isFinite(height) || height < 0) {
            return null;
          }
          return { element: block, id: runtimeId, top: 0, bottom: height / scale };
        })
        .filter((block): block is PlanBlockBounds & { element: HTMLElement } => block !== null);

      touchedBlocksRef.current = currentBlocks;
      const heightPoints = contentHeightPoints;
      if (!Number.isFinite(heightPoints) || heightPoints < 0) {
        return;
      }

      const blockHeightsPoints = naturalBlocks.map((block) => block.bottom - block.top);
      const nextMeasurement = {
        heightPoints,
        pageBreakBeforeBlockIds: [] as string[],
        blockHeightsPoints,
      };
      const previous = lastMeasurementRef.current;
      if (
        previous &&
        Math.abs(previous.heightPoints - nextMeasurement.heightPoints) < 1 &&
        arraysEqual(previous.pageBreakBeforeBlockIds, nextMeasurement.pageBreakBeforeBlockIds) &&
        previous.blockHeightsPoints.length === blockHeightsPoints.length &&
        previous.blockHeightsPoints.every(
          (height, index) => Math.abs(height - blockHeightsPoints[index]) < 1,
        )
      ) {
        return;
      }

      lastMeasurementRef.current = nextMeasurement;
      onMeasureRef.current(input.componentId, nextMeasurement);
    };

    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            const nextIdentity = topLevelBlockIdentity(root);
            if (
              nextIdentity.blockGroup === observedIdentity.blockGroup &&
              sameBlockIdentity(observedIdentity.blocks, nextIdentity.blocks)
            ) {
              return;
            }

            observedIdentity = nextIdentity;
            scheduleRecalculation();
          });

    recalculate();
    mutationObserver?.observe(root, { childList: true, subtree: true });

    return () => {
      disposed = true;
      if (scheduledRecalculation !== null) {
        clearTimeout(scheduledRecalculation);
      }
      observeBlocks([]);
      observer.disconnect();
      mutationObserver?.disconnect();
      lastMeasurementRef.current = null;
      for (const block of touchedBlocksRef.current) {
        cleanupBlock(block);
      }
      touchedBlocksRef.current.clear();
    };
  }, [input.componentId, input.contentHeightPoints, input.contentKey, input.scale]);

  return { rootRef };
}
