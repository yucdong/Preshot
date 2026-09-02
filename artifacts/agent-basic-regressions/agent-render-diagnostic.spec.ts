import { expect, test } from "@playwright/test";

test("captures the agent render failure", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(`pageerror: ${error.stack ?? error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console: ${message.text()}`);
    }
  });

  await page.goto("/");
  await page.getByRole("button", { name: "显示助手面板" }).click();
  const assistant = page.getByRole("complementary", { name: "助手" });
  await assistant.getByRole("button", { name: "打开模型设置" }).click();
  const dialog = page.getByRole("dialog", { name: "设置" });
  await dialog.getByRole("button", { name: "测试连接" }).click();
  await expect(dialog.getByLabel("模型", { exact: true }))
    .toHaveValue("preshot-text");
  await page.keyboard.press("Escape");
  await expect.poll(() =>
    page.evaluate(() => window.__PRESHOT_AGENT_TEST__?.snapshot().projectId)
  ).not.toBeNull();
  await assistant.getByRole("button", { name: "开始新对话" }).click();
  await page.waitForTimeout(1_000);
  await page.screenshot({
    path: "artifacts/agent-basic-regressions/agent-render-failure.png",
    fullPage: true,
  });

  const boundary = page.getByRole("alert")
    .filter({ hasText: "Preshot 无法渲染此视图" });
  if (await boundary.isVisible()) {
    throw new Error(errors.join("\n\n") || "ErrorBoundary rendered without a browser error");
  }
  await expect(assistant.getByRole("button", { name: "历史记录" }))
    .toBeVisible();
});
