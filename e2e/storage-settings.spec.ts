import { expect, test } from "@playwright/test";

test("first launch chooses the data root and bilingual settings preserve the project", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 1100, height: 850 });
  await page.goto("/e2e/fixtures/storage.html");
  await expect(page.getByRole("heading", { name: "Preshot 首次启动设置" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "项目内容" })).toHaveCount(0);
  await expect(page.getByText("程序安装目录", { exact: true })).toHaveCount(0);
  await expect(page.getByText("当前素材库目录", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("first-launch.png") });
  await page.getByRole("textbox", { name: "项目工作路径", exact: true }).fill("D:\\摄影工作目录");
  await page.getByRole("button", { name: "使用此目录并继续" }).click();
  await page.getByRole("button", { name: "打开设置" }).click();
  await expect(page.getByText("D:\\摄影工作目录\\library", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "将素材库迁移到此目录" })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("storage-settings-zh.png") });
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Storage locations" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("storage-settings-en.png") });
  const lastAction = page.getByRole("button", { name: "Check again", exact: true });
  await lastAction.scrollIntoViewIfNeeded();
  await expect(lastAction).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("storage-settings-en-scrolled.png") });
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "项目内容" })).toHaveValue("保留未保存编辑");
  expect(errors).toEqual([]);
});

test("detected data offers keep or switch, with a keyboard-accessible confirmation", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 720, height: 620 });
  await page.goto("/e2e/fixtures/storage.html?scenario=existing");
  await expect(page.getByText("检测到已有项目工作路径，是否切换？")).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("existing-working-directory.png") });
  await page.getByRole("button", { name: "切换项目工作路径" }).click();
  const path = page.getByRole("textbox", { name: "项目工作路径", exact: true });
  await path.fill("D:\\摄影工作目录");
  await page.getByRole("button", { name: "使用此目录并继续" }).click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toContainText("旧文件不会被删除");
  await expect(page.getByRole("button", { name: "返回修改" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  const submit = page.getByRole("button", { name: "确认切换并继续" });
  await expect(submit).toBeFocused();
  await expect(submit).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("confirm-switch-zh.png") });
  await page.keyboard.press("Escape");
  await expect(path).toHaveValue("D:\\摄影工作目录");
  await expect(path).toBeFocused();
  await page.getByRole("button", { name: "使用此目录并继续" }).click();
  await submit.click();
  await expect(page.getByRole("textbox", { name: "项目内容" })).toBeVisible();
  await page.getByRole("button", { name: "打开设置" }).click();
  await expect(page.getByText("D:\\摄影工作目录\\library", { exact: true })).toBeVisible();
});

test("keep existing data and confirmed launches go straight to the workspace", async ({ page }) => {
  await page.goto("/e2e/fixtures/storage.html?scenario=existing");
  await page.getByRole("button", { name: "继续使用已有路径" }).click();
  await expect(page.getByRole("textbox", { name: "项目内容" })).toBeVisible();
  await page.goto("/e2e/fixtures/storage.html?scenario=confirmed");
  await expect(page.getByRole("textbox", { name: "项目内容" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Preshot 首次启动设置" })).toHaveCount(0);
});

test("English setup and confirmation fit a low window", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 640, height: 540 });
  await page.goto("/e2e/fixtures/storage.html?scenario=existing&lang=en");
  await expect(page.getByRole("button", { name: "Keep existing directory" })).toBeVisible();
  await page.getByRole("button", { name: "Change working directory" }).click();
  await page.getByRole("textbox", { name: "Project working directory", exact: true }).fill("D:\\Photo workspace");
  await page.getByRole("button", { name: "Use this directory and continue" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Old files are not deleted, moved or merged.");
  await expect(page.getByRole("button", { name: "Confirm switch and continue" })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("confirm-switch-en.png") });
});

test("an unavailable library has a visible recovery path without entering the workspace", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 960, height: 640 });
  await page.goto("/e2e/fixtures/storage.html?scenario=missing");
  await expect(page.getByRole("alert")).toContainText("数据目录暂不可用");
  await expect(page.getByRole("button", { name: "将素材库迁移到此目录" })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("missing-drive.png") });
  await page.getByRole("button", { name: "重新检查", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "项目内容" })).toHaveCount(0);
});
