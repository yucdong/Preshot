import type { RunnerTestSuite, TestContext as VitestTestContext } from "vitest";
import { ReportHelper } from "./report-helper";

interface AgentLike {
  reportFile?: string | null;
  destroy(): Promise<void>;
}

export abstract class BaseTestContext<TAgent extends AgentLike> {
  agent: TAgent;
  startTime = performance.now();
  private savedReportFile: string | null | undefined;

  protected constructor(agent: TAgent) {
    this.agent = agent;
  }

  get reportFile() {
    return this.savedReportFile ?? this.agent.reportFile;
  }

  async destroy() {
    await this.agent.destroy();
    this.savedReportFile = this.agent.reportFile;
    await this.onDestroy();
  }

  protected async onDestroy(): Promise<void> {}

  protected static collectReport(helper: ReportHelper, ctx: BaseTestContext<AgentLike> | undefined, testCtx: VitestTestContext) {
    return helper.collectReport(ctx, testCtx);
  }

  protected static mergeAndTeardown(helper: ReportHelper, teardown: () => Promise<void>, suite: RunnerTestSuite) {
    const report = helper.mergeReports(suite, "Preshot-Plan-Text");
    return teardown().then(() => report);
  }
}
