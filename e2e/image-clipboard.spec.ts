import { expect, test, type Locator } from "@playwright/test";
import type {} from "./fixtures/imageClipboardTestControls";

async function seedKeyboardClipboard(image: Locator) {
  await image.evaluate(async element => {
    if (!(element instanceof HTMLImageElement) || !element.src.startsWith("data:image/png;base64,")) {
      throw new Error("Keyboard paste requires the synthetic PNG fixture");
    }
    const blob = await (await fetch(element.src)).blob();
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  });
}

for (const method of ["keyboard", "context menu"] as const) {
test(`copies material images using ${method} into independent native images`, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  if (method === "keyboard") await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/e2e/fixtures/material-library.html?clipboard=1");
  await expect(page.getByRole("group", { name: "方案正文", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "素材库", exact: true }).click();
  const library = page.getByRole("dialog", { name: "素材库", exact: true });
  await library.getByRole("button", { name: "编辑素材", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "编辑素材", exact: true });
  await edit.getByTitle("从文件添加图片", { exact: true }).click();
  const original = edit.getByRole("button", { name: "选择参考图 1", exact: true });
  if (method === "keyboard") {
    await original.click();
    await page.keyboard.press("Control+c");
  } else {
    await original.click({ button: "right" });
    await edit.getByRole("menuitem", { name: /复制图片/ }).click();
  }
  await expect.poll(() => page.evaluate(() => window.__PRESHOT_IMAGE_CLIPBOARD_TEST__?.copied())).toBe(true);
  if (method === "keyboard") {
    await seedKeyboardClipboard(original.locator("img"));
    await original.focus();
    await page.keyboard.press("Control+v");
  } else {
    await original.click({ button: "right" });
    await edit.getByRole("menuitem", { name: /粘贴图片/ }).click();
  }

  await expect(edit.getByRole("button", { name: "选择参考图 2", exact: true })).toBeVisible();
  await edit.getByRole("button", { name: "保存素材", exact: true }).click();
  await expect(edit.getByRole("button", { name: "选择参考图 2", exact: true })).toBeVisible();
  await expect(edit.getByRole("button", { name: "关闭编辑素材", exact: true })).toBeEnabled();
  await edit.getByRole("button", { name: "关闭编辑素材", exact: true }).click();
  await expect(edit).toBeHidden();
  await library.getByRole("button", { name: "预览", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "完整组件预览", exact: true });
  const previewImage = preview.getByRole("button", { name: "选择素材图片 2", exact: true });
  await previewImage.click({ button: "right" });
  await expect(preview.getByRole("menuitem", { name: /粘贴图片/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(preview).toBeVisible();
  await previewImage.click({ button: "right" });
  await preview.getByRole("menuitem", { name: /复制图片/ }).click();
  await preview.getByRole("button", { name: "关闭完整组件预览", exact: true }).click();
  await library.getByRole("button", { name: "关闭素材库", exact: true }).click();
  const document = page.getByRole("group", { name: "方案正文", exact: true });
  const paragraph = document.locator(".bn-inline-content").first();
  await paragraph.click({ position: { x: 20, y: 10 } });
  if (method === "keyboard") await page.keyboard.press("Control+v");
  else {
    await paragraph.click({ button: "right" });
    await page.getByRole("menuitem", { name: /粘贴图片/ }).click();
  }
  await expect(document.locator('[data-content-type="image"]')).toHaveCount(1);
  const image = document.locator('[data-content-type="image"] img').first();
  if (method === "keyboard") {
    await image.click();
    await page.keyboard.press("Control+v");
  } else {
    await image.click({ button: "right" });
    await page.getByRole("menuitem", { name: /粘贴图片/ }).click();
  }
  await expect(document.locator('[data-content-type="image"]')).toHaveCount(2);
  const files = await page.evaluate(() => window.__PRESHOT_IMAGE_CLIPBOARD_TEST__!.files());
  expect(files).toHaveLength(2);
  expect(new Set(files).size).toBe(2);
  await expect(document.locator(".bn-editor")).toHaveAttribute("contenteditable", "true");
  await paragraph.click({ position: { x: 20, y: 10 } });
  await page.keyboard.type("Clipboard editing remains usable");
  await expect(paragraph).toContainText("Clipboard editing remains usable");
  await page.screenshot({ path: test.info().outputPath("clipboard-material-to-document.png"), fullPage: true });
  expect(errors).toEqual([]);
});
}

for (const kind of ["prop", "shootingLocation", "clothing", "modelCard", "imageGroup"]) {
    test(`${kind}: selected components receive keyboard image paste in their own galleries`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.goto(`/e2e/fixtures/material-library.html?clipboard=1&materialKind=${kind}`);
      const document = page.getByRole("group", { name: "方案正文", exact: true });
      await expect(document).toBeVisible();
      const library = page.getByRole("dialog", { name: "素材库", exact: true });
      for (let index = 0; index < 2; index++) {
        await page.getByRole("button", { name: "素材库", exact: true }).click();
        await library.getByRole("button", { name: "插入到当前文档", exact: true }).click();
        await expect(library).toBeHidden();
      }
      const components = document.locator("[data-clipboard-component]");
      await expect(components).toHaveCount(2);
      await page.getByRole("button", { name: "素材库", exact: true }).click();
      await library.getByRole("button", { name: "编辑素材", exact: true }).click();
      const edit = page.getByRole("dialog", { name: "编辑素材", exact: true });
      await edit.getByTitle("从文件添加图片", { exact: true }).click();
      const original = edit.getByRole("button", { name: "选择参考图 1", exact: true });
      await original.click();
      await page.keyboard.press("Control+c");
      await expect.poll(() => page.evaluate(() => window.__PRESHOT_IMAGE_CLIPBOARD_TEST__?.copied())).toBe(true);
      await seedKeyboardClipboard(original.locator("img"));
      const materialComponent = edit.locator("[data-clipboard-component]");
      await materialComponent.locator("button:not(:disabled), input, textarea").first().focus();
      await page.keyboard.press("Shift+Tab");
      await expect(materialComponent).toBeFocused();
      await (kind === "imageGroup" ? materialComponent.locator("[data-clipboard-gallery-heading] h3")
        : materialComponent).click({ position: { x: 4, y: 4 } });
      await expect(materialComponent).toBeFocused();
      await expect(materialComponent).toHaveAttribute("data-clipboard-component-selected", "");
      await expect(materialComponent.locator("[data-clipboard-paste-target]")).toHaveCount(1);
      await page.keyboard.press("Control+v");
      await expect(materialComponent.locator("[data-image-clipboard-id]")).toHaveCount(2);
      await expect(edit.locator(".bn-block-content")).toHaveCount(1);
      await edit.getByRole("button", { name: "保存素材", exact: true }).click();
      await expect(edit.getByRole("button", { name: "关闭编辑素材", exact: true })).toBeEnabled();
      await edit.getByRole("button", { name: "关闭编辑素材", exact: true }).click();
      await library.getByRole("button", { name: "关闭素材库", exact: true }).click();

      const first = components.nth(0), second = components.nth(1);
      await first.click({ position: { x: 4, y: 4 } });
      await expect(first).toBeFocused();
      await page.keyboard.press("Control+v");
      await expect(first.locator("[data-image-clipboard-id]")).toHaveCount(1);
      const beforeSelection = await second.boundingBox();
      await second.click({ position: { x: 4, y: 4 } });
      await expect(second).toBeFocused();
      const afterSelection = await second.boundingBox();
      expect(afterSelection?.width).toBe(beforeSelection?.width);
      expect(afterSelection?.height).toBe(beforeSelection?.height);
      await expect(second).toHaveCSS("outline-style", "solid");
      await expect(first).not.toHaveAttribute("data-clipboard-component-selected", "");
      await expect(second.locator("[data-clipboard-paste-target]")).toHaveCount(1);
      await second.screenshot({ path: test.info().outputPath(`${kind}-selected-paste-target.png`) });
      await page.keyboard.press("Control+v");
      await expect(second.locator("[data-image-clipboard-id]")).toHaveCount(1);
      await expect(first.locator("[data-image-clipboard-id]")).toHaveCount(1);
      await first.locator("[data-image-clipboard-id]").click();
      await page.keyboard.press("Control+c");
      await second.click({ position: { x: 4, y: 4 } });
      await page.keyboard.press("Control+v");
      await expect(second.locator("[data-image-clipboard-id]")).toHaveCount(2);
      const ids = await second.locator("[data-image-clipboard-id]").evaluateAll(nodes =>
        nodes.map(node => node.getAttribute("data-image-clipboard-id")));
      await second.locator("[data-image-clipboard-id]").first().click();
      await page.keyboard.press("Control+v");
      await expect(second.locator("[data-image-clipboard-id]")).toHaveCount(3);
      const pastedIds = await second.locator("[data-image-clipboard-id]").evaluateAll(nodes =>
        nodes.map(node => node.getAttribute("data-image-clipboard-id")));
      expect([pastedIds[0], pastedIds[2]]).toEqual(ids);
      await expect(document.locator('[data-content-type="image"]')).toHaveCount(0);
      const files = await page.evaluate(() => window.__PRESHOT_IMAGE_CLIPBOARD_TEST__!.files());
      expect(files).toHaveLength(4);
      expect(new Set(files).size).toBe(4);

      const paragraph = document.locator(".bn-inline-content").first();
      await paragraph.click({ position: { x: 20, y: 10 } });
      await expect(document.locator("[data-clipboard-component-selected]")).toHaveCount(0);
      await page.keyboard.type("Continue document editing");
      await expect(paragraph).toContainText("Continue document editing");
      await page.keyboard.press("Control+v");
      await expect(document.locator('[data-content-type="image"]')).toHaveCount(1);
      if (kind === "prop") {
        await document.locator('[data-content-type="image"] img').click();
        await page.keyboard.press("Control+c");
        await second.click({ position: { x: 4, y: 4 } });
        await page.keyboard.press("Control+v");
        await expect(second.locator("[data-image-clipboard-id]")).toHaveCount(4);
        await expect(document.locator('[data-content-type="image"]')).toHaveCount(1);
      }
      expect(errors).toEqual([]);
    });
}
