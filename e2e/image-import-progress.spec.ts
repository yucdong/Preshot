import { expect, test, type Page } from "@playwright/test";

interface ImportControls {
  pendingImage: boolean;
  pendingSave: boolean;
  importCount: number;
  completeImage(): void;
  failImage(): void;
  completeSave(): void;
  cancelNextPicker(): void;
}
declare global { interface Window { __PRESHOT_IMPORT_TEST__: ImportControls } }
const gallery = (page: Page) => page.getByRole("group", { name: "图片组组件", exact: true }).first();
const bar = (page: Page) => page.getByRole("progressbar", { name: "图片加载进度" });
async function completeImage(page: Page) {
  await page.waitForFunction(() => window.__PRESHOT_IMPORT_TEST__.pendingImage);
  await page.evaluate(() => window.__PRESHOT_IMPORT_TEST__.completeImage());
}

test("real editor shows batch counts in narrow columns, waits for commit, and clears without a delay", async ({ page }) => {
  await page.goto("/e2e/fixtures/image-import-progress.html?columns");
  await gallery(page).getByRole("button", { name: "添加图片", exact: true }).first().click();
  await expect(bar(page)).toHaveAttribute("value", "0");
  await expect(bar(page)).toHaveAttribute("max", "3");
  await expect(gallery(page).getByRole("button", { name: "添加图片", exact: true }).first()).toBeDisabled();
  await completeImage(page);
  await expect(bar(page)).toHaveAttribute("value", "1");
  await expect(page.getByText("正在加载图片… 1 / 3", { exact: true })).toBeVisible();
  const bounds = await bar(page).boundingBox();
  const groupBounds = await gallery(page).boundingBox();
  expect(bounds!.width).toBeGreaterThan(60);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(groupBounds!.x + groupBounds!.width + 1);
  await page.screenshot({ path: test.info().outputPath("loading-columns.png"), animations: "disabled" });
  await completeImage(page);
  await expect(bar(page)).toHaveAttribute("value", "2");
  await completeImage(page);
  await page.waitForFunction(() => window.__PRESHOT_IMPORT_TEST__.pendingSave);
  await expect(page.getByText("图片已加载，正在完成…", { exact: true })).toBeVisible();
  await expect(bar(page)).not.toHaveAttribute("value");
  await expect(gallery(page).getByRole("button", { name: "选择参考图 1", exact: true })).toHaveCount(0);
  await page.evaluate(() => window.__PRESHOT_IMPORT_TEST__.completeSave());
  await expect(bar(page)).toHaveCount(0);
  await expect(gallery(page).getByRole("button", { name: "选择参考图 3", exact: true })).toBeVisible();
  await expect.poll(() => gallery(page).locator("img").evaluateAll(images =>
    images.length === 3 && images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true);
  await expect(gallery(page).getByRole("button", { name: "添加图片", exact: true }).first()).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath("loaded-columns.png"), animations: "disabled" });
});

test("failure and picker cancellation clear progress and allow a fresh batch", async ({ page }) => {
  await page.goto("/e2e/fixtures/image-import-progress.html");
  const add = gallery(page).getByRole("button", { name: "添加图片", exact: true }).first();
  await add.click();
  await completeImage(page);
  await expect(bar(page)).toHaveAttribute("value", "1");
  await page.waitForFunction(() => window.__PRESHOT_IMPORT_TEST__.pendingImage);
  await page.evaluate(() => window.__PRESHOT_IMPORT_TEST__.failImage());
  await expect(page.getByText(/测试图片读取失败/)).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
  await expect(add).toBeEnabled();
  await expect(gallery(page).getByRole("button", { name: "选择参考图 1", exact: true })).toHaveCount(0);
  await page.evaluate(() => window.__PRESHOT_IMPORT_TEST__.cancelNextPicker());
  await add.click();
  await expect(bar(page)).toHaveCount(0);
  await expect(add).toBeEnabled();
  expect(await page.evaluate(() => window.__PRESHOT_IMPORT_TEST__.importCount)).toBe(2);
  await add.click();
  await expect(bar(page)).toHaveAttribute("value", "0");
});
