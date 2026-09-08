import { expect, test } from "@playwright/test";

test("auto-opens the most recently edited project into the workspace", async ({ page }) => {
  await page.goto("/");

  const nav = page.getByRole("navigation", { name: "项目" });
  await expect(
    nav.getByRole("button", { name: "打开项目 编辑大片示例" }),
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
    await expect(progress).toHaveAttribute("aria-valuenow", "100");
    await expect(page.getByRole("group", { name: "方案正文" })).toBeHidden();
    await expect(page.getByRole("group", { name: "方案正文" })).toBeVisible();
    await expect(progress).toHaveCount(0);
    await expect(page.getByRole("button", { name: "打开项目 Preshot 入门示例" }))
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
  await expect(progress).toHaveAttribute("aria-valuenow", "100");
  await expect(page.getByRole("group", { name: "方案正文" })).toBeHidden();
  await expect(page.getByRole("group", { name: "方案正文" })).toBeVisible();
  await expect(progress).toHaveCount(0);
});
