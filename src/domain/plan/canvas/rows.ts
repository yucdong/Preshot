import type { PlanComponent, ProjectPlan } from "./models";
import {
  canAddToRow,
  remainingRowWidth,
  rowFits,
} from "./rowPacking";

export type ComponentMoveTarget =
  | { kind: "row"; rowId: string; toIndex: number }
  | { kind: "new-row"; rowId: string; toRowIndex: number };

function componentRows(plan: ProjectPlan): PlanComponent[][] {
  const rows = new Map<string, PlanComponent[]>();
  for (const component of plan.components) {
    const row = rows.get(component.rowId);
    if (row) {
      row.push(component);
    } else {
      rows.set(component.rowId, [component]);
    }
  }
  return [...rows.values()];
}

export function orderedRowIds(plan: ProjectPlan): string[] {
  return componentRows(plan).map((row) => row[0].rowId);
}

export function availableWidthInRow(
  plan: ProjectPlan,
  rowId: string,
  excludingComponentId?: string,
): number {
  const row = componentRows(plan)
    .find((candidate) => candidate[0].rowId === rowId)
    ?.filter((component) => component.id !== excludingComponentId);
  if (!row?.length) {
    return row ? 1 : 0;
  }
  return remainingRowWidth(row.map((component) => component.width));
}

function canFitInRow(
  plan: ProjectPlan,
  component: PlanComponent,
  rowId: string,
): boolean {
  const targetRow = componentRows(plan).find((row) => row[0].rowId === rowId);
  if (!targetRow) {
    return false;
  }

  return canAddToRow(
    targetRow
      .filter((candidate) => candidate.id !== component.id)
      .map((candidate) => candidate.width),
    component.width,
  );
}

export function moveComponentInRows(
  plan: ProjectPlan,
  params: { id: string; target: ComponentMoveTarget },
): ProjectPlan {
  const component = plan.components.find((candidate) => candidate.id === params.id);
  if (!component) {
    return plan;
  }

  const rows = componentRows(plan).map((row) => row.filter((candidate) => candidate.id !== params.id));
  const nonEmptyRows = rows.filter((row) => row.length > 0);

  if (params.target.kind === "row") {
    const targetRowIndex = nonEmptyRows.findIndex((row) => row[0].rowId === params.target.rowId);
    if (targetRowIndex < 0 || !canFitInRow(plan, component, params.target.rowId)) {
      return plan;
    }
    const targetRow = nonEmptyRows[targetRowIndex];
    const index = Math.max(0, Math.min(params.target.toIndex, targetRow.length));
    targetRow.splice(index, 0, { ...component, rowId: params.target.rowId });
    const components = nonEmptyRows.flat();
    const unchanged = components.every(
      (candidate, index) =>
        candidate.id === plan.components[index]?.id &&
        candidate.rowId === plan.components[index]?.rowId,
    );
    return unchanged ? plan : { ...plan, components };
  }

  if (
    !params.target.rowId ||
    nonEmptyRows.some((row) => row[0].rowId === params.target.rowId) ||
    !rowFits([component.width])
  ) {
    return plan;
  }
  const rowIndex = Math.max(0, Math.min(params.target.toRowIndex, nonEmptyRows.length));
  nonEmptyRows.splice(rowIndex, 0, [{ ...component, rowId: params.target.rowId }]);
  const components = nonEmptyRows.flat();
  const sourceWasSingleton =
    plan.components.filter((candidate) => candidate.rowId === component.rowId).length === 1;
  const unchanged =
    sourceWasSingleton &&
    components.every((candidate, index) => candidate.id === plan.components[index]?.id);
  return unchanged ? plan : { ...plan, components };
}
