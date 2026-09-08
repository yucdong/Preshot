import { expect, test } from "@playwright/test";

test("the sole library entry inserts at the beginning when the document has no cursor", async ({ page }) => {
  await page.goto("/e2e/fixtures/material-library.html");
  const document = page.getByRole("group", { name: "方案正文", exact: true });
  await expect(document).toBeVisible();
  await expect(page.getByRole("button", { name: "插入素材", exact: true })).toHaveCount(0);
  const trigger = page.getByRole("button", { name: "素材库", exact: true });
  await expect(trigger).toHaveCount(1);
  const blocks = document.locator(".bn-editor > .bn-block-group > .bn-block-outer");
  const originalIds = await blocks.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-id")));
  await trigger.click();
  const library = page.getByRole("dialog", { name: "素材库", exact: true });
  await expect(library.getByText(/插入位置：.*文档开头/)).toBeVisible();
  await library.getByRole("button", { name: "插入到当前文档", exact: true }).click();
  await expect(library).toBeHidden();
  await expect(blocks.first().locator('[data-content-type="prop"]')).toHaveCount(1);
  expect((await blocks.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-id")))).slice(1)).toEqual(originalIds);
});

test("library navigation retains the current cursor block rather than appending at the end", async ({ page }) => {
  await page.goto("/e2e/fixtures/material-library.html");
  const document = page.getByRole("group", { name: "方案正文", exact: true });
  const blocks = document.locator(".bn-editor > .bn-block-group > .bn-block-outer");
  await expect(blocks).toHaveCount(3);
  const originalIds = await blocks.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-id")));
  await blocks.nth(1).locator(".bn-inline-content").click();
  const trigger = page.getByRole("button", { name: "素材库", exact: true });
  await trigger.click();
  const library = page.getByRole("dialog", { name: "素材库", exact: true });
  await expect(library.getByText(/插入位置：.*当前光标所在内容之后/)).toBeVisible();
  await library.getByRole("button", { name: "预览", exact: true }).click();
  await page.getByRole("button", { name: "关闭完整组件预览", exact: true }).click();
  await library.getByRole("button", { name: "插入到当前文档", exact: true }).click();
  await expect(library).toBeHidden();
  await expect(blocks).toHaveCount(4);
  await expect(blocks.nth(2).locator('[data-content-type="prop"]')).toHaveCount(1);
  const ids = await blocks.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-id")));
  expect([ids[0], ids[1], ids[3]]).toEqual(originalIds);
  await expect(document.getByRole("textbox", { name: "道具名称", exact: true })).toBeFocused();
  await trigger.click();
  await library.getByRole("button", { name: "插入到当前文档", exact: true }).click();
  await expect(library).toBeHidden();
  await expect(blocks).toHaveCount(5);
  await expect(blocks.nth(3).locator('[data-content-type="prop"]')).toHaveCount(1);
  await expect(blocks.last()).toHaveAttribute("data-id", originalIds[2]!);
});

test("material library browses, renders a full preview, inserts and saves a reusable card", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/e2e/fixtures/material-library.html");
  await page.getByRole("button", { name: "素材库", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("逆光玻璃杯", { exact: true }).first().click();
  await expect(dialog.getByRole("button", { name: /^插入/ })).toBeEnabled();
  await expect(dialog.getByText("透明玻璃杯", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("material-library-browser.png"), animations: "disabled" });
  await expect(dialog.getByRole("group", { name: "素材操作" }).getByRole("button")).toHaveText(["编辑素材", "预览"]);
  await dialog.getByRole("button", { name: "预览", exact: true }).click();
  const fullPreview = page.getByRole("dialog", { name: "完整组件预览", exact: true });
  await expect(fullPreview.getByText("透明玻璃杯", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("material-library-full-preview.png"), animations: "disabled" });
  await fullPreview.getByRole("button", { name: "关闭完整组件预览" }).click();
  await expect(fullPreview).toBeHidden();
  await expect(dialog.getByRole("button", { name: "预览", exact: true })).toBeFocused();
  for (const dismiss of ["button", "backdrop", "escape"]) {
    await dialog.getByRole("button", { name: "预览", exact: true }).click();
    await expect(fullPreview.getByText("透明玻璃杯", { exact: true }).first()).toBeVisible();
    if (dismiss === "button") {
      await fullPreview.getByRole("button", { name: "关闭完整组件预览" }).click();
    } else if (dismiss === "backdrop") {
      await page.mouse.click(8, 8);
    } else {
      await page.keyboard.press("Escape");
    }
    await expect(fullPreview).toBeHidden();
    await expect(dialog.getByRole("button", { name: "预览", exact: true })).toBeFocused();
  }
  await dialog.getByRole("button", { name: /^插入/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("textbox", { name: "道具名称" })).toHaveValue("透明玻璃杯");
  await page.getByRole("button", { name: "透明玻璃杯更多操作" }).click();
  await page.getByRole("menuitem", { name: "保存到素材库" }).click();
  await dialog.getByLabel(/素材名称/).fill("已保存的静物组件");
  await dialog.getByRole("button", { name: /^保存/ }).click();
  await expect(dialog.getByRole("button", { name: /^保存/ })).toBeHidden();
  await page.getByRole("button", { name: "素材库", exact: true }).click();
  await expect(dialog.getByText("已保存的静物组件", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("material-library-saved.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await dialog.getByLabel("项目名称").fill("素材复用目标");
  await dialog.getByRole("button", { name: "创建项目", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("textbox", { name: "道具名称" })).toHaveCount(0);
  await page.getByRole("button", { name: "素材库", exact: true }).click();
  await dialog.getByText("已保存的静物组件", { exact: true }).first().click();
  await dialog.getByRole("button", { name: /^插入/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("textbox", { name: "道具名称" })).toHaveValue("透明玻璃杯");
  await page.locator("header").getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("dialog", { name: /设置/ }).getByRole("button", { name: /深色/, pressed: false }).click();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1000, height: 760 });
  await page.getByRole("button", { name: "素材库", exact: true }).click();
  await expect(dialog.getByText("已保存的静物组件", { exact: true }).first()).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.screenshot({ path: test.info().outputPath("material-library-dark.png"), animations: "disabled" });
  expect(errors).toEqual([]);
});

test("normal browser mode reports unavailable desktop persistence and restores focus", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "素材库", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/桌面版/).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
