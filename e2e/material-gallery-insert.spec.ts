import { expect, test } from "@playwright/test";

test("inserts selected library group images and single images into project and material groups", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/e2e/fixtures/material-library.html?materialKind=imageGroup");
  const document = page.getByRole("group", { name: "方案正文", exact: true });
  await expect(document).toBeVisible();
  await page.getByRole("button", { name: "素材库", exact: true }).click();
  const library = page.getByRole("dialog", { name: "素材库", exact: true });
  const edit = page.locator(".ml-content-editor-dialog");
  await library.getByRole("button", { name: "编辑素材", exact: true }).click();
  for (let index = 1; index <= 3; index++) {
    await edit.getByTitle("从文件添加图片", { exact: true }).click();
    await expect(edit.locator("[data-image-id]")).toHaveCount(index);
  }
  await edit.getByRole("button", { name: "保存素材", exact: true }).click();
  await expect(edit.getByRole("button", { name: "关闭编辑素材", exact: true })).toBeEnabled();
  await edit.getByRole("button", { name: "关闭编辑素材", exact: true }).click();
  await library.getByRole("button", { name: "插入到当前文档", exact: true }).click();
  const chooser = page.getByRole("dialog", { name: "插入图片组素材", exact: true });
  await chooser.getByRole("button", { name: "确认插入", exact: true }).click();
  await expect(library).toBeHidden();
  const target = document.locator('[data-content-type="imageGroup"]');
  await expect(target).toHaveCount(1);
  await expect(target.locator("[data-image-id]")).toHaveCount(3);

  await page.getByRole("button", { name: "素材库", exact: true }).click();
  await library.getByRole("button", { name: "创建素材", exact: true }).click();
  await page.getByRole("dialog", { name: "创建素材", exact: true }).getByRole("button", { name: "图片", exact: true }).click();
  await edit.getByRole("textbox", { name: "素材名称", exact: true }).fill("单张素材");
  await edit.getByTitle("从文件添加图片", { exact: true }).click();
  await edit.getByRole("button", { name: "保存素材", exact: true }).click();
  await expect(edit).toBeHidden();
  await expect(library.getByRole("button", { name: "选择素材：单张素材", exact: true })).toBeVisible();
  await library.getByRole("button", { name: "关闭素材库", exact: true }).click();

  await target.getByRole("button", { name: "从素材库插入", exact: true }).click();
  await expect(library.getByRole("button", { name: "模特", exact: true })).toHaveCount(0);
  await library.getByRole("button", { name: "选择素材：窗边光线", exact: true }).click();
  await library.getByRole("button", { name: "插入到当前图片组", exact: true }).click();
  await expect(chooser.getByRole("radio")).toHaveCount(0);
  await chooser.getByRole("checkbox").nth(1).uncheck();
  await chooser.getByRole("button", { name: "确认插入", exact: true }).click();
  await expect(library).toBeHidden();
  await expect(target).toHaveCount(1);
  await expect(target.locator("[data-image-id]")).toHaveCount(5);
  await page.keyboard.press("Control+z");
  await expect(target.locator("[data-image-id]")).toHaveCount(3);
  await page.keyboard.press("Control+Shift+z");
  await expect(target.locator("[data-image-id]")).toHaveCount(5);
  await target.getByRole("button", { name: "从素材库插入", exact: true }).click();
  await library.getByRole("button", { name: "选择素材：单张素材", exact: true }).click();
  await library.getByRole("button", { name: "插入到当前图片组", exact: true }).click();
  await expect(library).toBeHidden();
  await expect(target.locator("[data-image-id]")).toHaveCount(6);
  await expect(document.locator('[data-content-type="image"]')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("project-gallery.png"), animations: "disabled" });

  await page.getByRole("button", { name: "素材库", exact: true }).click();
  await library.getByRole("button", { name: "选择素材：窗边光线", exact: true }).click();
  await library.getByRole("button", { name: "编辑素材", exact: true }).click();
  await expect(edit.locator("[data-image-id]")).toHaveCount(3);
  await edit.getByRole("button", { name: "从素材库插入", exact: true }).click();
  await library.getByRole("button", { name: "选择素材：单张素材", exact: true }).click();
  await library.getByRole("button", { name: "插入到当前图片组", exact: true }).click();
  await expect(edit.locator("[data-image-id]")).toHaveCount(4);
  await edit.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(edit.locator("[data-image-id]")).toHaveCount(3);
  await edit.getByRole("button", { name: "重做", exact: true }).click();
  await expect(edit.locator("[data-image-id]")).toHaveCount(4);
  await edit.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("dialog", { name: "放弃素材修改？", exact: true }).getByRole("button", { name: "放弃修改", exact: true }).click();
  await library.getByRole("button", { name: "编辑素材", exact: true }).click();
  await expect(edit.locator("[data-image-id]")).toHaveCount(3);
  expect(errors).toEqual([]);
});
