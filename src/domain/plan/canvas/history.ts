import type { PlanComponent, ProjectPlan } from "./models";
import { mergeTextTreeContent } from "./textTree";

export interface PlanHistory {
  past: ProjectPlan[];
  future: ProjectPlan[];
  limit: number;
  lastKey?: string;
  lastAt?: number;
}

export interface RecordOptions {
  coalesceKey?: string;
  now?: number;
}

export interface HistoryOutcome {
  next: ProjectPlan;
  history: PlanHistory;
}

export const COALESCE_WINDOW_MS = 600;

const DEFAULT_LIMIT = 50;

function clonePlan(plan: ProjectPlan): ProjectPlan {
  return typeof structuredClone === "function"
    ? structuredClone(plan)
    : (JSON.parse(JSON.stringify(plan)) as ProjectPlan);
}

export function createHistory(limit: number = DEFAULT_LIMIT): PlanHistory {
  return { past: [], future: [], limit };
}

export function record(
  history: PlanHistory,
  previous: ProjectPlan,
  options: RecordOptions = {},
): PlanHistory {
  const now = options.now ?? Date.now();
  const key = options.coalesceKey;

  const shouldCoalesce =
    key !== undefined &&
    key === history.lastKey &&
    history.lastAt !== undefined &&
    now - history.lastAt < COALESCE_WINDOW_MS;

  if (shouldCoalesce) {
    return { ...history, future: [], lastAt: now };
  }

  const past = [...history.past, clonePlan(previous)];
  while (past.length > history.limit) {
    past.shift();
  }

  return {
    ...history,
    past,
    future: [],
    lastKey: key,
    lastAt: key === undefined ? undefined : now,
  };
}

export function undo(
  history: PlanHistory,
  current: ProjectPlan,
): HistoryOutcome | null {
  if (history.past.length === 0) {
    return null;
  }
  const past = [...history.past];
  const next = past.pop() as ProjectPlan;
  const future = [...history.future, clonePlan(current)];
  return {
    next: clonePlan(next),
    history: { ...history, past, future, lastKey: undefined, lastAt: undefined },
  };
}

export function redo(
  history: PlanHistory,
  current: ProjectPlan,
): HistoryOutcome | null {
  if (history.future.length === 0) {
    return null;
  }
  const future = [...history.future];
  const next = future.pop() as ProjectPlan;
  const past = [...history.past, clonePlan(current)];
  return {
    next: clonePlan(next),
    history: { ...history, past, future, lastKey: undefined, lastAt: undefined },
  };
}

export function canUndo(history: PlanHistory): boolean {
  return history.past.length > 0;
}

export function canRedo(history: PlanHistory): boolean {
  return history.future.length > 0;
}

export function mergeStructural(
  target: ProjectPlan,
  current: ProjectPlan,
): ProjectPlan {
  const currentById = new Map<string, PlanComponent>(
    current.components.map((component) => [component.id, component]),
  );
  const currentImagesById = new Map(
    current.components.flatMap((component) =>
      component.type === "reference"
        ? component.images.map((image) => [image.id, image] as const)
        : [],
    ),
  );

  return {
    ...target,
    components: target.components.map((component) => {
      const existing = currentById.get(component.id);
      if (!existing || existing.type !== component.type) {
        return component;
      }
      if (component.type === "plan" && existing.type === "plan") {
        return {
          ...component,
          textRoot: mergeTextTreeContent(component.textRoot, existing.textRoot),
        };
      }
      if (component.type === "reference" && existing.type === "reference") {
        return {
          ...component,
          description: existing.description,
          images: component.images.map((image) => {
            const currentImage = currentImagesById.get(image.id);
            return currentImage?.file === image.file
              ? { ...image, aspectRatio: currentImage.aspectRatio }
              : image;
          }),
        };
      }
      return component;
    }),
  };
}
