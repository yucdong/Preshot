import { describe, it } from "vitest";
import { WebTest } from "../context";

describe("Material recycle bin", () => {
  const baseUrl = process.env.MIDSCENE_MATERIAL_URL ?? "http://127.0.0.1:15614";
  const ctx = WebTest.setup(`${baseUrl}/e2e/fixtures/material-library.html`, {
    viewport: { width: 1280, height: 900 },
    agentOptions: {
      aiActionContext: "You are a desktop UI testing expert reviewing Chinese photography planning interfaces. All materials and project data in this browser fixture are synthetic.",
    },
  });

  it("confirms irreversible deletion while preserving inserted project copies", async () => {
    await ctx.agent.aiAct("使用页头的“素材库”按钮打开素材库。确认详情里没有“内容版本”和“元数据版本”这些内部信息。点击“插入到当前文档”，把现有的“逆光玻璃杯”素材插入文档，确认文档里出现名称为“透明玻璃杯”的道具组件。", { deepThink: true, deepLocate: true });
    await ctx.agent.aiAct("再次打开素材库，选择“逆光玻璃杯”，点击“删除”并确认删除。进入“回收站”，确认该素材同时提供“恢复素材”和“永久删除”。点击“永久删除”，确认弹窗明确说明无法恢复且已插入项目的副本不受影响，然后点击“取消”，确认素材仍在回收站。", { deepThink: true, deepLocate: true });
    await ctx.agent.aiAct("再次点击“永久删除”，停留在确认窗口，不要确认或取消。", { deepThink: true, deepLocate: true });
    await ctx.page.screenshot({ path: "midscene_run/material-permanent-delete-confirmation.png", fullPage: true });
    await ctx.agent.aiAct("点击“确认永久删除”，确认回收站变为空，并确认素材库底部显示“素材已永久删除。”。不要关闭素材库，先完成这两项确认。", { deepThink: true, deepLocate: true });
    await ctx.page.screenshot({ path: "midscene_run/material-permanent-delete-complete.png", fullPage: true });
    await ctx.agent.aiAct("关闭素材库，确认文档里的“透明玻璃杯”道具组件仍然存在。", { deepThink: true, deepLocate: true });
  });
});
