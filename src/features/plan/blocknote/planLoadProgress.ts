export type PlanLoadProgress =
  | { status: "loading"; percent: number }
  | { status: "ready" }
  | { status: "failed"; message: string };

export function assetLoadPercent(completed: number, total: number): number {
  if (!Number.isInteger(completed) || !Number.isInteger(total) ||
      completed < 0 || total < 0 || completed > total) {
    throw new Error("Invalid project asset loading counts");
  }
  return total === 0 ? 84 : 30 + Math.floor(54 * completed / total);
}
