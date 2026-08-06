import { contentSize, DEFAULT_PAGE_GEOMETRY, SPACING } from "./geometry";
import type { PlanComponent, ProjectPlan } from "./models";

export type ComponentMoveTarget =
  | { kind: "row"; rowId: string; toIndex: number }
  | { kind: "new-row"; rowId: string; toRowIndex: number };

const gapFraction = SPACING / contentSize(DEFAULT_PAGE_GEOMETRY).width;

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
  const used =
    row.reduce((sum, component) => sum + component.width, 0) +
    Math.max(0, row.length - 1) * gapFraction;
  return Math.max(0, 1 - used);
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
    if (targetRowIndex < 0 || component.width > availableWidthInRow(plan, params.target.rowId, params.id)) {
      return plan;
    }
    const targetRow = nonEmptyRows[targetRowIndex];
    const index = Math.max(0, Math.min(params.target.toIndex, targetRow.length));
    targetRow.splice(index, 0, { ...component, rowId: params.target.rowId });
    return { ...plan, components: nonEmptyRows.flat() };
  }

  if (
    !params.target.rowId ||
    nonEmptyRows.some((row) => row[0].rowId === params.target.rowId) ||
    component.width > 1
  ) {
    return plan;
  }
  const rowIndex = Math.max(0, Math.min(params.target.toRowIndex, nonEmptyRows.length));
  nonEmptyRows.splice(rowIndex, 0, [{ ...component, rowId: params.target.rowId }]);
  return { ...plan, components: nonEmptyRows.flat() };
}
