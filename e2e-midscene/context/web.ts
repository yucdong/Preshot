import { PlaywrightAgent, type WebPageAgentOpt } from "@midscene/web/playwright";
import { type Browser, type Page, chromium } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import type { RunnerTestSuite, TestContext as VitestTestContext } from "vitest";
import { BaseTestContext } from "./base";
import { buildReportMeta, ReportHelper } from "./report-helper";

interface WebTestOptions {
  viewport?: { width: number; height: number };
  headless?: boolean;
  agentOptions?: Omit<WebPageAgentOpt, "groupName" | "reportFileName">;
}

export class WebTest extends BaseTestContext<PlaywrightAgent> {
  private static browser: Browser | null = null;
  private static options: WebTestOptions = {};
  private static reports = new ReportHelper();
  page: Page;

  private constructor(page: Page, agent: PlaywrightAgent) {
    super(agent);
    this.page = page;
  }

  protected async onDestroy() {
    await this.page.close();
  }

  static async launch(options?: WebTestOptions) {
    this.options = options ?? {};
    this.browser = await chromium.launch({ headless: options?.headless ?? true, args: ["--no-sandbox"] });
    this.reports.reset();
  }

  static async create(url: string, testCtx: VitestTestContext, options?: WebTestOptions) {
    if (!this.browser) await this.launch(options);
    const merged = { ...this.options, ...options };
    const page = await this.browser!.newPage({ viewport: merged.viewport ?? { width: 1440, height: 900 } });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const meta = buildReportMeta(testCtx);
    const agent = new PlaywrightAgent(page, { ...merged.agentOptions, ...meta });
    return new WebTest(page, agent);
  }

  static async teardown() {
    await this.browser?.close();
    this.browser = null;
  }

  static setup(url: string, options?: WebTestOptions) {
    let current: WebTest | undefined;
    beforeAll(() => this.launch(options));
    beforeEach(async (testCtx) => { current = await this.create(url, testCtx, options); });
    afterEach(async (testCtx) => {
      const finished = current;
      current = undefined;
      await this.collectReport(this.reports, finished, testCtx);
    });
    afterAll((context, suite: RunnerTestSuite) => {
      void context;
      return this.mergeAndTeardown(this.reports, this.teardown.bind(this), suite);
    });
    return {
      get page() { return current!.page; },
      get agent() { return current!.agent; },
    } as { page: Page; agent: PlaywrightAgent };
  }
}
