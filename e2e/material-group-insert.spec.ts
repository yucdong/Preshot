import { expect, test } from "@playwright/test";

test("selects gallery material images and inserts complete groups, subsets and independent images", async ({ page }) => {
  await page.goto("/e2e/fixtures/material-library.html?materialKind=imageGroup");
  const document = page.getByRole("group", { name: "方案正文", exact: true });
  await expect(document).toBeVisible();
  await page.getByRole("button", { name: "素材库", exact: true }).click();
  const library = page.getByRole("dialog", { name: "素材库", exact: true });
  await library.getByRole("button", { name: "编辑素材", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "编辑素材", exact: true });
  for (let index = 1; index <= 3; index++) {
    await edit.getByTitle("从文件添加图片", { exact: true }).click();
    await expect(edit.locator("[data-image-id]")).toHaveCount(index);
  }
  await edit.getByRole("button", { name: "保存素材", exact: true }).click();
  await expect(edit.getByRole("button", { name: "关闭编辑素材", exact: true })).toBeEnabled();
  await edit.getByRole("button", { name: "关闭编辑素材", exact: true }).click();
  const chooser = page.getByRole("dialog", { name: "插入图片组素材", exact: true });
  await library.getByRole("button", { name: "插入到当前文档", exact: true }).click();
  await expect(chooser.getByText("已选 3 / 3 张", { exact: true })).toBeVisible();
  await expect(chooser.locator("img")).toHaveCount(3);
  await chooser.getByRole("button", { name: "取消全选", exact: true }).click();
  await expect(chooser.getByRole("button", { name: "确认插入", exact: true })).toBeDisabled();
  await chooser.getByRole("button", { name: "全选", exact: true }).click();
  await chooser.getByRole("button", { name: "确认插入", exact: true }).click();
  await expect(library).toBeHidden();
  const groups = document.locator('[data-content-type="imageGroup"]');
  await expect(groups).toHaveCount(1);
  await expect(groups.first().locator("[data-image-id]")).toHaveCount(3);

  await page.getByRole("button", { name: "素材库", exact: true }).click();
  await library.getByRole("button", { name: "插入到当前文档", exact: true }).click();
  await chooser.getByRole("checkbox").nth(1).uncheck();
  await chooser.getByRole("checkbox").nth(2).uncheck();
  await chooser.getByRole("button", { name: "确认插入", exact: true }).click();
  await expect(library).toBeHidden();
  await expect(groups).toHaveCount(2);
  await expect(groups.last().locator("[data-image-id]")).toHaveCount(1);

  await page.getByRole("button", { name: "素材库", exact: true }).click();
  await library.getByRole("button", { name: "插入到当前文档", exact: true }).click();
  await chooser.getByRole("checkbox").nth(1).uncheck();
  await chooser.getByRole("radio", { name: "独立图片", exact: true }).check();
  await page.screenshot({ path: test.info().outputPath("selected-images.png"), animations: "disabled" });
  await chooser.getByRole("button", { name: "确认插入", exact: true }).click();
  await expect(library).toBeHidden();
  const images = document.locator('[data-content-type="image"] img.bn-visual-media');
  await expect(images).toHaveCount(2);
  await expect(images.first()).toBeVisible();
  await expect(images.last()).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect(images).toHaveCount(0);
  await expect(groups).toHaveCount(2);
  await page.keyboard.press("Control+Shift+z");
  await expect(images).toHaveCount(2);
});
