import { expect, test } from "@playwright/test";

test("creates a project from one dialog with an editable parent directory", async ({ page }, testInfo) => {
  await page.goto("/e2e/fixtures/project-loading.html");
  await expect(page.getByRole("group", { name: "方案正文" })).toBeVisible();
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveCount(1);
  await expect(dialog.getByLabel("项目所在路径")).toHaveValue("C:\\Preshot Midscene Runs");
  await expect(dialog.getByLabel("项目名称")).toBeFocused();
  await dialog.getByLabel("项目所在路径").fill("D:\\拍摄项目");
  await dialog.getByLabel("项目名称").fill("单窗新建");
  await expect(dialog).toContainText("项目文件夹的上级目录");
  await expect(dialog).toContainText("将创建：D:\\拍摄项目\\单窗新建");
  await page.screenshot({ path: testInfo.outputPath("new-project-dialog.png") });
  await dialog.getByRole("button", { name: "创建项目", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("group", { name: "方案正文" })).toBeVisible();
  await expect(page.getByRole("region", { name: "打开项目", exact: true }).getByRole("button", { name: "打开项目 单窗新建" })).toHaveAttribute("aria-current", "page");
});

test("auto-opens the most recently edited project into the workspace", async ({ page }) => {
  await page.goto("/");

  const nav = page.getByRole("navigation", { name: "项目" });
  await expect(
    nav.getByRole("region", { name: "打开项目", exact: true }).getByRole("button", { name: "打开项目 编辑大片示例" }),
  ).toHaveAttribute("aria-current", "page");

  // Assert the canvas is rendered (not the old plan panel)
  await expect(page.getByTestId("plan-document-canvas")).toBeVisible();
  await expect(page.getByText("BlockNote Canvas v15", { exact: true })).toHaveCount(0);
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`project switch progress respects ${reducedMotion} motion and clears when ready`, async ({ page }, testInfo) => {
    await page.emulateMedia({
      reducedMotion,
      colorScheme: reducedMotion === "reduce" ? "dark" : "light",
    });
    await page.goto("/e2e/fixtures/project-loading.html");
    await expect(page.getByRole("group", { name: "方案正文" })).toBeVisible();
    await expect(page.getByRole("progressbar")).toHaveCount(0);
    const header = page.getByRole("banner");
    const headerBox = await header.boundingBox();
    await page.evaluate(() => window.__PRESHOT_PROJECT_LOADING__.pause());
    await page.getByRole("button", { name: "打开项目 Preshot 入门示例" }).click();
    const progress = page.getByRole("progressbar", { name: "项目加载进度" });
    await expect(progress).toBeVisible();
    await expect(progress).toHaveAttribute("aria-valuenow", "12");
    await expect(page.getByRole("group", { name: "方案正文" })).toBeHidden();
    await expect(page.locator('nav[aria-label="项目"]')).toHaveAttribute("inert");
    expect(await header.boundingBox()).toEqual(headerBox);
    await expect(page.getByText("BlockNote Canvas v15", { exact: true })).toHaveCount(0);
    const indicator = page.getByTestId("project-loading-fill");
    await page.screenshot({ path: testInfo.outputPath(`progress-${reducedMotion}.png`) });
    if (reducedMotion === "reduce") {
      await page.emulateMedia({ forcedColors: "active" });
      const segmentColor = await indicator.evaluate((element) => getComputedStyle(element).backgroundColor);
      const trackColor = await progress.evaluate((element) => getComputedStyle(element).backgroundColor);
      expect(segmentColor).not.toBe(trackColor);
    }
    await page.evaluate(() => window.__PRESHOT_PROJECT_LOADING__.resume());
    await expect(page.getByRole("group", { name: "方案正文" })).toBeVisible();
    await expect(progress).toHaveCount(0);
    await expect(page.getByRole("region", { name: "打开项目", exact: true }).getByRole("button", { name: "打开项目 Preshot 入门示例" }))
      .toHaveAttribute("aria-current", "page");
  });
}

test("failed project loading stays below 100 and retries without showing a partial page", async ({ page }) => {
  await page.goto("/e2e/fixtures/project-loading.html");
  await expect(page.getByRole("group", { name: "方案正文" })).toBeVisible();
  await page.evaluate(() => window.__PRESHOT_PROJECT_LOADING__.failNextPlan());
  await page.getByRole("button", { name: "打开项目 Preshot 入门示例" }).click();
  await expect(page.getByRole("alert")).toContainText("示例项目读取失败，请重试");
  const progress = page.getByRole("progressbar", { name: "项目加载进度" });
  expect(Number(await progress.getAttribute("aria-valuenow"))).toBeLessThan(100);
  await expect(page.getByRole("group", { name: "方案正文" })).toBeHidden();
  await page.getByRole("button", { name: "重试加载" }).click();
  await expect(page.getByRole("group", { name: "方案正文" })).toBeVisible();
  await expect(progress).toHaveCount(0);
});

test("switches between open projects without reloading and retains the editor and scroll", async ({ page }, testInfo) => {
  await page.goto("/e2e/fixtures/project-loading.html");
  const editor = page.locator(".bn-editor:visible");
  await expect(editor).toBeVisible();
  await editor.locator("p").last().click();
  await page.keyboard.type("保留打开项目的内容");
  const firstEditor = await editor.elementHandle();
  const firstScroller = page.locator('[data-testid="canvas-scroller"]:visible');
  await firstScroller.evaluate((element) => { element.scrollTop = 100; });
  const scrollTop = await firstScroller.evaluate((element) => element.scrollTop);
  await page.getByRole("region", { name: "所有项目" }).getByRole("button", { name: "打开项目 Preshot 入门示例" }).click();
  await expect(page.getByRole("region", { name: "打开项目", exact: true }).getByRole("button", { name: /^关闭项目 / })).toHaveCount(2);
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  // This gate would keep the loading card open if switching performed another read.
  await page.evaluate(() => window.__PRESHOT_PROJECT_LOADING__.pause());
  await page.getByRole("region", { name: "打开项目", exact: true }).getByRole("button", { name: "打开项目 进度条示例" }).click();
  await expect(editor).toContainText("保留打开项目的内容");
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  expect(await editor.evaluate((element, original) => element === original, firstEditor)).toBe(true);
  expect(await firstScroller.evaluate((element) => element.scrollTop)).toBe(scrollTop);
  await page.screenshot({ path: testInfo.outputPath("open-projects.png") });
  await page.getByRole("button", { name: "关闭项目 Preshot 入门示例" }).click();
  const closeDialog = page.getByRole("dialog", { name: "关闭“Preshot 入门示例”前是否保存？" });
  await expect(closeDialog).toBeVisible();
  await closeDialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("region", { name: "打开项目", exact: true }).getByRole("button", { name: /^关闭项目 / })).toHaveCount(2);
  await page.getByRole("button", { name: "关闭项目 Preshot 入门示例" }).click();
  await closeDialog.getByRole("button", { name: "保存并关闭", exact: true }).click();
  await expect(page.getByRole("region", { name: "打开项目", exact: true }).getByRole("button", { name: /^关闭项目 / })).toHaveCount(1);
  await expect(page.getByRole("region", { name: "所有项目" }).getByRole("button", { name: "打开项目 Preshot 入门示例" })).toBeVisible();
});
