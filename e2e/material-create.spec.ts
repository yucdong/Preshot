import { expect, test } from "@playwright/test";

const variants = [
  { label: "图片组", field: "图片组名称", text: "图片组说明" },
  { label: "模特", field: "模特名称 / 编号", text: "其他信息" },
  { label: "场地", field: "场地名称", text: "场地信息" },
  { label: "道具与服装", field: "道具与服装名称", text: "道具与服装信息" },
];

for (const variant of variants) {
  test(`creates ${variant.label} with text, imported and captured images, then updates the same material`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/e2e/fixtures/material-library.html");
    await page.getByRole("button", { name: "素材库", exact: true }).click();
    const library = page.getByRole("dialog", { name: "素材库", exact: true });
    await library.getByRole("button", { name: "回收站", exact: true }).click();
    await library.getByRole("button", { name: "创建素材", exact: true }).click();
    const chooser = page.getByRole("dialog", { name: "创建素材", exact: true });
    await expect(chooser.getByRole("button", { name: "图片", exact: true })).toBeFocused();
    if (variant.label === "图片组") {
      await page.screenshot({ path: test.info().outputPath("material-create-types.png"), animations: "disabled" });
    }
    await chooser.getByRole("button", { name: variant.label, exact: true }).click();
    const editor = page.locator(".ml-content-editor-dialog");
    await expect(editor).toBeVisible();
    await expect(editor.locator(".bn-block-content")).toHaveCount(1);
    const name = `新建${variant.label}素材`;
    const materialName = editor.getByRole("textbox", { name: "素材名称", exact: true });
    await expect(materialName).toHaveValue("");
    await editor.getByRole("button", { name: "保存素材", exact: true }).click();
    await expect(materialName).toBeFocused();
    await materialName.fill(name);
    await editor.getByRole("textbox", { name: "素材说明", exact: true }).fill("直接创建的可复用组件");
    await editor.getByRole("textbox", { name: "标签", exact: true }).fill("直接创建，中文检索");
    await editor.getByRole("textbox", { name: variant.field, exact: true }).fill(`自定义${variant.label}`);
    const text = editor.getByRole("textbox", { name: variant.text, exact: true });
    await text.fill("新建素材也能编辑文字和选择文本");
    await text.press("Home");
    await text.press("Shift+ArrowRight");
    expect(await text.evaluate((field: HTMLTextAreaElement) => field.selectionEnd - field.selectionStart)).toBe(1);
    await editor.getByRole("button", { name: /添加.*图片|导入.*图片/ }).first().click();
    await expect(editor.locator("[data-image-id]")).toHaveCount(1);
    await editor.getByRole("button", { name: "截图", exact: true }).click();
    await page.getByRole("dialog", { name: "模拟 Windows 截图", exact: true })
      .getByRole("button", { name: "完成测试截图", exact: true }).click();
    await expect(editor.locator("[data-image-id]")).toHaveCount(2);
    await page.screenshot({ path: test.info().outputPath("material-creation-canvas.png"), animations: "disabled" });
    await editor.getByRole("button", { name: "保存素材", exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(library.getByRole("button", { name: `选择素材：${name}`, exact: true })).toHaveCount(1);
    await library.getByRole("button", { name: "编辑素材", exact: true }).click();
    await expect(materialName).toBeEnabled();
    await expect(editor.getByRole("heading", { name: "编辑素材", exact: true })).toBeVisible();
    await text.fill("第二次保存后的素材文字");
    await text.press("Control+s");
    await expect(editor.getByText("素材已保存，可继续编辑；关闭后更新预览。")).toBeVisible();
    await expect(materialName).toBeEnabled();
    await editor.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(library.getByRole("searchbox")).toBeFocused();
    await expect(library.getByRole("button", { name: "全部素材", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(library.getByRole("button", { name: `选择素材：${name}`, exact: true })).toHaveCount(1);
    await expect(library.getByRole("img", { name: `${name}的组件缩略图`, exact: true })).toBeVisible();
    await library.getByRole("button", { name: "预览", exact: true }).click();
    const preview = page.getByRole("dialog", { name: "完整组件预览", exact: true });
    await expect(preview.getByText("第二次保存后的素材文字", { exact: true })).toBeVisible();
    await expect(preview.locator("img")).toHaveCount(2);
    await page.screenshot({ path: test.info().outputPath("material-created-preview.png"), animations: "disabled" });
    await preview.getByRole("button", { name: "关闭完整组件预览", exact: true }).click();
    await library.getByRole("button", { name: "编辑素材", exact: true }).click();
    await expect(materialName).toHaveValue(name);
    await expect(editor.getByRole("textbox", { name: "标签", exact: true })).toHaveValue("直接创建，中文检索");
    await expect(text).toHaveValue("第二次保存后的素材文字");
    await expect(editor.locator("[data-image-id]")).toHaveCount(2);
    await editor.getByRole("button", { name: "取消", exact: true }).click();
    expect(errors).toEqual([]);
  });
}

test("cancelling a new material with staged images leaves no library record", async ({ page }) => {
  await page.goto("/e2e/fixtures/material-library.html");
  await page.getByRole("button", { name: "素材库", exact: true }).click();
  const library = page.getByRole("dialog", { name: "素材库", exact: true });
  await library.getByRole("button", { name: "创建素材", exact: true }).click();
  await page.getByRole("dialog", { name: "创建素材", exact: true })
    .getByRole("button", { name: "道具与服装", exact: true }).click();
  const editor = page.locator(".ml-content-editor-dialog");
  await editor.getByRole("textbox", { name: "素材名称", exact: true }).fill("取消的新素材");
  await editor.getByRole("button", { name: /添加.*图片|导入.*图片/ }).first().click();
  await expect(editor.locator("[data-image-id]")).toHaveCount(1);
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("dialog", { name: "放弃素材修改？", exact: true })
    .getByRole("button", { name: "放弃修改", exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(library.getByRole("button", { name: /^选择素材：/ })).toHaveCount(1);
  await expect(library.getByRole("button", { name: "选择素材：取消的新素材", exact: true })).toHaveCount(0);
});

test("duplicate create and update both ask permission without overwriting another material", async ({ page }) => {
  await page.goto("/e2e/fixtures/material-library.html");
  await page.getByRole("button", { name: "素材库", exact: true }).click();
  const library = page.getByRole("dialog", { name: "素材库", exact: true });
  await library.getByRole("button", { name: "创建素材", exact: true }).click();
  await page.getByRole("dialog", { name: "创建素材", exact: true })
    .getByRole("button", { name: "模特", exact: true }).click();
  const editor = page.locator(".ml-content-editor-dialog");
  const name = editor.getByRole("textbox", { name: "素材名称", exact: true });
  await name.fill("逆光玻璃杯");
  await editor.getByRole("button", { name: "保存素材", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "保存同名素材？", exact: true });
  await expect(confirm.getByRole("button", { name: "取消", exact: true })).toBeFocused();
  await expect(confirm.getByText("确认后将新增一份独立素材，不会覆盖已有素材。")).toBeVisible();
  await confirm.getByRole("button", { name: "取消", exact: true }).click();
  await expect(name).toHaveValue("逆光玻璃杯");
  await editor.getByRole("button", { name: "保存素材", exact: true }).click();
  await confirm.getByRole("button", { name: "仍然保存", exact: true }).click();
  await expect(editor).toBeHidden();
  await library.getByRole("button", { name: "编辑素材", exact: true }).click();
  await expect(name).toBeEnabled();
  await editor.getByRole("textbox", { name: "模特名称 / 编号", exact: true }).fill("新模特内容");
  await editor.getByRole("button", { name: "保存素材", exact: true }).click();
  await expect(confirm.getByText("确认后只更新当前素材，不会覆盖其他同名素材。")).toBeVisible();
  await confirm.getByRole("button", { name: "仍然保存", exact: true }).click();
  await expect(name).toBeEnabled();
  await editor.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(library.getByRole("button", { name: "选择素材：逆光玻璃杯", exact: true })).toHaveCount(2);
  await library.getByRole("button", { name: "选择素材：逆光玻璃杯", exact: true }).last().click();
  await library.getByRole("button", { name: "编辑素材", exact: true }).click();
  await expect(editor.getByRole("textbox", { name: "道具与服装名称", exact: true })).toHaveValue("透明玻璃杯");
});

test("an interrupted first creation closes only after confirmation and can be reopened", async ({ page }) => {
  await page.goto("/e2e/fixtures/material-library.html?loseEditResponse=1");
  await page.getByRole("button", { name: "素材库", exact: true }).click();
  const library = page.getByRole("dialog", { name: "素材库", exact: true });
  await library.getByRole("button", { name: "创建素材", exact: true }).click();
  await page.getByRole("dialog", { name: "创建素材", exact: true })
    .getByRole("button", { name: "道具与服装", exact: true }).click();
  const editor = page.locator(".ml-content-editor-dialog");
  await editor.getByRole("textbox", { name: "素材名称", exact: true }).fill("断线后的新素材");
  await editor.getByRole("button", { name: "保存素材", exact: true }).click();
  await expect(editor.getByRole("textbox", { name: "素材名称", exact: true })).toBeDisabled();
  await expect(editor).toBeVisible();
  await editor.getByRole("button", { name: "重试确认保存", exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(library.getByRole("button", { name: "选择素材：断线后的新素材", exact: true })).toHaveCount(1);
  await library.getByRole("button", { name: "编辑素材", exact: true }).click();
  await expect(editor.getByRole("textbox", { name: "素材名称", exact: true })).toHaveValue("断线后的新素材");
});
