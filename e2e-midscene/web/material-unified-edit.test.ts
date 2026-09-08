import { describe, it } from "vitest";
import { WebTest } from "../context";

const baseUrl = process.env.MIDSCENE_MATERIAL_URL ?? "http://127.0.0.1:15614";

describe("Unified material editing", () => {
  const ctx = WebTest.setup(`${baseUrl}/e2e/fixtures/material-library.html`, {
    viewport: { width: 1280, height: 900 },
    agentOptions: {
      aiActionContext: "You are a desktop UI testing expert reviewing Chinese photography planning interfaces. Only synthetic test materials are present.",
    },
  });

  it("offers two primary actions and edits information and content in one window", async () => {
    await ctx.agent.aiAct("通过页头的“素材库”按钮打开素材库。确认右侧详情预览区域只有“编辑素材”和“预览”两个主要按钮，没有独立的编辑信息、收藏、刷新或生成缩略图按钮。下方独立的删除操作可以保留。暂时停在素材库。", { deepThink: true, deepLocate: true });
    await ctx.page.screenshot({ path: "midscene_run/material-unified-actions.png", fullPage: true });
    await ctx.agent.aiAct("点击“编辑素材”，确认窗口左侧显示素材名称、标签、素材说明和收藏，右侧是道具组件的完整编辑画布，底部只有一组保存素材和取消按钮。把左侧素材名称改成“统一编辑的道具”，右侧道具名称改成“柔光玻璃杯”。确认两边文字不重叠、输入框和画布都能正常操作，暂时不要保存。", { deepThink: true, deepLocate: true });
    await ctx.page.screenshot({ path: "midscene_run/material-unified-editor.png", fullPage: true });
    await ctx.agent.aiAct("点击编辑窗口右下角黑色的“保存素材”按钮，等待出现已保存提示。确认仍停留在编辑素材窗口，没有自动退出，而且素材名称和道具名称保留刚才的修改。", { deepThink: true, deepLocate: true });
    await ctx.agent.aiAct("继续把素材说明改成“保存后可以继续编辑”，再次点击“保存素材”，确认仍停留在编辑页面并显示已保存。然后点击右下角“关闭”退出编辑，等待回到素材库并更新预览。", { deepThink: true, deepLocate: true });
    await ctx.agent.aiAct("确认详情中的素材名称是“统一编辑的道具”，组件内容中的道具名称是“柔光玻璃杯”。然后点击“预览”，确认打开大尺寸完整组件预览，里面能看到“柔光玻璃杯”。不要关闭预览。", { deepThink: true, deepLocate: true });
    await ctx.page.screenshot({ path: "midscene_run/material-unified-preview.png", fullPage: true });
    await ctx.agent.aiAct("关闭完整组件预览，确认回到素材库且可以正常点击“编辑素材”，再次打开后确认素材名称和道具名称都保留刚才的修改。", { deepThink: true, deepLocate: true });
  });
});
