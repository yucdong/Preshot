import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ timeout: 150_000 });

async function openAssistant(page: Page) {
  await page.goto("/", { waitUntil: "commit" });
  const toggle = page.getByRole("button", { name: "显示助手面板" });
  await expect(toggle).toBeVisible({ timeout: 120_000 });
  await toggle.click();
}

test("configures deterministic assistant model settings and enters the production empty state", async ({
  page,
}) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      externalRequests.push(request.url());
    }
  });

  await openAssistant(page);
  const assistant = page.getByRole("complementary", { name: "助手" });
  await expect(assistant).toBeVisible();
  await expect(assistant.getByText("需要设置模型")).toBeVisible();

  const setupButton = assistant.getByRole("button", { name: "打开模型设置" });
  await setupButton.click();
  const dialog = page.getByRole("dialog", { name: "设置" });
  await expect(dialog).toBeFocused();
  await expect(dialog.getByLabel("代理显示地址"))
    .toHaveValue("http://localhost:4141");
  await expect(dialog.getByLabel("接口模式")).toHaveValue("Responses API");

  await dialog.getByRole("button", { name: "测试连接" }).click();
  await expect(dialog.getByLabel("模型", { exact: true }))
    .toHaveValue("preshot-text");
  await expect(dialog.getByText("Preshot Vision (deterministic)")).toHaveCount(1);
  await expect(dialog.getByLabel("推理强度")).toBeVisible();
  await expect(dialog.getByLabel("推理摘要")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "验证图片支持" })).toBeVisible();

  await dialog.getByRole("button", { name: "验证图片支持" }).click();
  await expect(dialog.getByRole("button", { name: "验证图片支持" }))
    .toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(assistant.getByRole("button", {
    name: "更多助手操作",
  })).toBeFocused();

  await expect(assistant.getByText("从当前摄影计划开始")).toBeVisible();
  await expect(assistant.getByRole("button", { name: "开始新对话" }))
    .toBeVisible();
  await expect(assistant.getByLabel("向助手发送消息")).toBeDisabled();
  await expect(assistant.getByRole("button", { name: "发送" })).toBeDisabled();
  expect(externalRequests).toEqual([]);
});

test("preserves readiness and focus on equivalent URL blur, then invalidates real changes", async ({
  page,
}) => {
  await openAssistant(page);
  const assistant = page.getByRole("complementary", { name: "助手" });
  await assistant.getByRole("button", { name: "打开模型设置" }).click();
  const dialog = page.getByRole("dialog", { name: "设置" });
  await dialog.getByRole("button", { name: "测试连接" }).click();
  const proxy = dialog.getByLabel("代理显示地址");
  const model = dialog.getByLabel("模型", { exact: true });
  await expect(dialog.getByText("已验证").first()).toBeVisible();

  await proxy.focus();
  await page.keyboard.press("Tab");
  await expect(model).toBeFocused();
  await expect(assistant.getByText("需要设置模型")).toHaveCount(0);

  await proxy.fill("  http://localhost:4141/  ");
  await page.keyboard.press("Tab");
  await expect(proxy).toHaveValue("http://localhost:4141");
  await expect(model).toBeFocused();
  await expect(dialog.getByText("已验证").first()).toBeVisible();
  await expect(assistant.getByText("需要设置模型")).toHaveCount(0);

  await proxy.fill("http://127.0.0.1:4141/");
  await page.keyboard.press("Tab");
  await expect(dialog.getByText("需要重新测试")).toBeVisible();
  await expect(assistant.getByText("需要设置模型")).toBeVisible();

  await dialog.getByRole("button", { name: "测试连接" }).click();
  await expect(model).toHaveValue("preshot-text");
  await model.selectOption("preshot-vision");
  await expect(dialog.getByText("需要重新测试")).toBeVisible();
  await expect(assistant.getByText("需要设置模型")).toBeVisible();
});
