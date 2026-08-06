import type { PlanComponent } from "./models";
import {
  moveComponentInRows,
  orderedRowIds,
} from "./rows";

export type ComponentDropTarget =
  | { kind: "row"; rowId: string; toIndex: number }
  | { kind: "new-row"; toRowIndex: number }
  | { kind: "invalid"; reason: "capacity" | "missing" };

export function componentDropTarget(
  components: PlanComponent[],
  activeId: string,
  over: { type: "component" | "row-gap"; id: string; insertAfter: boolean } | null,
): ComponentDropTarget {
  const active = components.find((component) => component.id === activeId);
  if (!active || !over) {
    return { kind: "invalid", reason: "missing" };
  }

  const plan = { schemaVersion: 5 as const, title: "", components };
  if (over.type === "row-gap") {
    const toRowIndex = orderedRowIds({
      ...plan,
      components: components.filter((component) => component.id !== active.id),
    }).indexOf(over.id);
    return toRowIndex < 0
      ? { kind: "invalid", reason: "missing" }
      : { kind: "new-row", toRowIndex };
  }

  const overComponent = components.find((component) => component.id === over.id);
  if (!overComponent || overComponent.id === active.id) {
    return { kind: "invalid", reason: "missing" };
  }

  const targetRow = components.filter(
    (component) =>
      component.rowId === overComponent.rowId && component.id !== active.id,
  );
  const overIndex = targetRow.findIndex((component) => component.id === overComponent.id);
  if (overIndex < 0) {
    return { kind: "invalid", reason: "missing" };
  }

  const target: ComponentDropTarget = {
    kind: "row",
    rowId: overComponent.rowId,
    toIndex: overIndex + (over.insertAfter ? 1 : 0),
  };
  return moveComponentInRows(plan, { id: active.id, target }) === plan
    ? { kind: "invalid", reason: "capacity" }
    : target;
}
