import { expect, test } from "@playwright/test";

for (const activation of ["mouse", "keyboard", "add-button"] as const) {
  test(`the block insert menu opens the document library (${activation})`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/e2e/fixtures/material-library.html");
    const document = page.getByRole("group", { name: "方案正文", exact: true });
    const blocks = document.locator(".bn-editor > .bn-block-group > .bn-block-outer");
    await expect(blocks).toHaveCount(3);
    const originalIds = await blocks.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-id")));
    if (activation === "add-button") {
      await blocks.nth(1).hover({ position: { x: 25, y: 8 } });
      await page.getByRole("button", { name: "添加块", exact: true }).click();
    } else {
      await blocks.nth(1).locator(".bn-inline-content").click();
      await page.keyboard.press("End");
      await page.keyboard.type("/library");
    }
    const option = page.getByRole("option", { name: /从素材库插入/ });
    await expect(option).toBeVisible();
    const insertionIndex = activation === "add-button" ? 3 : 2;
    if (activation === "keyboard") await page.keyboard.press("Enter");
    else await option.click();

    const library = page.getByRole("dialog", { name: "素材库", exact: true });
    await expect(library).toBeVisible();
    await expect(library.getByRole("button", { name: "模特", exact: true })).toBeVisible();
    await expect(library.getByText(/插入位置：.*当前光标所在内容之后/)).toBeVisible();
    await library.getByRole("button", { name: "插入到当前文档", exact: true }).click();
    await expect(library).toBeHidden();
    // The add button contributes an empty paragraph as well as the material.
    await expect(blocks).toHaveCount(originalIds.length + (activation === "add-button" ? 2 : 1));
    await expect(blocks.nth(insertionIndex).locator('[data-content-type="prop"]')).toHaveCount(1);
    await expect(document.getByRole("textbox", { name: "道具名称", exact: true })).toHaveValue("透明玻璃杯");
    expect(await blocks.evaluateAll((nodes, inserted) => nodes
      .filter((_, index) => index !== inserted && !(inserted === 3 && index === 2))
      .map((node) => node.getAttribute("data-id")), insertionIndex))
      .toEqual(originalIds);
    await expect(document).not.toContainText("/library");
    await expect(page.getByText(/目标图片组或编辑器尚未就绪/)).toHaveCount(0);

    await blocks.nth(1).locator(".bn-inline-content").click();
    await page.keyboard.press("Control+z");
    await expect(document.locator('[data-content-type="prop"]')).toHaveCount(0);
    await page.keyboard.press("Control+Shift+z");
    await expect(document.getByRole("textbox", { name: "道具名称", exact: true })).toHaveValue("透明玻璃杯");
    await page.screenshot({ path: test.info().outputPath("material-menu-inserted.png"), animations: "disabled" });
    expect(errors).toEqual([]);
  });
}
