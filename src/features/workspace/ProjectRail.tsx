import { useMemo, useRef, useState } from "react";
import { ProjectCard } from "./ProjectCard";
import type { WorkspaceProjectView } from "./WorkspaceLauncher";

interface ProjectRailProps {
  projects: WorkspaceProjectView[];
  disabled?: boolean;
  onOpen(project: WorkspaceProjectView): Promise<void> | void;
  onRelocate(project: WorkspaceProjectView): Promise<void> | void;
  onRemove(project: WorkspaceProjectView): Promise<void> | void;
}

const visibleCardCount = 3;
const cardScrollStep = 336;

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
  return clampOffset(Math.round(scrollLeft / step), projects);
}

export function ProjectRail({
  projects,
  disabled = false,
  onOpen,
  onRelocate,
  onRemove,
}: ProjectRailProps) {
  const [offset, setOffset] = useState(0);
  const railRef = useRef<HTMLDivElement>(null);
  const primaryActionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const maxOffset = useMemo(
    () => Math.max(0, projects.length - visibleCardCount),
    [projects.length],
  );
  const safeOffset = clampOffset(offset, projects);

  function scrollRail(delta: number) {
    if (!delta) {
      return;
    }

    railRef.current?.scrollBy({
      left: delta * cardScrollStep,
      behavior: "smooth",
    });
  }

  function syncOffsetFromScrollPosition(scrollLeft: number) {
    setOffset(getOffsetFromScrollLeft(railRef.current, scrollLeft, projects));
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
            className="text-3xl font-semibold tracking-tight text-white"
            id="recent-projects-heading"
          >
            Recent projects
          </h2>
          <p className="mt-2 text-sm text-stone-400">
            Browse your latest work and keep editing without reopening folders.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            aria-label="Previous projects"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-stone-200 transition hover:border-white/25 hover:bg-white/8 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled || safeOffset <= 0}
            onClick={() => moveOffset(safeOffset - 1)}
            type="button"
          >
            ←
          </button>
          <button
            aria-label="Next projects"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-stone-200 transition hover:border-white/25 hover:bg-white/8 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled || safeOffset >= maxOffset}
            onClick={() => moveOffset(safeOffset + 1)}
            type="button"
          >
            →
          </button>
        </div>
      </div>
      <div
        aria-label="Recent projects"
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
          syncOffsetFromScrollPosition(event.currentTarget.scrollLeft);
        }}
        ref={railRef}
        role="region"
        tabIndex={0}
      >
        {projects.map((project, index) => (
          <ProjectCard
            disabled={disabled}
            key={project.id}
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
