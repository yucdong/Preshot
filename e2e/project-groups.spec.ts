import { expect, test, type Page, type Locator } from "@playwright/test";

const all = (page: Page) => page.getByRole("region", { name: "所有项目", exact: true });
const group = (page: Page, name: string) => all(page).getByRole("region", { name, exact: true });
async function createGroup(page: Page, name: string) {
  await page.getByRole("button", { name: "新建分组", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新建分组", exact: true });
  await dialog.getByRole("textbox", { name: "分组名称" }).fill(name);
  await dialog.getByRole("button", { name: "创建", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
async function moveByMenu(page: Page, project: string, target: string) {
  await all(page).getByRole("button", { name: `更多项目操作 ${project}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "移至分组…", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("目标分组").selectOption({ label: target });
  await dialog.getByRole("button", { name: "移动", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
async function beginDrag(page: Page, source: Locator) {
  const rect = (await source.boundingBox())!;
  await page.mouse.move(rect.x + 20, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + 32, rect.y + rect.height / 2, { steps: 3 });
}
async function hover(page: Page, target: Locator) {
  const rect = (await target.boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2, { steps: 6 });
}
async function organization(page: Page) {
  return page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem("preshot.midscene.workspace")!);
    return { groups: stored.groups, assignments: stored.projectGroupIds };
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/e2e/fixtures/project-groups.html");
  await expect(page.getByRole("group", { name: "方案正文", exact: true })).toBeVisible();
});

test("groups, search and restart preserve the live editor and project membership", async ({ page }, info) => {
  await createGroup(page, "人像拍摄");
  const editor = page.locator(".bn-editor");
  const editorIdentity = await editor.elementHandle();
  await editor.locator('[data-content-type="paragraph"]').first().fill("保留分组前的拍摄备注");
  await moveByMenu(page, "南京大桥夜景", "人像拍摄");
  await expect(group(page, "人像拍摄").getByRole("button", { name: "打开项目 南京大桥夜景", exact: true })).toBeVisible();
  expect(await editor.evaluate((node, previous) => node === previous, editorIdentity)).toBe(true);
  await expect(editor).toContainText("保留分组前的拍摄备注");
  await editor.press("Control+z");
  await expect(editor).toContainText("南京大桥夜景 · 拍摄安排");
  await editor.press("Control+y");
  await expect(editor).toContainText("保留分组前的拍摄备注");
  await group(page, "人像拍摄").getByRole("button", { name: "人像拍摄", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "搜索项目名称" });
  await search.fill("南京");
  await expect(all(page).getByRole("button", { name: "打开项目 南京大桥夜景", exact: true })).toBeVisible();
  await expect(all(page).getByRole("button", { name: "打开项目 南京旧项目", exact: true })).toBeVisible();
  await expect(all(page).getByRole("button", { name: "打开项目 Autumn Portrait", exact: true })).toHaveCount(0);
  await all(page).getByRole("button", { name: "打开项目 南京旧项目", exact: true }).click();
  await expect(search).toHaveValue("南京");
  await page.getByRole("region", { name: "打开项目", exact: true }).getByRole("button", { name: "打开项目 南京大桥夜景", exact: true }).click();
  await expect(page.locator('.bn-editor:visible')).toContainText("保留分组前的拍摄备注");
  await page.screenshot({ path: info.outputPath("search.png") });
  await page.getByRole("button", { name: "清空搜索", exact: true }).click();
  await expect(group(page, "人像拍摄").getByRole("button", { name: "人像拍摄", exact: true })).toHaveAttribute("aria-expanded", "false");
  const before = await organization(page);
  await page.reload();
  await expect(page.getByRole("group", { name: "方案正文", exact: true })).toBeVisible();
  expect(await organization(page)).toEqual(before);
  await expect(page.getByRole("searchbox")).toHaveValue("");
  await expect(group(page, "人像拍摄").getByRole("button", { name: "人像拍摄", exact: true })).toHaveAttribute("aria-expanded", "false");
});

test("pointer drag commits only a valid release, including collapsed groups during search", async ({ page }) => {
  await createGroup(page, "旅行计划");
  const heading = group(page, "旅行计划").getByRole("button", { name: "旅行计划", exact: true });
  await heading.click();
  const source = () => all(page).getByRole("button", { name: "打开项目 南京大桥夜景", exact: true });
  const before = await organization(page);
  await beginDrag(page, source());
  await hover(page, heading);
  expect(await organization(page)).toEqual(before); // Preview is never persisted.
  await page.mouse.move(700, 300);
  await page.mouse.up();
  expect(await organization(page)).toEqual(before);
  await beginDrag(page, source()); await hover(page, heading); await page.keyboard.press("Escape"); await page.mouse.up();
  expect(await organization(page)).toEqual(before);
  await page.getByRole("searchbox").fill("南京大桥");
  await expect(heading).toHaveCount(0);
  await beginDrag(page, source());
  await expect(heading).toBeVisible();
  await hover(page, heading);
  await page.mouse.up();
  await expect(group(page, "旅行计划").getByRole("button", { name: "打开项目 南京大桥夜景", exact: true })).toBeVisible();
  expect((await organization(page)).assignments).not.toEqual(before.assignments);
  await page.getByRole("button", { name: "清空搜索", exact: true }).click();
  await expect(heading).toHaveAttribute("aria-expanded", "true");
});

test("direct delete and rename buttons work in a narrow rail and English dark focus mode", async ({ page }, info) => {
  await createGroup(page, "人像");
  await moveByMenu(page, "Autumn Portrait", "人像");
  await page.getByRole("button", { name: "分组操作 人像", exact: true }).click();
  await page.getByRole("menuitem", { name: "重命名", exact: true }).click();
  await page.getByLabel("分组名称").fill("秋日人像");
  await page.getByRole("dialog").getByRole("button", { name: "保存", exact: true }).click();
  const splitter = page.getByRole("separator", { name: "调整项目栏宽度" });
  await splitter.focus(); await page.keyboard.press("ArrowLeft"); await page.keyboard.press("ArrowLeft");
  await expect(splitter).toHaveAttribute("aria-valuenow", "176");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Default", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "New group", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete group 秋日人像", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("narrow-english-dark.png") });
  await page.getByRole("button", { name: "Enter focus mode", exact: true }).click();
  await page.getByRole("button", { name: "Open project panel", exact: true }).click();
  await page.screenshot({ path: info.outputPath("focus-panel.png") });
  await page.getByRole("button", { name: "Delete group 秋日人像", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Delete group", exact: true });
  await expect(modal).toContainText("Project files will be kept");
  await modal.getByRole("button", { name: "Delete group", exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Default", exact: true }).getByRole("button", { name: "Open project Autumn Portrait", exact: true })).toBeVisible();
});
