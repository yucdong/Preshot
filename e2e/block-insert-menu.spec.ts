import { expect, test, type Page } from "@playwright/test";

async function openAddMenu(page: Page) {
  const blocks = page.locator(".bn-editor > .bn-block-group > .bn-block-outer");
  await expect(blocks).toHaveCount(3);
  await blocks.nth(1).hover({ position: { x: 25, y: 8 } });
  await page.getByRole("button", { name: /^(添加块|Add block)$/ }).click();
  const menu = page.getByRole("listbox");
  await expect(menu).toBeVisible();
  return menu;
}

for (const language of ["zh", "en"] as const) {
  test(`add menu starts with image and image group, and combines wardrobe into props (${language})`, async ({ page }) => {
    await page.goto("/e2e/fixtures/material-library.html");
    if (language === "en") {
      await page.getByRole("button", { name: "设置", exact: true }).click();
      await page.getByRole("button", { name: "English", exact: true }).click();
      await page.getByRole("button", { name: "Close settings", exact: true }).click();
    }
    const menu = await openAddMenu(page);
    const titles = menu.locator(".bn-mt-suggestion-menu-item-title");
    const image = language === "zh" ? "图片" : "Image";
    const group = language === "zh" ? "图片组" : "Image group";
    await expect(titles.nth(0)).toHaveText(image);
    await expect(titles.nth(1)).toHaveText(group);
    await expect(titles.filter({ hasText: new RegExp(`^${image}$`) })).toHaveCount(1);
    await expect(menu.getByText(language === "zh" ? "服装" : "Wardrobe", { exact: true })).toHaveCount(0);
    await expect(menu.getByText(language === "zh" ? "道具" : "Props", { exact: true })).toHaveCount(1);
    await page.screenshot({ path: test.info().outputPath(`insert-menu-${language}.png`), animations: "disabled" });
    await titles.nth(0).click();
    await expect(page.locator('[data-content-type="image"]')).toHaveCount(1);
    await expect(page.locator('[data-content-type="imageGroup"]')).toHaveCount(0);
  });
}

for (const query of ["clothing", "服装"]) {
test(`clothing searches insert the unified prop block (${query})`, async ({ page }) => {
  await page.goto("/e2e/fixtures/material-library.html");
  const paragraph = page.locator(".bn-editor .bn-inline-content").last();
  await paragraph.click();
  await page.keyboard.press("End");
  await page.keyboard.type("/");
  await page.keyboard.insertText(query);
  const menu = page.getByRole("listbox");
  await expect(menu.getByRole("option")).toHaveCount(1);
  await expect(menu.getByText("道具", { exact: true })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-content-type="prop"]')).toHaveCount(1);
  await expect(page.locator('[data-content-type="clothing"]')).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "道具名称", exact: true })).toBeFocused();
});
}

test("insert menu retains dark theme, Escape dismissal and keyboard insertion outside the canvas", async ({ page }) => {
  await page.goto("/e2e/fixtures/material-library.html");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("dialog", { name: /设置/ }).getByRole("button", { name: "深色", exact: true }).click();
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  const menu = await openAddMenu(page);
  await expect(menu).toHaveCSS("background-color", "rgb(31, 31, 31)");
  await page.screenshot({ path: test.info().outputPath("insert-menu-dark.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await page.locator(".bn-editor .bn-inline-content").last().click();
  await page.keyboard.press("End");
  await page.keyboard.type("/");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
  await expect(page.locator('[data-content-type="imageGroup"]')).toHaveCount(1);
});

for (const { height, zoom } of [
  { height: 900, zoom: undefined }, { height: 540, zoom: undefined },
  { height: 600, zoom: 145 }, { height: 420, zoom: 180 }, { height: 540, zoom: 70 },
]) {
  test(`last-row add menu opens upward and scrolls completely (${height}px viewport, ${zoom ?? "fit"}% zoom)`, async ({ page }) => {
    const width = zoom !== undefined && zoom > 100 ? 2240 : 1280;
    await page.setViewportSize({ width, height });
    await page.goto("/e2e/fixtures/material-library.html");
    await expect(page.locator(".bn-editor")).toBeVisible();
    if (zoom !== undefined) {
      await page.getByRole("button", { name: "恢复 100% 缩放", exact: true }).click();
      const control = page.getByRole("button", { name: zoom >= 100 ? "放大画布" : "缩小画布", exact: true });
      for (let step = 0; step < Math.abs(zoom - 100) / 15; step++) await control.click();
      await expect(page.getByRole("button", { name: "恢复 100% 缩放", exact: true })).toHaveText(`${zoom}%`);
    }
    // Seed a long document through the test-only editor handle; exercise the
    // real last-row button, floating placement, scrolling and insertion below.
    await page.evaluate(() => {
      const editor = (window as unknown as { __PRESHOT_BLOCKNOTE_EDITOR__: {
        document: Array<{ id: string }>;
        insertBlocks(blocks: unknown[], anchor: { id: string }, placement: string): unknown;
      } }).__PRESHOT_BLOCKNOTE_EDITOR__;
      editor.insertBlocks(Array.from({ length: 32 }, (_, index) => ({
        type: "paragraph", content: index === 31 ? [] : `拍摄流程 ${index + 1}：确认构图、光线与道具。`,
      })), editor.document[editor.document.length - 1], "after");
    });
    const last = page.locator(".bn-editor > .bn-block-group > .bn-block-outer").last();
    // Reach the actual document bottom, including its padding and horizontal
    // scrollbar, rather than aligning the row to the viewport's bottom edge.
    await page.getByTestId("canvas-scroller").evaluate(element => {
      element.scrollTop = element.scrollHeight;
      element.scrollLeft = 0;
    });
    await last.hover({ position: { x: 25, y: 8 } });
    const anchor = await last.boundingBox();
    // Opening suggestions wraps the active block in a decoration span, so it
    // is no longer a direct child of the root block group. Keep its identity.
    const anchorId = await last.getAttribute("data-id");
    const anchorRow = page.locator(`.bn-block-outer[data-id="${anchorId}"]`);
    expect(anchor!.y).toBeGreaterThan(height * 0.65);
    await page.getByRole("button", { name: "添加块", exact: true }).click();
    const menu = page.getByRole("listbox");
    await expect(menu).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("initial-menu.png"), animations: "disabled" });
    await test.info().attach("placement", { body: JSON.stringify({ menu: await menu.boundingBox(),
      anchor: await anchorRow.boundingBox() }),
      contentType: "application/json" });
    await expect.poll(async () => {
      const bounds = await menu.boundingBox();
      const row = await anchorRow.boundingBox();
      return bounds !== null && row !== null && bounds.y >= 8 && bounds.height >= 200 &&
        bounds.y + bounds.height <= row.y && bounds.x >= 0 && bounds.x + bounds.width <= width;
    }).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`bottom-menu-${height}.png`), animations: "disabled" });
    await menu.hover();
    await page.mouse.wheel(0, 2000);
    const lastOption = menu.getByRole("option").last();
    await expect(lastOption).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: test.info().outputPath(`bottom-menu-scrolled-${height}.png`), animations: "disabled" });
    await lastOption.click();
    await expect(menu).toBeHidden();
  });
}

for (const scale of [1, 1.5, 2]) {
  test(`menu repositions after external scroll and keyboard reaches last option at DPR ${scale}`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 540 }, deviceScaleFactor: scale });
    try {
      const page = await context.newPage();
      await page.goto("/e2e/fixtures/material-library.html");
      const menu = await openAddMenu(page);
      await page.setViewportSize({ width: 1100, height: 420 });
      await page.getByTestId("canvas-scroller").evaluate(element => { element.scrollTop += 50; element.dispatchEvent(new Event("scroll")); });
      await expect.poll(async () => {
        const rect = await menu.boundingBox();
        return !!rect && rect.y >= 8 && rect.y + rect.height <= 412;
      }).toBe(true);
      const count = await menu.getByRole("option").count();
      for (let index = 1; index < count; index++) await page.keyboard.press("ArrowDown");
      await expect(menu.getByRole("option").last()).toHaveAttribute("aria-selected", "true");
      await expect(menu.getByRole("option").last()).toBeInViewport({ ratio: 1 });
      // Scrollbar movement uses the same constrained listbox, without moving
      // the document or making its final entries unreachable.
      await menu.evaluate(element => { element.scrollTop = 0; });
      // Chromium's DPR 1.5 intersection ratio rounds a fully visible box to
      // 0.9999997; tolerate numerical noise, not a clipped menu item.
      await expect(menu.getByRole("option").first()).toBeInViewport({ ratio: .99999 });
      await menu.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await expect(menu.getByRole("option").last()).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: test.info().outputPath(`menu-dpr-${scale}.png`), animations: "disabled" });
    } finally { await context.close(); }
  });
}
