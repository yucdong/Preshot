import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const output = resolve(".preshot-build-cache/demo");
await mkdir(`${output}/raw`, { recursive: true });
await mkdir(`${output}/exports`, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 }, colorScheme: "light", deviceScaleFactor: 1,
  recordVideo: { dir: `${output}/raw`, size: { width: 1280, height: 800 } },
});
const page = await context.newPage();
page.setDefaultTimeout(20_000);
const video = page.video();
const start = Date.now();
const chapters = [];
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const hold = (ms = 700) => page.waitForTimeout(ms);
async function chapter(zh, en) {
  chapters.push({ seconds: (Date.now() - start) / 1000, zh, en });
  console.log(`Chapter ${chapters.length}: ${en}`);
}
async function click(locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
  await hold(150);
  await locator.click();
  await hold(350);
}
async function fill(locator, value) {
  await click(locator);
  await locator.fill(value);
  await hold(350);
}
const button = (name, host = page) => host.getByRole("button", { name, exact: true });
const library = page.getByRole("dialog", { name: "素材库", exact: true });
const materialEditor = page.locator(".ml-content-editor-dialog");
const documentEditor = page.locator(".bn-editor:visible").first();

async function createMaterial({ category, name, description, tags, fields = {}, photos = [] }) {
  await click(button("创建素材", library));
  await click(button(category, page.getByRole("dialog", { name: "创建素材", exact: true })));
  await expect(materialEditor).toBeVisible();
  await fill(materialEditor.getByRole("textbox", { name: "素材名称", exact: true }), name);
  await fill(materialEditor.getByRole("textbox", { name: "素材说明", exact: true }), description);
  await fill(materialEditor.getByRole("textbox", { name: "标签", exact: true }), tags);
  for (const [field, value] of Object.entries(fields)) {
    await fill(materialEditor.getByRole("textbox", { name: field, exact: true }), value);
  }
  if (photos.length) {
    const chooser = page.waitForEvent("filechooser");
    await click(materialEditor.getByRole("button", { name: /添加.*图片|导入.*图片/ }).first());
    await (await chooser).setFiles(photos.map((photo) => resolve(`docs/demo/photos/${photo}`)));
    await expect(materialEditor.locator("[data-image-id]")).toHaveCount(photos.length);
    await hold(1200);
  }
  await click(button("保存素材", materialEditor));
  await expect(materialEditor.getByText("素材已保存，可继续编辑；关闭后更新预览。")).toBeVisible();
  await hold(600);
  await click(button("关闭", materialEditor));
  await expect(button(`选择素材：${name}`, library)).toBeVisible();
}

async function insertMaterial(name, isGroup = false) {
  if (!await library.isVisible()) await click(button("素材库"));
  await fill(library.getByRole("searchbox"), name);
  await click(button(`选择素材：${name}`, library));
  await click(button("插入到当前文档", library));
  if (isGroup) {
    const selection = page.getByRole("dialog", { name: "插入图片组素材", exact: true });
    await expect(selection).toBeVisible();
    await hold(1600);
    await click(button("确认插入", selection));
  }
  await expect(library).toBeHidden();
  await hold(700);
}

try {
  await page.goto(`${process.env.PRESHOT_DEMO_URL ?? "http://127.0.0.1:1447"}/e2e/fixtures/material-library.html?walkthrough=1`);
  await expect(documentEditor).toBeVisible();
  // A visible pointer makes the UI recording easy to follow; it changes no app state.
  await page.evaluate(() => {
    const cursor = document.createElement("div");
    cursor.style.cssText = "position:fixed;left:0;top:0;width:18px;height:18px;border:2px solid #c2385c;border-radius:50%;background:#c2385c33;pointer-events:none;z-index:2147483647;transform:translate(-50%,-50%);";
    document.body.append(cursor);
    document.addEventListener("pointermove", (event) => {
      cursor.style.left = `${event.clientX}px`; cursor.style.top = `${event.clientY}px`;
    });
  });
  await chapter("01 创建项目：选择父目录，为拍摄方案命名", "01 Create a project: parent folder + shoot name");
  await click(button("新建项目"));
  const create = page.getByRole("dialog");
  await fill(create.getByLabel("项目所在路径"), "D:\\Preshot Demo");
  await fill(create.getByLabel("项目名称"), "南京长江大桥 · 风光人像");
  await hold(1400);
  await click(button("创建项目", create));
  await expect(documentEditor).toBeVisible();
  await chapter("02 写下拍摄思路：标题、时间安排与镜头清单", "02 Write the plan: concept, schedule and shot list");
  await click(documentEditor.locator("p").first());
  for (const [prefix, text] of [
    ["# ", "南京长江大桥 · 风光人像"],
    ["", "主题：江风、桥梁线条与轻盈人像。模特 A 为虚构示例人物。"],
    ["## ", "拍摄安排"],
    ["", "16:30 江边集合 → 17:00 透明伞逆光 → 17:30 泡泡与江风 → 18:00 蓝调桥景"],
    ["", "镜头清单：桥梁全景 / 人物中景 / 透明伞特写 / 泡泡前景 / 夜色剪影"],
  ]) {
    if (prefix) await page.keyboard.type(prefix, { delay: 90 });
    await page.keyboard.insertText(text);
    await hold(500);
    await page.keyboard.press("Enter");
  }
  await chapter("03 添加参考图：上传、嵌入、截图；Windows 截图可按 Esc 取消", "03 Image tools: upload, embed, screenshot; Esc cancels a Windows snip");
  await page.keyboard.type("/");
  await click(page.getByText("图片", { exact: true }).last());
  const imageBlock = documentEditor.locator('[data-content-type="image"]').first();
  if (await imageBlock.locator(".bn-add-file-button").isVisible()) await click(imageBlock.locator(".bn-add-file-button"));
  await expect(button("截图")).toBeVisible();
  await hold(2600);
  await chapter("也可 Win+Shift+S 后 Ctrl+V；本演示从文件上传桥景照片", "Or Win+Shift+S then Ctrl+V; this recording uploads a bridge photo");
  const chooser = page.waitForEvent("filechooser");
  await click(page.locator(".preshot-image-file-panel").getByRole("button").filter({ hasText: /上传/ }).first());
  await (await chooser).setFiles(resolve("docs/demo/photos/bridge-day.jpg"));
  await expect(imageBlock.locator("img")).toBeVisible();
  await hold(1600);
  await chapter("04 建立素材库：给地点、模特与道具添加描述和关键词", "04 Build a library: locations, models and props with searchable tags");
  await click(button("素材库"));
  await createMaterial({ category: "场地", name: "南京长江大桥", description: "江边风光人像，金色日落到蓝调时刻", tags: "南京，长江大桥，江边，日落",
    fields: { "场地名称": "南京长江大桥", "场地信息": "选择允许停留的江边步道；以桥梁线条作为背景，注意风向与来往行人。" } });
  await chapter("模特 A：虚构的人物资料，可在其他项目中重复使用", "Model A: a fictional profile you can reuse in future projects");
  await createMaterial({ category: "模特", name: "模特 A", description: "虚构示例人物，自然松弛的风光人像", tags: "模特A，自然，风光人像",
    fields: { "模特名称 / 编号": "模特 A（虚构）", "其他信息": "浅色服装，舒展姿态；镜头前尝试侧身、回望与缓慢行走。" } });
  await chapter("道具与服装：透明伞和泡泡机，记录来源与使用方法", "Props and wardrobe: transparent umbrella and bubble machine");
  await createMaterial({ category: "道具与服装", name: "透明伞", description: "逆光勾勒伞面轮廓，制造轻盈的画面", tags: "透明伞，逆光，人像",
    fields: { "道具与服装名称": "透明伞", "道具与服装信息": "自备一把透明长柄伞；擦净伞面，半侧身举伞，露出面部。" } });
  await createMaterial({ category: "道具与服装", name: "泡泡机", description: "利用江风，让泡泡形成虚化前景", tags: "泡泡机，前景，氛围",
    fields: { "道具与服装名称": "泡泡机", "道具与服装信息": "自备电池与泡泡液；从人物侧后方少量释放，结束后清理场地。" } });
  await chapter("参考图也能成为素材：保存白天与夜晚桥景图片组", "Reference boards are reusable too: daylight and night bridge photos");
  await createMaterial({ category: "图片组", name: "大桥光线参考", description: "日落前的桥梁结构与蓝调时刻的灯光", tags: "南京，桥景，光线，蓝调",
    fields: { "图片组名称": "大桥光线参考", "图片组说明": "观察桥梁线条、江面反光和夜景色温，照片来源见演示说明。" }, photos: ["bridge-day.jpg", "bridge-night.jpg"] });
  await chapter("05 搜索与预览：输入关键词，按需打开完整素材", "05 Search and preview: find materials by keyword");
  await fill(library.getByRole("searchbox"), "光线");
  await click(button("选择素材：大桥光线参考", library));
  await click(button("预览", library));
  await expect(page.getByRole("dialog", { name: "完整组件预览", exact: true })).toBeVisible();
  await hold(2400);
  await click(button("关闭完整组件预览"));
  await chapter("06 复用素材：插入当前文档，图片组支持选择图片和插入方式", "06 Reuse materials: insert cards, whole groups or selected images");
  await insertMaterial("大桥光线参考", true);
  for (const name of ["南京长江大桥", "模特 A", "透明伞", "泡泡机"]) await insertMaterial(name);
  await chapter("07 工作区：专注模式、中英文切换和主题设置", "07 Workspace: focus mode, interface language and appearance");
  await click(button("进入专注模式"));
  await hold(1300);
  await click(button("退出专注模式"));
  await click(button("设置"));
  await click(button("English"));
  await hold(1700);
  await click(button("简体中文"));
  await click(button("关闭设置"));
  await chapter("08 导出方案：PDF 用于分享打印，DOCX 可继续编辑", "08 Export: PDF for sharing and print; DOCX for further editing");
  for (const format of ["PDF", "DOCX"]) {
    await click(button("导出"));
    const downloaded = page.waitForEvent("download", { timeout: 120_000 });
    await click(page.getByRole("menuitem", { name: `导出 ${format}`, exact: true }));
    const file = await downloaded;
    await file.saveAs(`${output}/exports/bridge-portraits.${format.toLowerCase()}`);
    await expect(button("导出")).toBeEnabled({ timeout: 120_000 });
    await hold(600);
  }
  await chapter("长图适合发送到聊天：JPEG / PNG，超长方案可开启自动分图", "Long images for chat: JPEG / PNG, with optional automatic splitting");
  await click(button("导出"));
  await click(page.getByRole("menuitem", { name: "导出长图", exact: true }));
  const exportDialog = page.getByRole("dialog", { name: "导出长图", exact: true });
  await hold(2200);
  const imageDownload = page.waitForEvent("download", { timeout: 120_000 });
  await click(button("开始导出", exportDialog));
  const exported = await imageDownload;
  await exported.saveAs(`${output}/exports/${exported.suggestedFilename()}`);
  await expect(button("导出")).toBeEnabled({ timeout: 120_000 });
  await chapter("完成：自动保存 / Ctrl+S，带着拍摄方案出发", "Ready to shoot: autosave / Ctrl+S keeps your plan");
  await page.keyboard.press("Control+s");
  await documentEditor.locator("h1").first().scrollIntoViewIfNeeded();
  await hold(3200);
  await page.screenshot({ path: `${output}/final.png` });
  if (errors.length) throw new Error(errors.join("\n"));
  await writeFile(`${output}/chapters.json`, JSON.stringify({ duration: (Date.now() - start) / 1000, chapters }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` });
  await writeFile(`${output}/failure.txt`, `${error.stack}\n${await page.locator("body").innerText()}`);
  throw error;
} finally {
  await context.close();
  const path = await video.path();
  await writeFile(`${output}/video-path.txt`, path);
  await browser.close();
}
