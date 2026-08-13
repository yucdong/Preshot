import { DefaultReporter } from "vitest/node";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null;
}

function findReport(task: unknown): string | undefined {
  const taskRecord = record(task);
  const meta = record(taskRecord?.meta);
  if (typeof meta?.midsceneReport === "string") return meta.midsceneReport;
  const children = Array.isArray(taskRecord?.tasks) ? taskRecord.tasks : [];
  for (const child of children) {
    const report = findReport(child);
    if (report) return report;
  }
  return undefined;
}

export default class MidsceneReporter extends DefaultReporter {
  printTask(task: unknown) {
    const taskRecord = record(task);
    const result = record(taskRecord?.result);
    if (!taskRecord || !("filepath" in taskRecord) || typeof result?.state !== "string" || result.state === "run" || result.state === "queued") return;
    const report = findReport(task);
    super.printTask(task as never);
    if (report) this.log(`  Midscene report: ${report}`);
  }
}
