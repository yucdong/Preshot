import { expect, test, type Page } from "@playwright/test";

async function expectPreviewText(page: Page, text: string) {
  const browser = page.getByRole("dialog", { name: "素材库", exact: true });
  await expect(browser.getByText(text, { exact: true })).toHaveCount(0);
  await browser.getByRole("button", { name: "预览", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "完整组件预览", exact: true });
  await expect(preview.getByText(text, { exact: true })).toBeVisible();
  await preview.getByRole("button", { name: "关闭完整组件预览" }).click();
}

test("material content canvas cancels safely, locks block structure and saves an independent revision", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/e2e/fixtures/material-library.html");
  await page.getByRole("button", { name: "素材库", exact: true }).click();
  const browser = page.getByRole("dialog", { name: "素材库", exact: true });
  await browser.getByRole("button", { name: "插入到当前文档" }).click();
  await expect(browser).toBeHidden();
  await expect(page.getByRole("textbox", { name: "道具名称" })).toHaveValue("透明玻璃杯");

  await page.getByRole("button", { name: "素材库", exact: true }).click();
  await browser.getByRole("button", { name: "编辑素材", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "编辑素材", exact: true });
  const materialName = editor.getByRole("textbox", { name: "素材名称", exact: true });
  const title = editor.getByRole("textbox", { name: "道具与服装名称", exact: true });
  await expect(title).toHaveValue("透明玻璃杯");
  await expect(editor.getByText(/内容版本|元数据版本/)).toHaveCount(0);
  await expect(editor.getByRole("button", { name: "保存素材", exact: true })).toBeDisabled();
  const fitButton = await editor.getByRole("button", { name: "适应宽度", exact: true }).boundingBox();
  expect(fitButton?.height).toBeLessThanOrEqual(48);
  await title.fill("不保存的修改");
  await materialName.fill("不保存的素材名称");
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "放弃素材修改？", exact: true });
  await confirmation.getByRole("button", { name: "继续编辑" }).click();
  await expect(title).toHaveValue("不保存的修改");
  await expect(materialName).toHaveValue("不保存的素材名称");
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await confirmation.getByRole("button", { name: "放弃修改" }).click();
  await expect(editor).toBeHidden();
  await expect(browser.getByRole("searchbox")).toBeFocused();
  await expectPreviewText(page, "透明玻璃杯");

  await browser.getByRole("button", { name: "编辑素材", exact: true }).click();
  await expect(title).toHaveValue("透明玻璃杯");
  await expect(materialName).toHaveValue("逆光玻璃杯");
  await title.fill("");
  await editor.getByRole("button", { name: "保存素材", exact: true }).click();
  await expect(title).toHaveAttribute("aria-invalid", "true");
  await expect(editor).toBeVisible();
  await title.fill("磨砂玻璃杯");
  await materialName.fill("窗边道具素材");
  await editor.getByRole("textbox", { name: "标签", exact: true }).fill("窗边专用，玻璃");
  await editor.getByRole("textbox", { name: "素材说明", exact: true }).fill("素材信息与画布一起保存");
  await editor.getByRole("checkbox", { name: "收藏素材", exact: true }).check();
  await editor.getByRole("textbox", { name: "道具与服装信息", exact: true }).fill("微光拍摄专用");
  await editor.locator(".bn-editor").focus();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/不允许新增块");
  await expect(editor.locator('[data-content-type="prop"]')).toHaveCount(1);
  await expect(editor.locator(".bn-block-content")).toHaveCount(1);
  await expect(title).toHaveValue("磨砂玻璃杯");
  await expect(editor.getByRole("alert")).toHaveCount(0);
  await expect(editor.getByRole("menuitem", { name: /删除组件|复制组件|保存到素材库/ })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("material-content-canvas.png"), animations: "disabled" });
  await title.focus();
  await page.keyboard.press("Control+s");
  await expect(editor.getByText("素材已保存，可继续编辑；关闭后更新预览。")).toBeVisible();
  await expect(title).toHaveValue("磨砂玻璃杯");
  await expect(materialName).toBeEnabled();
  await editor.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(editor).toBeHidden({ timeout: 30_000 });
  await expect(browser.getByRole("searchbox")).toBeFocused();
  await expectPreviewText(page, "磨砂玻璃杯");
  await browser.getByRole("searchbox").fill("窗边专用");
  await expect(browser.getByRole("button", { name: "选择素材：窗边道具素材" })).toBeVisible();
  await browser.getByRole("searchbox").fill("微光拍摄专用");
  await expect(browser.getByRole("button", { name: "选择素材：窗边道具素材" })).toBeVisible();
  await browser.getByRole("button", { name: "预览", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "完整组件预览", exact: true });
  await expect(preview.getByText("磨砂玻璃杯", { exact: true })).toBeVisible();
  await preview.getByRole("button", { name: "关闭完整组件预览" }).click();
  await browser.getByRole("button", { name: "编辑素材", exact: true }).click();
  await expect(materialName).toHaveValue("窗边道具素材");
  await expect(editor.getByRole("textbox", { name: "标签", exact: true })).toHaveValue("窗边专用，玻璃");
  await expect(editor.getByRole("textbox", { name: "素材说明", exact: true })).toHaveValue("素材信息与画布一起保存");
  await expect(editor.getByRole("checkbox", { name: "收藏素材", exact: true })).toBeChecked();
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await expect(browser.getByText(/内容版本|元数据版本/)).toHaveCount(0);
  await browser.getByRole("button", { name: "关闭素材库" }).click();
  await expect(page.getByRole("textbox", { name: "道具名称" })).toHaveValue("透明玻璃杯");

  await page.getByRole("button", { name: "素材库", exact: true }).click();
  await browser.getByRole("button", { name: "插入到当前文档" }).click();
  await expect(browser).toBeHidden();
  const names = page.getByRole("textbox", { name: "道具名称" });
  await expect(names).toHaveCount(2);
  expect(await names.evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value)))
    .toEqual(expect.arrayContaining(["透明玻璃杯", "磨砂玻璃杯"]));
  expect(errors).toEqual([]);
});

test("an interrupted edit response is confirmed without a second content revision", async ({ page }) => {
  await page.goto("/e2e/fixtures/material-library.html?loseEditResponse=1");
  await page.getByRole("button", { name: "素材库", exact: true }).click();
  const browser = page.getByRole("dialog", { name: "素材库", exact: true });
  await browser.getByRole("button", { name: "编辑素材", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "编辑素材", exact: true });
  await editor.getByRole("textbox", { name: "道具与服装名称", exact: true }).fill("回执确认的杯子");
  await editor.getByRole("textbox", { name: "素材名称", exact: true }).fill("回执确认的素材");
  await editor.getByRole("button", { name: "保存素材", exact: true }).click();
  await expect(editor.getByText(/暂时不能继续编辑或取消/)).toBeVisible();
  await expect(editor.getByRole("button", { name: "取消", exact: true })).toBeDisabled();
  await expect(editor.getByRole("textbox", { name: "素材名称", exact: true })).toBeDisabled();
  await editor.getByRole("button", { name: "重试确认保存" }).click();
  await expect(editor.getByText("素材已保存，可继续编辑；关闭后更新预览。")).toBeVisible();
  await editor.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(editor).toBeHidden({ timeout: 30_000 });
  await expect(browser.getByText(/内容版本|元数据版本/)).toHaveCount(0);
  await expectPreviewText(page, "回执确认的杯子");
  await expect(browser.getByRole("button", { name: "选择素材：回执确认的素材" })).toBeVisible();
});

test("material image edits persist owned images and reopen on the full canvas", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/e2e/fixtures/material-library.html");
  await page.getByRole("button", { name: "素材库", exact: true }).click();
  const browser = page.getByRole("dialog", { name: "素材库", exact: true });
  await browser.getByRole("button", { name: "编辑素材", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "编辑素材", exact: true });
  const addImage = editor.getByRole("button", { name: /添加.*图片|导入.*图片/ }).first();
  await addImage.click();
  await expect(editor.locator("[data-image-id]")).toHaveCount(1);
  await addImage.click();
  await expect(editor.locator("[data-image-id]")).toHaveCount(2);
  const firstImage = editor.getByRole("button", { name: "选择参考图 1", exact: true });
  const originalSrc = await firstImage.locator("img").getAttribute("src");
  await firstImage.dblclick();
  const lightbox = page.locator("[data-reference-image-lightbox]").getByRole("dialog");
  await expect(lightbox).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(lightbox).toBeHidden();
  await expect(editor).toBeVisible();
  await firstImage.dblclick();
  await lightbox.getByRole("button", { name: "裁剪", exact: true }).click();
  await lightbox.getByRole("button", { name: "1:1", exact: true }).click();
  await lightbox.getByRole("button", { name: "确认裁剪", exact: true }).click();
  await expect(lightbox.getByRole("button", { name: "裁剪", exact: true })).toBeVisible();
  await lightbox.getByRole("button", { name: "关闭图片", exact: true }).click();
  await expect(lightbox).toBeHidden();
  await expect(firstImage.locator("img")).not.toHaveAttribute("src", originalSrc!);

  await editor.getByRole("button", { name: "删除参考图 1", exact: true }).click();
  const imageConfirmation = page.getByRole("dialog", { name: "删除图片？", exact: true });
  await imageConfirmation.getByRole("button", { name: "取消", exact: true }).click();
  await expect(editor.locator("[data-image-id]")).toHaveCount(2);
  await editor.getByRole("button", { name: "删除参考图 1", exact: true }).click();
  await imageConfirmation.getByRole("button", { name: "删除", exact: true }).click();
  await expect(editor.locator("[data-image-id]")).toHaveCount(1);
  await editor.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(editor.locator("[data-image-id]")).toHaveCount(2);

  await firstImage.click();
  const firstFrame = editor.locator("[data-image-id]").first();
  const previousWidth = (await firstFrame.boundingBox())!.width;
  await firstFrame.locator('[data-image-resize-edge="right"]').press("ArrowRight");
  await expect.poll(async () => (await firstFrame.boundingBox())!.width).toBeGreaterThan(previousWidth);
  await editor.getByRole("button", { name: "撤销", exact: true }).click();
  await expect.poll(async () => Math.abs((await firstFrame.boundingBox())!.width - previousWidth)).toBeLessThan(1);

  const order = await editor.locator("[data-image-id]").evaluateAll((frames) => frames.map((frame) => frame.getAttribute("data-image-id")));
  await firstImage.press("Space");
  await expect(editor.getByTestId("image-drag-announcement")).toContainText("已拿起");
  await page.keyboard.press("End");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "放弃素材修改？", exact: true })).toBeHidden();
  await expect(editor).toBeVisible();
  expect(await editor.locator("[data-image-id]").evaluateAll((frames) => frames.map((frame) => frame.getAttribute("data-image-id")))).toEqual(order);
  await firstImage.press("Space");
  await expect(editor.getByTestId("image-drag-announcement")).toContainText("已拿起");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect.poll(() => editor.locator("[data-image-id]").evaluateAll((frames) =>
    frames.map((frame) => frame.getAttribute("data-image-id")))).toEqual([...order].reverse());
  await editor.getByRole("button", { name: "撤销", exact: true }).click();
  await expect.poll(() => editor.locator("[data-image-id]").evaluateAll((frames) =>
    frames.map((frame) => frame.getAttribute("data-image-id")))).toEqual(order);
  await editor.locator(".ml-content-canvas-scroller").evaluate((element) => element.scrollTo({ top: 0 }));
  await page.screenshot({ path: test.info().outputPath("material-content-images.png"), animations: "disabled" });
  await editor.getByRole("button", { name: "放大", exact: true }).click();
  const zoom = await editor.getByLabel("画布缩放").textContent();
  const scroller = editor.locator(".ml-content-canvas-scroller");
  await scroller.evaluate((element) => element.scrollTo({ left: 50, top: 30 }));
  const position = await scroller.evaluate((element) => ({ top: element.scrollTop, left: element.scrollLeft }));
  await editor.getByRole("button", { name: "保存素材", exact: true }).click();
  await expect(editor.getByText("素材已保存，可继续编辑；关闭后更新预览。")).toBeVisible();
  await expect(editor.locator("[data-image-id]")).toHaveCount(2);
  await expect(editor.getByLabel("画布缩放")).toHaveText(zoom!);
  await expect.poll(() => scroller.evaluate((element) => ({ top: element.scrollTop, left: element.scrollLeft }))).toEqual(position);
  await addImage.click();
  await expect(editor.locator("[data-image-id]")).toHaveCount(3);
  await editor.getByRole("button", { name: "保存素材", exact: true }).click();
  await expect(editor.getByText("素材已保存，可继续编辑；关闭后更新预览。")).toBeVisible();
  await editor.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(editor).toBeHidden({ timeout: 30_000 });
  await expect(browser.getByText(/道具与服装 · 3 张图片/).first()).toBeVisible();
  await browser.getByRole("button", { name: "编辑素材", exact: true }).click();
  await expect(editor.locator("[data-image-id]")).toHaveCount(3);
  await expect(editor.getByRole("button", { name: "保存素材", exact: true })).toBeDisabled();
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(browser.getByText(/内容版本|元数据版本/)).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const variant of [
  { kind: "imageGroup", field: "素材说明", value: "更新后的窗边光线说明" },
  { kind: "modelCard", field: "模特名称 / 编号", value: "更新后的示例模特" },
  { kind: "shootingLocation", field: "场地名称", value: "更新后的窗边影棚" },
  { kind: "clothing", field: "道具与服装名称", value: "更新后的米色外套" },
]) {
  test(`single-component editing preserves the ${variant.kind} kind and fields`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/e2e/fixtures/material-library.html?materialKind=${variant.kind}`);
    if (variant.kind === "modelCard") {
      await page.locator("header").getByRole("button", { name: "设置", exact: true }).click();
      await page.getByRole("dialog", { name: /设置/ }).getByRole("button", { name: /深色/, pressed: false }).click();
      await page.keyboard.press("Escape");
      await page.setViewportSize({ width: 1000, height: 760 });
    }
    await page.getByRole("button", { name: "素材库", exact: true }).click();
    const browser = page.getByRole("dialog", { name: "素材库", exact: true });
    await browser.getByRole("button", { name: "编辑素材", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "编辑素材", exact: true });
    await editor.getByRole("textbox", { name: "素材名称", exact: true }).fill(`素材：${variant.value}`);
    await expect(editor.getByRole("textbox", { name: "素材名称", exact: true })).toHaveValue(`素材：${variant.value}`);
    await editor.getByRole("textbox", { name: variant.field }).fill(variant.value);
    if (variant.kind === "imageGroup") {
      await expect(editor.locator(".ml-material-metadata").getByRole("textbox")).toHaveCount(3);
      await expect(editor.locator(".ml-content-canvas").locator("input, textarea")).toHaveCount(0);
    }
    await editor.getByRole("button", { name: "适应宽度", exact: true }).click();
    await expect(editor.getByRole("textbox", { name: "素材名称", exact: true })).toHaveValue(`素材：${variant.value}`);
    await expect(editor.getByRole("textbox", { name: variant.field })).toHaveValue(variant.value);
    await expect(editor.locator(".bn-block-content")).toHaveCount(1);
    if (variant.kind === "modelCard") {
      await expect(page.locator("html")).toHaveClass(/dark/);
      const addImage = editor.getByRole("button", { name: "添加图片", exact: true }).last();
      await expect(addImage).toHaveCSS("position", "relative");
      await expect(addImage).toHaveCSS("background-color", "rgb(255, 255, 255)");
      await expect(addImage).toHaveCSS("color", "rgb(104, 107, 114)");
      await page.screenshot({ path: test.info().outputPath("material-content-model-dark.png"), animations: "disabled" });
    }
    await editor.getByRole("button", { name: "保存素材", exact: true }).click();
    await expect(editor.getByText("素材已保存，可继续编辑；关闭后更新预览。")).toBeVisible();
    await expect(editor.getByRole("textbox", { name: variant.field })).toHaveValue(variant.value);
    await expect(editor.getByRole("textbox", { name: "素材名称", exact: true })).toBeEnabled();
    await editor.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(editor).toBeHidden({ timeout: 30_000 });
    await expect(browser.getByText(/内容版本|元数据版本/)).toHaveCount(0);
    await browser.getByRole("button", { name: "编辑素材", exact: true }).click();
    await expect(editor.getByRole("textbox", { name: "素材名称", exact: true })).toHaveValue(`素材：${variant.value}`);
    await expect(editor.getByRole("textbox", { name: variant.field })).toHaveValue(variant.value);
    await editor.getByRole("button", { name: "取消", exact: true }).click();
    await expect(editor).toBeHidden();
    expect(errors).toEqual([]);
  });
}
