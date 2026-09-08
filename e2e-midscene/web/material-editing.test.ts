import { describe, it } from "vitest";
import { WebTest } from "../context";

const baseUrl = process.env.MIDSCENE_MATERIAL_URL ?? "http://127.0.0.1:15614";
const variants = [
  { kind: "imageGroup", field: "图片组说明" },
  { kind: "modelCard", field: "其他信息" },
  { kind: "shootingLocation", field: "场地信息" },
  { kind: "clothing", field: "服装信息" },
  { kind: "prop", field: "道具信息" },
];

for (const variant of variants) {
  describe(`Material editing ${variant.kind}`, () => {
    const ctx = WebTest.setup(`${baseUrl}/e2e/fixtures/material-library.html?materialKind=${variant.kind}`, {
      viewport: { width: 1000, height: 900 },
      agentOptions: {
        aiActionContext: "You are a desktop UI testing expert reviewing Chinese photography planning interfaces. Only synthetic test materials are present.",
      },
    });

    it("offers clear native text editing and a non-overlapping image action row", async () => {
      await ctx.agent.aiAct("通过页头的“素材库”按钮打开素材库，确认主要操作只有“编辑素材”和“预览”。进入现有素材的“编辑素材”窗口，确认同时显示素材信息和仅包含这一份素材的画布。若点击未打开，应根据当前截图重新定位后继续。", { deepThink: true, deepLocate: true });
      await ctx.agent.aiAct(`在“${variant.field}”文本框里输入“光线柔和，适合傍晚拍摄”。用鼠标选中其中一段文字，确认选中文字有清晰可见的高亮，输入框有明确的焦点提示。确认右侧或下方的图片标题、图片数量、“添加图片”和“截图”按钮互不遮挡，均可辨认。不要保存或关闭画布。`, { deepThink: true, deepLocate: true });
      await ctx.page.screenshot({ path: `midscene_run/${variant.kind}-material-editing.png`, fullPage: true });
    });
  });
}
