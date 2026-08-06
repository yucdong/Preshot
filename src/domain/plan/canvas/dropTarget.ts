import type { PlanComponent } from "./models";
import {
  availableWidthInRow,
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
    const toRowIndex = orderedRowIds(plan).indexOf(over.id);
    return toRowIndex < 0
      ? { kind: "invalid", reason: "missing" }
      : { kind: "new-row", toRowIndex };
  }

  const overComponent = components.find((component) => component.id === over.id);
  if (!overComponent || overComponent.id === active.id) {
    return { kind: "invalid", reason: "missing" };
  }
  if (active.width > availableWidthInRow(plan, overComponent.rowId, active.id)) {
    return { kind: "invalid", reason: "capacity" };
  }

  const targetRow = components.filter(
    (component) =>
      component.rowId === overComponent.rowId && component.id !== active.id,
  );
  const overIndex = targetRow.findIndex((component) => component.id === overComponent.id);
  if (overIndex < 0) {
    return { kind: "invalid", reason: "missing" };
  }

  return {
    kind: "row",
    rowId: overComponent.rowId,
    toIndex: overIndex + (over.insertAfter ? 1 : 0),
  };
}
