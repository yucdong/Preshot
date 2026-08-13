import { expect, test } from "@playwright/test";

test("Ctrl+Z removes an inserted image group and Ctrl+Shift+Z restores it", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("plan-document-canvas")).toBeVisible();
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改", {
    timeout: 10_000,
  });

  const before = await page.locator("[data-image-group-id]").count();

  await page.getByRole("button", { name: /^插入$/ }).dispatchEvent("click");
  await page.getByRole("menuitem", { name: "图片组" }).dispatchEvent("click");
  await expect(page.locator("[data-image-group-id]")).toHaveCount(before + 1);

  // Move focus to a neutral (non-editor) element so Ctrl+Z is global, not TipTap's.
  await page.getByTestId("save-status").click();

  await page.keyboard.press("Control+z");
  await expect(page.locator("[data-image-group-id]")).toHaveCount(before);

  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator("[data-image-group-id]")).toHaveCount(before + 1);

  await expect(page.getByRole("button", { name: "撤销" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "重做" })).toHaveCount(0);
});
