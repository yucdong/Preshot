import { expect, test } from "@playwright/test";

test("clicking a group image opens a save dialog for only that image", async ({ page }) => {
  // The fixture's app clipboard is in memory; never touch the system clipboard.
  await page.goto("/e2e/fixtures/material-library.html?clipboard=1&materialKind=imageGroup");
  const document = page.getByRole("group", { name: "方案正文", exact: true });
  await expect(document).toBeVisible();
  await page.getByRole("button", { name: "素材库", exact: true }).click();
  const library = page.getByRole("dialog", { name: "素材库", exact: true });
  await library.getByRole("button", { name: "插入到当前文档", exact: true }).click();
  await expect(library).toBeHidden();
  await page.getByRole("button", { name: "素材库", exact: true }).click();
  await library.getByRole("button", { name: "编辑素材", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "编辑素材", exact: true });
  await edit.getByTitle("从文件添加图片", { exact: true }).click();
  await edit.getByRole("button", { name: "选择参考图 1", exact: true }).click({ button: "right" });
  await edit.getByRole("menuitem", { name: /复制图片/ }).click();
  await edit.getByRole("button", { name: "保存素材", exact: true }).click();
  await expect(edit.getByRole("button", { name: "关闭编辑素材", exact: true })).toBeEnabled();
  await edit.getByRole("button", { name: "关闭编辑素材", exact: true }).click();
  await library.getByRole("button", { name: "关闭素材库", exact: true }).click();
  const group = document.locator("[data-clipboard-component]").first();
  for (let index = 0; index < 2; index++) {
    await group.click({ button: "right", position: { x: 4, y: 4 } });
    await page.getByRole("menuitem", { name: /粘贴图片/ }).click();
    await expect(group.locator("[data-image-clipboard-id]")).toHaveCount(index + 1);
  }
  await group.getByRole("button", { name: "选择参考图 2", exact: true }).click();
  await page.mouse.move(5, 5);
  await expect(group.getByRole("button", { name: "添加到素材库", exact: true })).toBeVisible();
  await group.getByRole("button", { name: "添加到素材库", exact: true }).click();
  const save = page.getByRole("dialog", { name: "保存到素材库", exact: true });
  await expect(save.getByText("图片 · 1 张图片", { exact: true })).toBeVisible();
  await expect(save.getByRole("textbox", { name: "素材说明", exact: true })).toBeVisible();
  await expect(save.getByRole("textbox", { name: "标签", exact: true })).toBeVisible();
  await save.getByRole("button", { name: "取消", exact: true }).click();
});

test("clicking a native project image exposes its library action and save dialog", async ({ page }) => {
  await page.goto("/e2e/fixtures/material-library.html");
  await expect(page.getByRole("group", { name: "方案正文", exact: true })).toBeVisible();
  await page.evaluate(() => {
    const editor = (window as typeof window & { __PRESHOT_BLOCKNOTE_EDITOR__: {
      document: Array<{ id: string }>;
      insertBlocks(blocks: unknown[], anchor: { id: string }, placement: "before"): void;
    } }).__PRESHOT_BLOCKNOTE_EDITOR__;
    editor.insertBlocks([{ id: "library-native", type: "image", props: { url: "", previewWidth: 300 } }], editor.document[0], "before");
  });
  const block = page.locator('[data-node-type="blockContainer"][data-id="library-native"]');
  await block.locator(".bn-add-file-button").click();
  await page.getByRole("button", { name: "截图", exact: true }).click();
  await expect(block.locator("img.bn-visual-media")).toBeVisible();
  await block.locator("img.bn-visual-media").click();
  await page.getByRole("button", { name: "添加到素材库", exact: true }).click();
  const save = page.getByRole("dialog", { name: "保存到素材库", exact: true });
  await expect(save.getByText("图片 · 1 张图片", { exact: true })).toBeVisible();
  await expect(save.getByRole("textbox", { name: "标签", exact: true })).toBeVisible();
  await expect(save.getByRole("textbox", { name: "素材说明", exact: true })).toBeVisible();
  await save.getByRole("button", { name: "取消", exact: true }).click();
});

test("creates and searches a single image material, previews it and reopens its editor", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/e2e/fixtures/material-library.html");
  await page.getByRole("button", { name: "素材库", exact: true }).click();
  const library = page.getByRole("dialog", { name: "素材库", exact: true });
  await library.getByRole("button", { name: "图片", exact: true }).click();
  await expect(library.getByRole("button", { name: /^选择素材：/ })).toHaveCount(0);
  await library.getByRole("button", { name: "创建素材", exact: true }).click();
  const chooser = page.getByRole("dialog", { name: "创建素材", exact: true });
  await chooser.getByRole("button", { name: "图片", exact: true }).click();
  const editor = page.locator(".ml-content-editor-dialog");
  await editor.getByRole("textbox", { name: "素材名称", exact: true }).fill("窗边肖像");
  await editor.getByRole("textbox", { name: "素材说明", exact: true }).fill("午后自然光");
  await editor.getByRole("textbox", { name: "标签", exact: true }).fill("人像，逆光");
  await editor.getByRole("textbox", { name: "图片说明", exact: true }).fill("柔和的光线");
  await editor.getByRole("button", { name: "保存素材", exact: true }).click();
  await expect(editor.getByText(/请先添加一张图片/)).toBeVisible();
  await editor.getByRole("button", { name: "添加图片", exact: true }).first().click();
  await expect(editor.locator("[data-image-id]")).toHaveCount(1);
  await expect(editor.getByRole("button", { name: "添加图片", exact: true })).toBeDisabled();
  await expect(editor.getByRole("button", { name: "截图", exact: true })).toBeDisabled();
  await editor.getByRole("button", { name: "保存素材", exact: true }).click();
  await expect(editor.getByText("素材已保存，可继续编辑；关闭后更新预览。")).toBeVisible();
  await editor.getByRole("button", { name: "关闭", exact: true }).click();
  const search = library.getByRole("searchbox");
  for (const word of ["午后自然光", "逆光"]) {
    await search.fill(word);
    await expect(library.getByRole("button", { name: "选择素材：窗边肖像", exact: true })).toBeVisible();
  }
  await search.fill("不存在的关键词");
  await expect(library.getByRole("button", { name: /^选择素材：/ })).toHaveCount(0);
  await search.fill("窗边肖像");
  await library.getByRole("button", { name: "选择素材：窗边肖像", exact: true }).click();
  await library.getByRole("button", { name: "预览", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "完整组件预览", exact: true });
  await expect(preview.locator("img").first()).toBeVisible();
  await preview.getByRole("button", { name: "关闭完整组件预览" }).click();
  await library.getByRole("button", { name: "编辑素材", exact: true }).click();
  await expect(editor.getByRole("textbox", { name: "素材说明", exact: true })).toHaveValue("午后自然光");
  await expect(editor.getByRole("textbox", { name: "标签", exact: true })).toHaveValue("人像，逆光");
  await expect(editor.locator("[data-image-id]")).toHaveCount(1);
  await page.screenshot({ path: test.info().outputPath("image-material-editor.png"), animations: "disabled" });
  expect(errors).toEqual([]);
});
