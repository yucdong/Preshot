import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { unzipDocx } from "./docxTestArchive";
type EditorProbe = { document: Array<{ type: string; children: Array<{ type: string; props: { width: number } }> }> };

const storageKey = `preshot.browser-blocknote-plan-v15:${encodeURIComponent("C:\\Preshot Demo\\编辑大片示例")}`;
const paragraph = (id: string, text: string) => ({ id, type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }], children: [] });
const fixture = {
  schemaVersion: 16, title: "南京长江大桥 · 多栏拍摄计划", artifacts: [],
  document: { format: "preshot-blocks", version: 4, blocks: [
    paragraph("intro", "南京长江大桥 · 风光人像"),
    { id: "gallery-block", type: "imageGroup", props: { groupId: "gallery" }, children: [] },
    paragraph("notes", "模特 A，透明伞和泡泡机。日落前完成拍摄。"),
  ] },
  imageGroups: [{ id: "gallery", name: "桥畔样片", type: "reference", x: 0, width: 1008, height: 258, description: "横向排列的两张样片", images: ["one", "two"].map(id => ({ id, file: `references/${id}.png`, aspectRatio: 1, sourceWidth: 1, sourceHeight: 1, frameWidth: 330, frameHeight: 247.5, fitMode: "cover", crop: { x: 0, y: 0, width: 1, height: 1 } })) }],
};
async function seed(page: Page, value: unknown = fixture) {
  await page.addInitScript(({ key, value }) => { if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify(value)); }, { key: storageKey, value });
  await page.goto("/");
  await expect(page.locator(".bn-editor")).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "多栏布局" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "双栏", exact: true })).toHaveCount(0);
}
async function saved(page: Page) {
  return page.evaluate(key => JSON.parse(sessionStorage.getItem(key)!), storageKey);
}
async function weights(page: Page) {
  return page.evaluate(() => (window as unknown as { __PRESHOT_BLOCKNOTE_EDITOR__: EditorProbe }).__PRESHOT_BLOCKNOTE_EDITOR__.document.find(b => b.type === "columnList")?.children.map(b => b.type === "column" ? b.props.width : 0));
}

async function dragBlock(page: Page, sourceId: string, targetId: string, placement: "left" | "right" | "before" | "after", cancellation?: "escape" | "outside") {
  const source = page.locator(`.bn-editor [data-node-type="blockOuter"][data-id="${sourceId}"]`).first();
  const target = page.locator(`.bn-editor [data-id="${targetId}"]`).first();
  await source.hover({ position: { x: 25, y: 8 } });
  const handle = page.locator(".preshot-block-drag-trigger:visible").last();
  await expect(handle).toBeVisible();
  const from = await handle.boundingBox(); const to = await target.boundingBox();
  if (!from || !to) throw new Error("Missing block drag geometry");
  const x = placement === "left" ? to.x + 5 : placement === "right" ? to.x + to.width - 5 : to.x + to.width / 2;
  const y = placement === "before" ? to.y + 2 : placement === "after" ? to.y + to.height - 2 : to.y + to.height / 2;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down(); await page.mouse.move(x, y, { steps: 12 });
  await expect(page.locator("[data-preshot-block-drop-overlay]")).toHaveAttribute("data-preshot-block-drop-overlay", placement);
  if (cancellation === "escape") await page.keyboard.press("Escape");
  if (cancellation === "outside") await page.mouse.move(3, 3);
  await page.mouse.up();
  await expect(page.locator("[data-preshot-block-drop-overlay]")).toHaveCount(0);
}

async function createTwoColumns(page: Page) {
  await dragBlock(page, "gallery-block", "intro", "right");
  await expect(page.locator(".bn-editor .bn-block-column")).toHaveCount(2);
}

test("cancels a column drop with Escape or outside release and allows the next drag", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await seed(page);
  const original = (await saved(page)).document;
  for (const cancellation of ["escape", "outside"] as const) {
    await dragBlock(page, "gallery-block", "intro", "right", cancellation);
    await expect(page.locator(".bn-editor .bn-block-column")).toHaveCount(0);
    expect((await saved(page)).document).toEqual(original);
  }
  await createTwoColumns(page);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".bn-editor .bn-block-column")).toHaveCount(0);
});

test("creates and removes columns by dragging, rescales galleries, commits resize once and reopens", async ({ page }, info) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await seed(page);
  await createTwoColumns(page);
  await expect(page.locator(".bn-editor .bn-block-column")).toHaveCount(2);
  const original = JSON.stringify((await saved(page)).imageGroups);
  const tiles = page.locator('[data-image-group-id="gallery"] [data-image-id]');
  await expect(tiles).toHaveCount(2);
  const a = await tiles.nth(0).boundingBox(); const b = await tiles.nth(1).boundingBox();
  expect(a && b).toBeTruthy();
  expect(a!.width).toBeLessThan(320); expect(a!.y).toBeCloseTo(b!.y, 0);
  const storedImage = (await saved(page)).imageGroups[0].images[0];
  await page.screenshot({ path: info.outputPath("initial-column-geometry.png"), fullPage: true });
  await info.attach("gallery-geometry", { body: JSON.stringify({ a, b, storedImage, tiles: await tiles.evaluateAll(elements => elements.map(e => ({style:e.getAttribute("style"), html:e.outerHTML.slice(0,350)}))) }), contentType: "application/json" });
  expect(a!.width / a!.height).toBeCloseTo(storedImage.frameWidth / storedImage.frameHeight, 1);
  await page.screenshot({ path: info.outputPath("two-columns.png"), fullPage: true });

  const columns = page.locator(".bn-editor .bn-block-column");
  const left = await columns.nth(0).boundingBox(); const right = await columns.nth(1).boundingBox();
  const x = (left!.x + left!.width + right!.x) / 2; const y = left!.y + 50;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x - 65, y, { steps: 8 });
  expect(await weights(page)).toEqual([1, 1]);
  await page.mouse.up();
  await expect.poll(() => weights(page)).not.toEqual([1, 1]);
  await page.keyboard.press("Control+z");
  await expect.poll(() => weights(page)).toEqual([1, 1]);
  await page.keyboard.press("Control+y");
  await expect.poll(() => weights(page)).not.toEqual([1, 1]);
  await dragBlock(page, "notes", "gallery-block", "right");
  await expect(columns).toHaveCount(3);
  await page.screenshot({ path: info.outputPath("drag-three-columns.png"), fullPage: true });
  await dragBlock(page, "notes", "intro", "after");
  await expect(columns).toHaveCount(2);
  await expect.poll(async () => JSON.stringify((await saved(page)).imageGroups)).toBe(original);
  await page.keyboard.press("Control+s");
  await expect.poll(async () => (await saved(page)).document.blocks.some((b: { type: string }) => b.type === "columnList")).toBe(true);
  await page.reload();
  await expect(page.locator(".bn-editor .bn-block-column")).toHaveCount(2);
  await expect(tiles).toHaveCount(2);
  await dragBlock(page, "gallery-block", "notes", "after");
  await expect(columns).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(columns).toHaveCount(2);
  await page.keyboard.press("Control+y");
  await expect(columns).toHaveCount(0);
});

test("exports a column gallery to real PDF, DOCX and long-image files", async ({ page }, info) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await seed(page);
  await createTwoColumns(page);
  for (const format of ["PDF", "DOCX"] as const) {
    await page.getByRole("button", { name: "导出", exact: true }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: `导出 ${format}`, exact: true }).click();
    const file = await download; const path = info.outputPath(`columns.${format.toLowerCase()}`); await file.saveAs(path);
    const bytes = await readFile(path);
    if (format === "PDF") expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    else {
      const archive = await unzipDocx(bytes); const xml = new TextDecoder().decode(archive.get("word/document.xml")!);
      expect(xml.match(/<wp:docPr /g)).toHaveLength(1);
      expect(xml).toContain("w:tbl");
    }
  }
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await page.getByRole("menuitem", { name: "导出长图", exact: true }).click();
  await page.screenshot({ path: info.outputPath("long-image-dialog.png"), fullPage: true });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "开始导出", exact: true }).click();
  const file = await download; await file.saveAs(info.outputPath(file.suggestedFilename()));
});

test("resizes a scaled image and moves it between column galleries with undo", async ({ page }, info) => {
  const value = { ...fixture,
    document: { ...fixture.document, blocks: [{ id: "row", type: "columnList", props: {}, children: [
      { id: "left", type: "column", props: { width: 1 }, children: [fixture.document.blocks[1]] },
      { id: "right", type: "column", props: { width: 1 }, children: [{ id: "target-block", type: "imageGroup", props: { groupId: "target" }, children: [] }] },
    ] }] }, imageGroups: [...fixture.imageGroups, { ...fixture.imageGroups[0], id: "target", name: "目标图片组", images: [] }],
  };
  await page.setViewportSize({ width: 1500, height: 1000 }); await seed(page, value);
  await page.getByRole("button", { name: "恢复 100% 缩放" }).click();
  const source = page.locator('.preshot-image-drag-target-group[data-image-group-id="gallery"]');
  const target = page.locator('.preshot-image-drag-target-group[data-image-group-id="target"]');
  const tile = source.locator('[data-image-id="one"]');
  const initial = await tile.boundingBox();
  const handle = source.getByRole("separator", { name: "从right调整参考图 1", exact: true });
  const box = await handle.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2); await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 24, box!.y + box!.height / 2, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await tile.boundingBox())!.width).toBeGreaterThan(initial!.width + 15);
  expect((await tile.boundingBox())!.height).toBeCloseTo(initial!.height, 0);
  await page.screenshot({ path: info.outputPath("resized-image.png"), fullPage: true });
  const from = await source.getByRole("button", { name: "选择参考图 1", exact: true }).boundingBox();
  const to = await target.boundingBox();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2); await page.mouse.down();
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 18 }); await page.mouse.up();
  await expect(source.locator("[data-image-id]")).toHaveCount(1);
  await expect(target.locator("[data-image-id]")).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await expect(source.locator("[data-image-id]")).toHaveCount(2);
  await expect(target.locator("[data-image-id]")).toHaveCount(0);
});

test("keeps column image controls behind the settings modal", async ({ page }, info) => {
  await page.setViewportSize({ width: 1500, height: 1000 }); await seed(page);
  await createTwoColumns(page);
  const control = page.locator('[data-content-type="imageGroup"]').getByRole("button", { name: "添加图片", exact: true }).first();
  const box = await control.boundingBox();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "设置", exact: true })).toBeVisible();
  const editorOnTop = await page.evaluate(({x,y}) => Boolean(document.elementFromPoint(x,y)?.closest('[data-editor-engine="blocknote"]')), {x:box!.x+box!.width/2,y:box!.y+box!.height/2});
  expect(editorOnTop).toBe(false);
  await page.screenshot({path:info.outputPath("settings-modal.png"),fullPage:true});
});

for (const direction of ["缩小画布", "放大画布"]) {
  test(`cancels column resize and preserves image geometry after ${direction}`, async ({ page }) => {
    await page.setViewportSize({ width: 1800, height: 1100 });
    await seed(page);
    await page.getByRole("button", { name: "恢复 100% 缩放" }).click();
    await createTwoColumns(page);
    for (let i = 0; i < 2; i++) await page.getByRole("button", { name: direction, exact: true }).click();
    const source = page.locator('.preshot-image-drag-target-group[data-image-group-id="gallery"]');
    const tile = source.locator('[data-image-id="one"]');
    const before = await tile.boundingBox();
    const columns = page.locator(".bn-editor .bn-block-column");
    const left = await columns.nth(0).boundingBox(); const right = await columns.nth(1).boundingBox();
    const x = (left!.x + left!.width + right!.x) / 2; const y = left!.y + 50;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x - 35, y, { steps: 5 });
    await page.keyboard.press("Escape"); await page.mouse.up();
    expect(await weights(page)).toEqual([1, 1]);
    await expect.poll(async () => (await tile.boundingBox())!.width).toBeCloseTo(before!.width, 0);
    const handle = await source.getByRole("separator", { name: "从right调整参考图 1", exact: true }).boundingBox();
    const hx = handle!.x + handle!.width / 2; const hy = handle!.y + handle!.height / 2;
    await page.mouse.move(hx, hy); await page.mouse.down();
    await page.mouse.move(hx + 20, hy, { steps: 5 }); await page.mouse.up();
    await expect.poll(async () => (await tile.boundingBox())!.width).toBeCloseTo(before!.width + 20, 0);
    expect((await tile.boundingBox())!.height).toBeCloseTo(before!.height, 0);
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await tile.boundingBox())!.width).toBeCloseTo(before!.width, 0);
  });
}
