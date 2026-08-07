import type { PlanComponent } from "./models";

export type ComponentDropTarget = { toIndex: number } | { kind: "invalid"; reason: "missing" };

type ComponentDropOver = { type: "component"; id: string; insertAfter: boolean };

export function componentDropTarget(
  components: PlanComponent[],
  activeId: string,
  over: ComponentDropOver | null,
): ComponentDropTarget {
  const activeIndex = components.findIndex((component) => component.id === activeId);
  if (activeIndex < 0 || !over) {
    return { kind: "invalid", reason: "missing" };
  }

  const remaining = components.filter((component) => component.id !== activeId);
  const overIndex = remaining.findIndex((component) => component.id === over.id);
  if (overIndex < 0) {
    return { kind: "invalid", reason: "missing" };
  }

  return { toIndex: overIndex + (over.insertAfter ? 1 : 0) };
}
