import type { PlanComponent, ProjectPlan } from "./models";

export type RenameComponentResult =
  | { ok: true; plan: ProjectPlan }
  | { ok: false; reason: "empty" | "duplicate" };

export type SetPlanTitleResult =
  | { ok: true; plan: ProjectPlan }
  | { ok: false; reason: "empty" };

const labels: Record<PlanComponent["type"], string> = {
  plan: "文案",
  reference: "图片组",
};

export function smallestFreeSuffixedName(
  names: Iterable<string>,
  label: string,
): string {
  const occupied = new Set(Array.from(names, (name) => name.trim()));
  let suffix = 1;
  while (occupied.has(`${label}${suffix}`)) {
    suffix += 1;
  }
  return `${label}${suffix}`;
}

export function nextComponentName(plan: ProjectPlan, type: PlanComponent["type"]): string {
  const label = labels[type];
  return smallestFreeSuffixedName(
    plan.components.map((component) => component.name),
    label,
  );
}

export function renameComponent(
  plan: ProjectPlan,
  id: string,
  name: string,
): RenameComponentResult {
  const trimmed = name.trim();
  if (!trimmed) {
    return { ok: false, reason: "empty" };
  }
  if (plan.components.some((component) => component.id !== id && component.name.trim() === trimmed)) {
    return { ok: false, reason: "duplicate" };
  }
  const components = plan.components.map((component) =>
    component.id === id && component.name !== trimmed ? { ...component, name: trimmed } : component,
  );
  return { ok: true, plan: { ...plan, components } };
}

export function setPlanTitle(plan: ProjectPlan, title: string): SetPlanTitleResult {
  const trimmed = title.trim();
  return trimmed ? { ok: true, plan: { ...plan, title: trimmed } } : { ok: false, reason: "empty" };
}
