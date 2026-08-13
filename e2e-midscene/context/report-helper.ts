import type { TestStatus } from "@midscene/core";
import { ReportMergingTool } from "@midscene/core/report";
import type { RunnerTestSuite, TestContext as VitestTestContext } from "vitest";
import { formatReportFileName, generateTimestamp } from "./utils";

interface ReportableContext {
  reportFile: string | null | undefined;
  startTime: number;
  destroy(): Promise<void>;
}

export class ReportHelper {
  private tool = new ReportMergingTool();
  private individualReports: string[] = [];

  reset() {
    this.tool = new ReportMergingTool();
    this.individualReports = [];
  }

  async collectReport(ctx: ReportableContext | undefined, testCtx: VitestTestContext) {
    let status: TestStatus = "passed";
    if (testCtx.task.result?.errors?.[0]?.message.includes("timed out")) status = "timedOut";
    else if (testCtx.task.result?.state === "fail") status = "failed";
    await ctx?.destroy();
    const reportFile = ctx?.reportFile ?? undefined;
    this.tool.append({
      reportFilePath: reportFile,
      reportAttributes: {
        testId: testCtx.task.id,
        testTitle: testCtx.task.name,
        testDescription: "",
        testDuration: ctx ? Math.round(performance.now() - ctx.startTime) : 0,
        testStatus: status,
      },
    });
    if (reportFile) this.individualReports.push(reportFile);
  }

  mergeReports(suite: RunnerTestSuite, reportName: string) {
    for (const task of suite.tasks) {
      if (task.mode === "skip") {
        this.tool.append({
          reportAttributes: {
            testId: task.id,
            testTitle: task.name,
            testDescription: "",
            testDuration: 0,
            testStatus: "skipped",
          },
        });
      }
    }
    const merged = this.tool.mergeReports(formatReportFileName(`E2E-${reportName}-${generateTimestamp()}`));
    const report = merged ?? this.individualReports[0] ?? null;
    if (report && suite.meta) suite.meta.midsceneReport = report;
    this.individualReports = [];
    return report;
  }
}

export function buildReportMeta(testCtx: VitestTestContext) {
  const groupName = testCtx.task.suite?.name || "Preshot Plan Text";
  return {
    groupName: `E2E: ${groupName}`,
    reportFileName: formatReportFileName(`E2E-${groupName}-${testCtx.task.name}-${generateTimestamp()}`),
  };
}
