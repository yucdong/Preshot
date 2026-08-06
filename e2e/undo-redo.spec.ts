import { expect, test } from "@playwright/test";

const FRAME = '[data-component-frame="true"]';

test("Ctrl+Z removes an inserted component and Ctrl+Shift+Z restores it", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("plan-canvas")).toBeVisible();
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改");

  const before = await page.locator(FRAME).count();

  await page.getByRole("button", { name: "插入组件" }).click();
  await page.getByRole("menuitem", { name: "文案" }).click();
  await expect(page.locator(FRAME)).toHaveCount(before + 1);

  // Move focus to a neutral (non-editor) element so Ctrl+Z is global, not BlockNote's.
  await page.getByTestId("save-status").click();

  await page.keyboard.press("Control+z");
  await expect(page.locator(FRAME)).toHaveCount(before);

  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator(FRAME)).toHaveCount(before + 1);

  await expect(page.getByRole("button", { name: "撤销" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "重做" })).toHaveCount(0);
});
