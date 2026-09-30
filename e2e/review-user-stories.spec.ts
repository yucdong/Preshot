import { expect, test } from "@playwright/test";

for (const action of ["delete", "restore", "unfavorite"] as const) {
  test(`library returns to a usable page after ${action} removes the last result`, async ({ page }, info) => {
    await page.goto(`/e2e/fixtures/material-library.html?pagination${action === "restore" ? "&trash" : ""}`);
    await page.getByRole("button", { name: "素材库", exact: true }).click();
    const library = page.getByRole("dialog", { name: "素材库", exact: true });
    if (action === "restore") await library.getByRole("button", { name: "回收站", exact: true }).click();
    if (action === "unfavorite") await library.getByRole("button", { name: "收藏", exact: true }).first().click();
    await library.getByRole("button", { name: "下一页", exact: true }).click();
    const items = library.getByRole("button", { name: /^选择素材：/ });
    await expect(items).toHaveCount(1);
    await items.click();
    if (action === "delete") {
      await library.getByRole("button", { name: "删除", exact: true }).click();
      await page.getByRole("button", { name: "确认删除", exact: true }).click();
    } else {
      await library.getByRole("button", { name: action === "restore" ? "恢复素材" : "取消收藏", exact: true }).click();
    }
    await expect(items).toHaveCount(50);
    await expect(library.getByRole("navigation", { name: "素材分页" })).toContainText("第 1 / 1 页");
    await expect(library.getByRole("button", { name: "上一页", exact: true })).toBeDisabled();
    await expect(library.getByRole("button", { name: "下一页", exact: true })).toBeDisabled();
    await page.screenshot({ path: info.outputPath(`${action}-page-recovered.png`) });
  });
}

test("settings keeps keyboard navigation in its dialog from the first Shift+Tab", async ({ page }, info) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "设置", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "设置", exact: true });
  await expect(dialog).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  for (let step = 0; step < 12; step++) {
    await page.keyboard.press("Tab");
    await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await page.screenshot({ path: info.outputPath("settings-keyboard-focus.png") });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
