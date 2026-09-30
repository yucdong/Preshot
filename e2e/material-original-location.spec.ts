import { expect, test } from "@playwright/test";

test("image-group originals open without image selection in details, editor and full preview", async ({ page }) => {
  const errors: string[] = [];
  const reveals: Array<{ sessionId?: string; id?: string; revision?: number }> = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.exposeFunction("recordOriginalReveal", (detail: typeof reveals[number]) => reveals.push(detail));
  await page.addInitScript(() => {
    window.addEventListener("fixture-original-revealed", (event) => {
      void (window as unknown as { recordOriginalReveal: (detail: unknown) => Promise<void> })
        .recordOriginalReveal((event as CustomEvent).detail);
    });
  });
  await page.goto("/e2e/fixtures/material-library.html?materialKind=imageGroup&revealOriginal=1");
  await page.getByRole("button", { name: "素材库", exact: true }).click();
  const browser = page.getByRole("dialog", { name: "素材库", exact: true });
  await browser.getByRole("button", { name: "编辑素材", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "编辑素材", exact: true });
  const reveal = editor.getByRole("button", { name: "打开原图所在位置", exact: true });
  await expect(reveal).toBeEnabled();
  await reveal.click();
  await expect.poll(() => reveals.length).toBe(1);
  expect(reveals[0].sessionId).toBeTruthy();
  for (let i = 1; i <= 2; i++) {
    await editor.getByRole("button", { name: "添加图片", exact: true }).first().click();
    await expect(editor.getByRole("button", { name: `选择参考图 ${i}`, exact: true })).toBeEnabled();
  }
  await page.screenshot({ path: test.info().outputPath("original-location-editor.png"), animations: "disabled" });
  await editor.getByRole("button", { name: "保存素材", exact: true }).click();
  await expect(editor.getByText("素材已保存，可继续编辑；关闭后更新预览。")).toBeVisible();
  await editor.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(editor).toBeHidden();
  await browser.getByRole("button", { name: "打开原图所在位置", exact: true }).click();
  await expect.poll(() => reveals.length).toBe(2);
  expect(reveals[1]).toEqual({ id: "9bcd08d4-05e8-4b70-ad27-ac8da95752e4", revision: 2 });
  await page.screenshot({ path: test.info().outputPath("original-location-details.png"), animations: "disabled" });
  await browser.getByRole("button", { name: "预览", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "完整组件预览", exact: true });
  const previewReveal = preview.getByRole("button", { name: "打开原图所在位置", exact: true });
  await expect(previewReveal).toBeEnabled();
  await expect(preview.getByText("请先选择一张图片")).toHaveCount(0);
  await previewReveal.click();
  await expect.poll(() => reveals.length).toBe(3);
  expect(reveals[2]).toEqual(reveals[1]);
  await page.screenshot({ path: test.info().outputPath("original-location-preview.png"), animations: "disabled" });
  expect(errors).toEqual([]);
});
