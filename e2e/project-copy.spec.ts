import { expect, test, type Page } from "@playwright/test";

const sourceName = "南京长江大桥";
const copiedName = "南京独立副本";
const group = (page: Page) => page.getByRole("group", { name: "方案正文", exact: true });
async function dialog(page: Page, name = sourceName) {
  await page.getByRole("button", { name: `更多项目操作 ${name}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "复制项目", exact: true }).click();
  return page.getByRole("dialog", { name: "复制项目", exact: true });
}

test("copies latest text and card drafts, keeps source visible and sessions independent", async ({ page }) => {
  await page.goto("/e2e/fixtures/project-copy.html");
  await expect(group(page)).toBeVisible();
  await group(page).locator('[data-content-type="paragraph"]').first().fill("当前未保存的拍摄正文");
  await page.getByRole("textbox", { name: "道具信息", exact: true }).fill("透明伞与泡泡机，日落逆光");
  const modal = await dialog(page);
  await expect(page.locator('main:not([hidden]) [data-testid="plan-document-canvas"]')).toBeVisible();
  await expect(modal.getByRole("textbox", { name: "新项目名称" })).toBeFocused();
  await modal.getByRole("textbox", { name: "新项目名称" }).fill(copiedName);
  await expect(modal).toContainText(`C:\\Preshot Midscene Runs\\${copiedName}`);
  await page.screenshot({ path: test.info().outputPath("copy-dialog.png"), animations: "disabled" });
  await modal.getByRole("button", { name: "复制项目", exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByRole("button", { name: `关闭项目 ${sourceName}` })).toBeVisible();
  await expect(page.getByRole("button", { name: `关闭项目 ${copiedName}` })).toBeVisible();
  await expect(group(page)).toContainText("当前未保存的拍摄正文");
  await expect(page.getByRole("textbox", { name: "道具信息", exact: true })).toHaveValue("透明伞与泡泡机，日落逆光");
  await group(page).locator('[data-content-type="paragraph"]').first().fill("只改副本");
  await page.getByRole("region", { name: "打开项目", exact: true }).getByRole("button", { name: `打开项目 ${sourceName}`, exact: true }).click();
  await expect(group(page)).toContainText("当前未保存的拍摄正文");
  await page.getByRole("region", { name: "打开项目", exact: true }).getByRole("button", { name: `打开项目 ${copiedName}`, exact: true }).click();
  await expect(group(page)).toContainText("只改副本");
  await page.screenshot({ path: test.info().outputPath("independent-copy.png"), animations: "disabled" });
});

test("cancel cleans up the attempt, keyboard focus returns, and retry publishes once", async ({ page }) => {
  await page.goto("/e2e/fixtures/project-copy.html?slow");
  await expect(group(page)).toBeVisible();
  let modal = await dialog(page);
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  await expect(page.getByRole("button", { name: `更多项目操作 ${sourceName}`, exact: true })).toBeFocused();
  modal = await dialog(page);
  await modal.getByRole("button", { name: "复制项目", exact: true }).click();
  await expect(modal.getByRole("progressbar")).toBeVisible();
  await modal.getByRole("button", { name: "取消复制" }).click();
  await expect(modal.getByRole("alert")).toContainText("复制已取消");
  await modal.getByRole("button", { name: "重试复制" }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByRole("button", { name: `关闭项目 ${sourceName} - 副本`, exact: true })).toBeVisible();
  const names = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("preshot.midscene.projects")!)).map(v => (v as { name: string }).name));
  expect(names.filter(name => name.endsWith(" - 副本"))).toHaveLength(1);
});

test("copies background and closed projects, suggests unique names, and supports English keyboard navigation", async ({ page }) => {
  await page.goto("/e2e/fixtures/project-copy.html");
  await expect(group(page)).toBeVisible();
  let modal = await dialog(page);
  await modal.getByRole("button", { name: "复制项目", exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByRole("button", { name: `关闭项目 ${sourceName} - 副本`, exact: true })).toBeVisible();
  modal = await dialog(page); // The original is now open in the background.
  await expect(modal.getByRole("textbox", { name: "新项目名称" })).toHaveValue(`${sourceName} - 副本 2`);
  await modal.getByRole("button", { name: "复制项目", exact: true }).click();
  await expect(modal).toHaveCount(0);
  await page.getByRole("button", { name: `关闭项目 ${sourceName}`, exact: true }).click();
  await page.getByRole("button", { name: "保存并关闭", exact: true }).click();
  await expect(page.getByRole("button", { name: `关闭项目 ${sourceName}`, exact: true })).toHaveCount(0);
  modal = await dialog(page); // Closed source still registered in All projects.
  await expect(modal.getByRole("textbox", { name: "新项目名称" })).toHaveValue(`${sourceName} - 副本 3`);
  await modal.getByRole("button", { name: "复制项目", exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(group(page)).toContainText("桥上人像拍摄计划");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
  await page.getByRole("button", { name: `More project actions ${sourceName}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Copy project", exact: true }).click();
  const english = page.getByRole("dialog", { name: "Copy project", exact: true });
  await expect(english.getByRole("textbox", { name: "New project name", exact: true })).toBeFocused();
  await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
  await expect(english.getByRole("textbox", { name: "Destination folder", exact: true })).toBeFocused();
  await page.screenshot({ path: test.info().outputPath("copy-english.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(english).toHaveCount(0);
});

test("save failure stops copying and retains form input for a successful retry", async ({ page }) => {
  await page.goto("/e2e/fixtures/project-copy.html");
  await expect(group(page)).toBeVisible();
  await group(page).locator('[data-content-type="paragraph"]').first().fill("必须先保存的新正文");
  const modal = await dialog(page);
  await modal.getByRole("textbox", { name: "新项目名称" }).fill("失败后重试的副本");
  await page.evaluate(() => (window as unknown as { __PRESHOT_COPY_TEST__: { failNextSave(): void } }).__PRESHOT_COPY_TEST__.failNextSave());
  await modal.getByRole("button", { name: "复制项目", exact: true }).click();
  await expect(modal.getByRole("alert")).toContainText("测试保存失败");
  await expect(modal.getByRole("textbox", { name: "新项目名称" })).toHaveValue("失败后重试的副本");
  const before = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("preshot.midscene.projects")!)).map(v => (v as { name: string }).name));
  expect(before).not.toContain("失败后重试的副本");
  await modal.getByRole("button", { name: "重试复制" }).click();
  await expect(modal).toHaveCount(0);
  await expect(group(page)).toContainText("必须先保存的新正文");
});
