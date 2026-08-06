import type { PlanComponent } from "./models";
import {
  moveComponentInRows,
  orderedRowIds,
} from "./rows";

export type ComponentDropTarget =
  | { kind: "row"; rowId: string; toIndex: number }
  | { kind: "new-row"; toRowIndex: number }
  | { kind: "invalid"; reason: "capacity" | "missing" };

type ComponentDropOver =
  | { type: "component"; id: string; insertAfter: boolean }
  | { type: "row-gap"; toRowIndex: number };

export function componentDropTarget(
  components: PlanComponent[],
  activeId: string,
  over: ComponentDropOver | null,
): ComponentDropTarget {
  const active = components.find((component) => component.id === activeId);
  if (!active || !over) {
    return { kind: "invalid", reason: "missing" };
  }

  const plan = { schemaVersion: 5 as const, title: "", components };
  if (over.type === "row-gap") {
    if (!Number.isFinite(over.toRowIndex)) {
      return { kind: "invalid", reason: "missing" };
    }
    const originalRowIds = orderedRowIds(plan);
    const sourceRowIndex = originalRowIds.indexOf(active.rowId);
    const remainingComponents = components.filter(
      (component) => component.id !== active.id,
    );
    const remainingRowIds = orderedRowIds({
      ...plan,
      components: remainingComponents,
    });
    const sourceRowRemoved = !remainingComponents.some(
      (component) => component.rowId === active.rowId,
    );
    const requestedIndex = Math.trunc(over.toRowIndex);
    const adjustedIndex =
      sourceRowRemoved && sourceRowIndex >= 0 && sourceRowIndex < requestedIndex
        ? requestedIndex - 1
        : requestedIndex;
    return {
      kind: "new-row",
      toRowIndex: Math.max(0, Math.min(adjustedIndex, remainingRowIds.length)),
    };
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
