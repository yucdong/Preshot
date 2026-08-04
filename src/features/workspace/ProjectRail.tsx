import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { WorkspaceProjectView } from "../../domain/workspace/models";
import { ProjectCard } from "./ProjectCard";

interface ProjectRailProps {
  projects: WorkspaceProjectView[];
  disabled?: boolean;
  onOpen(project: WorkspaceProjectView): Promise<void> | void;
  onRelocate(project: WorkspaceProjectView): Promise<void> | void;
  onRemove(project: WorkspaceProjectView): Promise<void> | void;
}

const visibleCardCount = 3;
const cardScrollStep = 336;
const railBoundaryTolerance = 1;

interface RailBoundaryState {
  isAtEnd: boolean;
  isAtStart: boolean;
}

function clampOffset(offset: number, projects: WorkspaceProjectView[]) {
  return Math.max(0, Math.min(offset, Math.max(0, projects.length - visibleCardCount)));
}

function getCardScrollStep(rail: HTMLDivElement | null) {
  if (!rail) {
    return cardScrollStep;
  }

  const firstCard = rail.firstElementChild as HTMLElement | null;
  if (!firstCard) {
    return cardScrollStep;
  }

  const styles = window.getComputedStyle(rail);
  const measuredGap = Number.parseFloat(styles.columnGap || styles.gap || "0");
  const gap = Number.isFinite(measuredGap) ? measuredGap : 0;
  const measuredStep = firstCard.getBoundingClientRect().width + gap;

  return measuredStep > 0 ? measuredStep : cardScrollStep;
}

function getOffsetFromScrollLeft(
  rail: HTMLDivElement | null,
  scrollLeft: number,
  projects: WorkspaceProjectView[],
) {
  const step = getCardScrollStep(rail);
  const boundaries = getRailBoundaryState(rail, scrollLeft);

  if (boundaries?.isAtEnd) {
    return clampOffset(projects.length - visibleCardCount, projects);
  }

  return clampOffset(Math.floor((scrollLeft + railBoundaryTolerance) / step), projects);
}

function getRailBoundaryState(
  rail: HTMLDivElement | null,
  scrollLeft = rail?.scrollLeft ?? 0,
) {
  if (!rail || rail.clientWidth <= 0 || rail.scrollWidth <= 0) {
    return null;
  }

  return {
    isAtEnd: scrollLeft + rail.clientWidth >= rail.scrollWidth - railBoundaryTolerance,
    isAtStart: scrollLeft <= railBoundaryTolerance,
  } satisfies RailBoundaryState;
}

export function ProjectRail({
  projects,
  disabled = false,
  onOpen,
  onRelocate,
  onRemove,
}: ProjectRailProps) {
  const { t } = useTranslation();
  const [offset, setOffset] = useState(0);
  const [railBoundaries, setRailBoundaries] = useState<RailBoundaryState | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const lastKnownScrollLeftRef = useRef(0);
  const primaryActionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const maxOffset = useMemo(
    () => Math.max(0, projects.length - visibleCardCount),
    [projects.length],
  );
  const safeOffset = clampOffset(offset, projects);

  const syncRailBoundaries = useCallback((scrollLeft = railRef.current?.scrollLeft ?? 0) => {
    lastKnownScrollLeftRef.current = scrollLeft;
    const nextBoundaries = getRailBoundaryState(railRef.current, scrollLeft);

    setRailBoundaries((currentBoundaries) => {
      if (
        currentBoundaries?.isAtEnd === nextBoundaries?.isAtEnd &&
        currentBoundaries?.isAtStart === nextBoundaries?.isAtStart
      ) {
        return currentBoundaries;
      }

      return nextBoundaries;
    });
  }, []);

  const syncRailStateFromScrollPosition = useCallback(
    (scrollLeft = railRef.current?.scrollLeft ?? 0) => {
      syncRailBoundaries(scrollLeft);
      setOffset(getOffsetFromScrollLeft(railRef.current, scrollLeft, projects));
    },
    [projects, syncRailBoundaries],
  );

  useLayoutEffect(() => {
    syncRailStateFromScrollPosition();

    function handleResize() {
      syncRailStateFromScrollPosition();
    }

    window.addEventListener("resize", handleResize);

    if (typeof ResizeObserver === "undefined" || !railRef.current) {
      return () => {
        window.removeEventListener("resize", handleResize);
      };
    }

    const observer = new ResizeObserver(() => {
      syncRailStateFromScrollPosition();
    });

    observer.observe(railRef.current);

    const firstCard = railRef.current.firstElementChild;
    if (firstCard) {
      observer.observe(firstCard);
    }

    return () => {
      window.removeEventListener("resize", handleResize);
      observer.disconnect();
    };
  }, [projects.length, syncRailStateFromScrollPosition]);

  function scrollRail(delta: number) {
    if (!delta) {
      return;
    }

    const step = getCardScrollStep(railRef.current);
    const nextScrollLeft = lastKnownScrollLeftRef.current + delta * step;
    syncRailBoundaries(nextScrollLeft);
    railRef.current?.scrollBy({
      left: delta * step,
      behavior: "smooth",
    });
  }

  function moveOffset(nextOffset: number) {
    setOffset((currentOffset) => {
      const clampedOffset = clampOffset(nextOffset, projects);
      scrollRail(clampedOffset - currentOffset);
      return clampedOffset;
    });
  }

  function focusProject(targetIndex: number) {
    const clampedIndex = Math.max(0, Math.min(targetIndex, projects.length - 1));
    const target = primaryActionRefs.current[clampedIndex];
    if (!target) {
      return;
    }

    target.focus();
    setOffset((currentOffset) => {
      let nextOffset = currentOffset;

      if (clampedIndex < currentOffset) {
        nextOffset = clampedIndex;
      } else if (clampedIndex > currentOffset + visibleCardCount - 1) {
        nextOffset = clampedIndex - visibleCardCount + 1;
      }

      nextOffset = clampOffset(nextOffset, projects);
      scrollRail(nextOffset - currentOffset);
      return nextOffset;
    });
  }

  function getFocusedProjectIndex() {
    return primaryActionRefs.current.findIndex((element) => element === document.activeElement);
  }

  function handleDirectionalFocus(direction: -1 | 1) {
    if (!projects.length) {
      return;
    }

    const focusedIndex = getFocusedProjectIndex();

    if (focusedIndex === -1) {
      focusProject(direction > 0 ? 0 : projects.length - 1);
      return;
    }

    focusProject(focusedIndex + direction);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2
            className="text-3xl font-semibold tracking-tight text-stone-900 dark:text-white"
            id="recent-projects-heading"
          >
            {t("rail.recentProjects")}
          </h2>
          <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
            {t("rail.recentProjectsHint")}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            aria-label={t("rail.previous")}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-stone-300 bg-white text-stone-700 transition hover:border-stone-400 hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.03] dark:text-stone-200 dark:hover:border-white/25 dark:hover:bg-white/8"
            disabled={disabled || (railBoundaries ? railBoundaries.isAtStart : safeOffset <= 0)}
            onClick={() => moveOffset(safeOffset - 1)}
            type="button"
          >
            ←
          </button>
          <button
            aria-label={t("rail.next")}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-stone-300 bg-white text-stone-700 transition hover:border-stone-400 hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.03] dark:text-stone-200 dark:hover:border-white/25 dark:hover:bg-white/8"
            disabled={disabled || (railBoundaries ? railBoundaries.isAtEnd : safeOffset >= maxOffset)}
            onClick={() => moveOffset(safeOffset + 1)}
            type="button"
          >
            →
          </button>
        </div>
      </div>
      <div
        aria-label={t("rail.recentProjects")}
        className="grid auto-cols-[calc((100%-2rem)/3)] grid-flow-col gap-4 overflow-x-auto scroll-smooth pb-4 pr-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") {
            event.preventDefault();
            handleDirectionalFocus(1);
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            handleDirectionalFocus(-1);
          } else if (event.key === "Home") {
            event.preventDefault();
            focusProject(0);
          } else if (event.key === "End") {
            event.preventDefault();
            focusProject(projects.length - 1);
          }
        }}
        onWheel={(event) => {
          if (event.deltaX) {
            return;
          }

          if (!event.deltaY) {
            return;
          }

          event.preventDefault();
          railRef.current?.scrollBy({ left: event.deltaY, behavior: "auto" });
        }}
        onScroll={(event) => {
          syncRailStateFromScrollPosition(event.currentTarget.scrollLeft);
        }}
        ref={railRef}
        role="region"
        tabIndex={0}
      >
        {projects.map((project, index) => (
          <ProjectCard
            disabled={disabled}
            key={project.projectId}
            onOpen={onOpen}
            onRelocate={onRelocate}
            onRemove={onRemove}
            primaryActionRef={(element) => {
              primaryActionRefs.current[index] = element;
            }}
            project={project}
          />
        ))}
      </div>
    </div>
  );
}
