import type { PlaywrightAgent } from "@midscene/web/playwright";
import type { Page } from "playwright";
import { createEvidenceRecorder, type EvidenceRecorder } from "./evidence";

export interface FreshProjectContext {
  projectName: string;
  evidence: EvidenceRecorder;
}

export async function withFreshProject(
  page: Page,
  agent: PlaywrightAgent,
  caseId: string,
  run: (ctx: FreshProjectContext) => Promise<void>,
) {
  const runId = process.env.MIDSCENE_RUN_ID ?? new Date().toISOString().replace(/[:.]/g, "-");
  const projectName = `UIAUTO-${caseId}-${Date.now()}`;
  const evidence = await createEvidenceRecorder(page, runId, caseId);
  let cleanupUi = "not-attempted";
  let cleanupError: string | null = null;

  try {
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("preshot.midscene.")) localStorage.removeItem(key);
      }
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await agent.aiAct(`在启动页点击“新建项目”，在弹出的新建项目对话框中输入项目名称“${projectName}”，点击“创建项目”，等待项目打开。确认当前项目名称是“${projectName}”，中央画布为空且可以看到“插入组件”按钮。`);
    await evidence.checkpoint("fresh-project");
    await run({ projectName, evidence });
  } finally {
    await evidence.checkpoint("before-cleanup").catch(() => undefined);
    try {
      await agent.aiAct(`清理测试现场：在左侧最近项目列表中找到当前项目“${projectName}”，将鼠标悬停在它上面，点击该项目的移除按钮；在确认对话框中点击“从列表移除”。确认左侧不再显示项目“${projectName}”。`);
      cleanupUi = "passed";
      await evidence.checkpoint("after-ui-cleanup");
    } catch (error) {
      cleanupUi = "failed";
      cleanupError = error instanceof Error ? error.message : String(error);
    }
    const remainingKeys = await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("preshot.midscene.")) localStorage.removeItem(key);
      }
      return Object.keys(localStorage).filter((key) => key.startsWith("preshot.midscene."));
    }).catch(() => ["page-unavailable"]);
    await evidence.finish({ projectName, cleanupUi, cleanupError, remainingKeys });
  }
}
