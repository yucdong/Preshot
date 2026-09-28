import { expect, test, type Locator } from "@playwright/test";

async function expectCategoryFits(button: Locator, iconSize: number) {
  const bounds = await button.evaluate((element) => {
    const icon = element.querySelector("svg")!.getBoundingClientRect();
    const label = element.querySelector(".ml-category-label");
    return {
      iconWidth: icon.width, iconHeight: icon.height, width: element.clientWidth, contentWidth: element.scrollWidth,
      labelHeight: label?.getBoundingClientRect().height ?? 0,
      lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
    };
  });
  expect(bounds.iconWidth).toBeCloseTo(iconSize, 0);
  expect(bounds.iconHeight).toBeCloseTo(iconSize, 0);
  expect(bounds.contentWidth).toBeLessThanOrEqual(bounds.width + 1);
  expect(bounds.labelHeight).toBeLessThanOrEqual(bounds.lineHeight * 2 + 1);
}

test("long category labels retain full-sized icons in Chinese and English", async ({ page }) => {
  await page.goto("/e2e/fixtures/material-library.html");
  for (const language of ["English", "简体中文"]) {
    const english = language === "English";
    const label = english ? "Props and wardrobe" : "道具与服装";
    await page.getByRole("button", { name: english ? "设置" : "Settings", exact: true }).click();
    await page.getByRole("button", { name: language, exact: true }).click();
    await page.getByRole("button", { name: english ? "Close settings" : "关闭设置", exact: true }).click();
    await page.getByRole("button", { name: english ? "Material library" : "素材库", exact: true }).click();
    const library = page.locator(".ml-browser-dialog");
    const category = library.getByRole("button", { name: label, exact: true });
    for (const width of [1280, 1000, 760, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(category).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`category-${english ? "en" : "zh"}-${width}.png`), animations: "disabled" });
      await expectCategoryFits(category, 18);
      if (width >= 900) {
        const results = await library.locator(".ml-results").boundingBox();
        expect(results!.width).toBeGreaterThanOrEqual(240);
      }
      await category.click();
      await expect(category).toHaveAttribute("aria-pressed", "true");
      await expectCategoryFits(category, 18);
      await library.getByRole("button", { name: english ? "Create material" : "创建素材", exact: true }).click();
      const chooser = page.getByRole("dialog", { name: english ? "Create material" : "创建素材", exact: true });
      await expectCategoryFits(chooser.getByRole("button", { name: label, exact: true }), 20);
      await chooser.getByRole("button", { name: english ? "Close Create material" : "关闭创建素材", exact: true }).click();
    }
    await library.getByRole("button", { name: english ? "Close Material library" : "关闭素材库", exact: true }).click();
    await page.setViewportSize({ width: 1280, height: 900 });
  }
});

test("switches the workspace, editor, library and export UI while preserving Chinese content", async ({ page }) => {
  await page.goto("/e2e/fixtures/material-library.html");
  const editor = page.locator(".bn-editor").first();
  await expect(editor).toBeVisible();
  const original = await editor.innerText();
  const blocks = editor.locator(":scope > .bn-block-group > .bn-block-outer");
  const ids = await blocks.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-id")));
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "English", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(settings.getByRole("heading", { name: "Appearance" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await settings.getByRole("button", { name: "Close settings", exact: true }).click();
  expect(await editor.innerText()).toBe(original);
  expect(await blocks.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-id")))).toEqual(ids);
  await page.getByRole("button", { name: "Material library", exact: true }).click();
  const library = page.getByRole("dialog", { name: "Material library", exact: true });
  await expect(library.getByRole("button", { name: "Props and wardrobe", exact: true })).toBeVisible();
  await expect(library.getByRole("button", { name: "Select material: 逆光玻璃杯", exact: true })).toBeVisible();
  await library.getByRole("button", { name: "Preview", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Full component preview", exact: true });
  await expect(preview.getByText("透明玻璃杯", { exact: true }).first()).toBeVisible();
  await preview.getByRole("button", { name: "Close Full component preview", exact: true }).click();
  await library.getByRole("button", { name: "Close Material library", exact: true }).click();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("menuitem", { name: "Export long image", exact: true }).click();
  const output = page.getByRole("dialog", { name: "Export long image", exact: true });
  await expect(output.getByRole("checkbox", { name: "Automatic splitting" })).not.toBeChecked();
  await output.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "简体中文", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "设置", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await expect(page.getByRole("button", { name: "素材库", exact: true })).toBeVisible();
  expect(await editor.innerText()).toBe(original);
});
