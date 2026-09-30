import { expect, test, type Page } from "@playwright/test";

async function openEditor(page: Page, query: string) {
  await page.goto(`/e2e/fixtures/material-library.html?materialKind=shootingLocation&${query}`);
  await page.getByRole("button", { name: "素材库", exact: true }).click();
  await page.getByRole("dialog", { name: "素材库", exact: true }).getByRole("button", { name: "编辑素材", exact: true }).click();
  return page.getByRole("dialog", { name: "编辑素材", exact: true });
}

for (const width of [960, 1280]) test(`wide location screenshot at ${width}px fits, remains deletable, confirms Delete and survives save/reopen`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const editor = await openEditor(page, "wideCapture");
  await editor.getByRole("button", { name: "截图", exact: true }).click();
  await page.getByRole("dialog", { name: "模拟 Windows 截图" }).getByRole("button", { name: "完成测试截图" }).click();
  const tile = editor.locator("[data-image-id]");
  await expect(tile).toHaveCount(1);
  const image = editor.getByRole("button", { name: "选择参考图 1", exact: true });
  await image.click();
  const remove = editor.getByRole("button", { name: "删除选中图片", exact: true });
  await expect(remove).toBeInViewport();
  const geometry = await tile.evaluate(element => {
    const frame = element.getBoundingClientRect();
    const gallery = element.closest("[data-image-group-id]")!.getBoundingClientRect();
    const img = element.querySelector("img")!;
    return { left: frame.left, right: frame.right, galleryLeft: gallery.left, galleryRight: gallery.right,
      naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(geometry.galleryLeft);
  expect(geometry.right).toBeLessThanOrEqual(geometry.galleryRight + 1);
  expect(geometry.naturalWidth / geometry.naturalHeight).toBe(6);
  await page.screenshot({ path: test.info().outputPath("wide-capture-delete-visible.png"), animations: "disabled" });
  await image.press("Delete");
  const confirm = page.getByRole("dialog", { name: "删除图片？", exact: true });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "取消", exact: true }).click();
  await expect(tile).toHaveCount(1);
  await image.press("Delete");
  await confirm.getByRole("button", { name: "删除", exact: true }).click();
  await expect(tile).toHaveCount(0);
  await editor.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(tile).toHaveCount(1);
  await editor.getByRole("button", { name: "重做", exact: true }).click();
  await expect(tile).toHaveCount(0);
  await editor.getByRole("button", { name: "撤销", exact: true }).click();
  const field = editor.getByRole("textbox", { name: "场地信息", exact: true });
  await field.fill("保留文字");
  await field.press("Home");
  await field.press("Delete");
  await expect(field).toHaveValue("留文字");
  await expect(confirm).toBeHidden();
  await editor.getByRole("button", { name: "保存素材", exact: true }).click();
  await expect(editor.getByText("素材已保存，可继续编辑；关闭后更新预览。")).toBeVisible();
  await editor.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("dialog", { name: "素材库", exact: true }).getByRole("button", { name: "编辑素材", exact: true }).click();
  await expect(tile).toHaveCount(1);
  await image.click();
  await remove.click();
  await expect(confirm).toBeVisible();
});

test("suspicious screenshot review supports keyboard cancellation, retry and explicit keep", async ({ page }) => {
  const editor = await openEditor(page, "suspectCapture");
  const capture = editor.getByRole("button", { name: "截图", exact: true });
  const native = page.getByRole("dialog", { name: "模拟 Windows 截图", exact: true });
  const review = page.getByRole("dialog", { name: "检查截图", exact: true });
  await capture.click();
  await native.getByRole("button", { name: "完成测试截图" }).click();
  await expect(review.getByRole("button", { name: "重新截图", exact: true })).toBeFocused();
  await expect(editor.locator("[data-image-id]")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("suspect-capture-review.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(review).toBeHidden();
  await expect(capture).toBeEnabled();
  await capture.click();
  await native.getByRole("button", { name: "完成测试截图" }).click();
  await review.getByRole("button", { name: "重新截图", exact: true }).click();
  await expect(native).toBeVisible();
  await expect(editor.locator("[data-image-id]")).toHaveCount(0);
  await native.getByRole("button", { name: "完成测试截图" }).click();
  await review.getByRole("button", { name: "保留截图", exact: true }).click();
  await expect(review).toBeHidden();
  await expect(editor.locator("[data-image-id]")).toHaveCount(1);
  await editor.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(editor.locator("[data-image-id]")).toHaveCount(0);
});
