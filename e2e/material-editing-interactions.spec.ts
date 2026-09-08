import { expect, test } from "@playwright/test";

const variants = [
  { kind: "imageGroup", text: "图片组说明", gallery: "图片组" },
  { kind: "modelCard", text: "其他信息", gallery: "样片" },
  { kind: "shootingLocation", text: "场地信息", gallery: "场地图片" },
  { kind: "clothing", text: "服装信息", gallery: "服装图片" },
  { kind: "prop", text: "道具信息", gallery: "道具图片" },
];

for (const variant of variants) {
  test(`${variant.kind}: visible caret, native text selection and unobstructed gallery actions`, async ({ page }) => {
    await page.goto(`/e2e/fixtures/material-library.html?materialKind=${variant.kind}`);
    await page.getByRole("button", { name: "素材库", exact: true }).click();
    const library = page.getByRole("dialog", { name: "素材库", exact: true });
    await library.getByRole("button", { name: "编辑素材", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "编辑素材", exact: true });
    const fields = editor.locator('input:not([type="checkbox"]), textarea');
    await expect(fields.first()).toBeVisible();
    await editor.locator(".bn-editor").focus();
    await page.keyboard.press("Control+a");
    for (const field of await fields.all()) {
      await field.click();
      await expect(field).toBeFocused();
      await expect.soft(field).toHaveCSS("caret-color", "rgb(24, 24, 27)", { timeout: 500 });
      await expect.soft(field).toHaveCSS("cursor", "text", { timeout: 500 });
      await expect.soft(field).toHaveCSS("user-select", "text", { timeout: 500 });
    }
    const text = editor.getByRole("textbox", { name: variant.text, exact: true });
    await text.fill("可以自由编辑文字，保留光标与选区。");
    await text.press("Home");
    await text.press("Shift+ArrowRight");
    await text.press("Shift+ArrowRight");
    expect(await text.evaluate((field: HTMLTextAreaElement) =>
      field.value.slice(field.selectionStart, field.selectionEnd))).toBe("可以");
    await page.keyboard.insertText("好");
    await expect(text).toHaveValue("好自由编辑文字，保留光标与选区。");
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await text.press("Home");
    await text.press("Shift+ArrowRight");
    await text.press("Shift+ArrowRight");
    await text.press("Control+c");
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("好自");
    await text.press("Control+x");
    await expect(text).toHaveValue("由编辑文字，保留光标与选区。");
    await text.press("Control+v");
    await expect(text).toHaveValue("好自由编辑文字，保留光标与选区。");
    await text.press("End");
    await text.pressSequentially("!");
    await text.press("Control+z");
    await expect(text).toHaveValue("好自由编辑文字，保留光标与选区。");
    await text.fill("可以自由编辑文字，保留光标与选区。");
    const box = (await text.boundingBox())!;
    await page.mouse.move(box.x + 12, box.y + 14);
    await page.mouse.down();
    await page.mouse.move(box.x + Math.min(120, box.width - 16), box.y + 14, { steps: 12 });
    await page.mouse.up();
    expect(await text.evaluate((field: HTMLTextAreaElement) => field.selectionEnd - field.selectionStart)).toBeGreaterThan(0);
    const selection = await text.evaluate((field) => ({
      color: getComputedStyle(field, "::selection").color,
      background: getComputedStyle(field, "::selection").backgroundColor,
    }));
    expect.soft(selection.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(selection.color).toBe("rgb(255, 255, 255)");
    const selectionContrast = await text.evaluate((field) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d")!;
      context.fillStyle = getComputedStyle(field, "::selection").backgroundColor;
      context.fillRect(0, 0, 1, 1);
      const rgb = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 1.05 / (rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 + 0.05);
    });
    expect(selectionContrast).toBeGreaterThanOrEqual(4.5);
    await editor.locator(".ml-content-canvas-scroller").evaluate((element) => element.scrollTo({ top: 0 }));
    await page.screenshot({ path: test.info().outputPath(`${variant.kind}-text-selection.png`), animations: "disabled" });
    await expect(editor.locator(".bn-block-content")).toHaveCount(1);
    await expect.soft(editor.getByRole("button", { name: "截图", exact: true })).toBeVisible({ timeout: 500 });
    for (const width of [960, 1280, 1600]) {
      await page.setViewportSize({ width, height: 900 });
      await editor.getByRole("button", { name: "适应宽度", exact: true }).click();
      const count = editor.getByText("0 张图片", { exact: true });
      const toolbar = editor.locator(".preshot-blocknote-image-group-toolbar");
      const countBox = (await count.boundingBox())!;
      const actionsBox = (await toolbar.boundingBox())!;
      const overlap = Math.min(countBox.x + countBox.width, actionsBox.x + actionsBox.width) > Math.max(countBox.x, actionsBox.x) &&
        Math.min(countBox.y + countBox.height, actionsBox.y + actionsBox.height) > Math.max(countBox.y, actionsBox.y);
      expect.soft(overlap).toBe(false);
      const heading = (await editor.locator(".preshot-image-group-heading").boundingBox())!;
      const images = (await editor.locator("[data-image-group-id]").boundingBox())!;
      expect(images.y).toBeGreaterThanOrEqual(heading.y + heading.height);
      expect(Math.abs(actionsBox.x + actionsBox.width - heading.x - heading.width)).toBeLessThan(2);
    }
  });

  test(`${variant.kind}: screenshot cancel, capture, undo and saved draft reopen`, async ({ page }) => {
    await page.goto(`/e2e/fixtures/material-library.html?materialKind=${variant.kind}`);
    await page.getByRole("button", { name: "素材库", exact: true }).click();
    const library = page.getByRole("dialog", { name: "素材库", exact: true });
    await library.getByRole("button", { name: "编辑素材", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "编辑素材", exact: true });
    const capture = editor.getByRole("button", { name: "截图", exact: true });
    const native = page.getByRole("dialog", { name: "模拟 Windows 截图", exact: true });
    await capture.click();
    await expect(native).toBeVisible();
    await expect(editor.getByRole("button", { name: "保存素材", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(native).toBeHidden();
    await expect(capture).toBeFocused();
    await expect(editor.locator("[data-image-id]")).toHaveCount(0);
    await expect(editor.getByRole("button", { name: "保存素材", exact: true })).toBeDisabled();
    await capture.click();
    await native.getByRole("button", { name: "完成测试截图", exact: true }).click();
    await expect(editor.locator("[data-image-id]")).toHaveCount(1);
    const src = await editor.getByRole("button", { name: "选择参考图 1", exact: true }).locator("img").getAttribute("src");
    await editor.getByRole("button", { name: "撤销", exact: true }).click();
    await expect(editor.locator("[data-image-id]")).toHaveCount(0);
    await editor.getByRole("button", { name: "重做", exact: true }).click();
    await expect(editor.locator("[data-image-id]")).toHaveCount(1);
    await page.screenshot({ path: test.info().outputPath(`${variant.kind}-captured-image.png`), animations: "disabled" });
    await editor.getByRole("button", { name: "保存素材", exact: true }).click();
    await expect(editor.getByText("素材已保存，可继续编辑；关闭后更新预览。")).toBeVisible();
    await expect(editor.getByRole("button", { name: "选择参考图 1", exact: true }).locator("img")).toHaveAttribute("src", src!);
    await editor.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(editor).toBeHidden({ timeout: 30_000 });
    await library.getByRole("button", { name: "编辑素材", exact: true }).click();
    await expect(editor.getByRole("button", { name: "选择参考图 1", exact: true }).locator("img")).toHaveAttribute("src", src!);
    await expect(editor.getByRole("button", { name: "保存素材", exact: true })).toBeDisabled();
  });
}
