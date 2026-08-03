import type { PlanComponent } from "./models";

export function componentDropTarget(
  components: PlanComponent[],
  activeId: string,
  overId: string | null,
  insertAfter: boolean,
): number | null {
  if (overId === null || overId === activeId) {
    return null;
  }
  if (!components.some((component) => component.id === activeId)) {
    return null;
  }
  const withoutActive = components.filter((component) => component.id !== activeId);
  const overIndex = withoutActive.findIndex((component) => component.id === overId);
  if (overIndex === -1) {
    return null;
  }
  return overIndex + (insertAfter ? 1 : 0);
}
