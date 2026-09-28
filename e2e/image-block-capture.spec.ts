import { expect, test } from "@playwright/test";

interface CaptureFixtureEditor {
  document: Array<{ id: string }>;
  insertBlocks(blocks: Array<{ id: string; type: "image"; props: { url: string } }>, anchor: { id: string }, placement: "before"): void;
}

test("captures into a native image block and restores it after saving and reload", async ({ page }, testInfo) => {
  // The memory adapter supplies a PNG; this test never touches the system clipboard.
  await page.goto("/");
  await expect(page.getByRole("group", { name: "方案正文" })).toBeVisible();
  await page.evaluate(() => {
    const editor = (window as typeof window & { __PRESHOT_BLOCKNOTE_EDITOR__: CaptureFixtureEditor }).__PRESHOT_BLOCKNOTE_EDITOR__;
    editor.insertBlocks([{ id: "capture-image", type: "image", props: { url: "" } }], editor.document[0], "before");
  });
  const block = page.locator('[data-node-type="blockContainer"][data-id="capture-image"]');
  await block.locator(".bn-add-file-button").click();
  await expect(page.getByRole("tab", { name: "上传", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "嵌入", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "截图", exact: true })).toBeVisible();
  const controls = await Promise.all([
    page.getByRole("tab", { name: "上传", exact: true }).boundingBox(),
    page.getByRole("tab", { name: "嵌入", exact: true }).boundingBox(),
    page.getByRole("button", { name: "截图", exact: true }).boundingBox(),
  ]);
  const centers = controls.map((box) => box!.y + box!.height / 2);
  expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(2);
  expect(controls[2]!.x).toBeGreaterThanOrEqual(controls[1]!.x + controls[1]!.width);
  await page.screenshot({ path: testInfo.outputPath("image-capture-panel.png") });
  await page.getByRole("button", { name: "截图", exact: true }).click();
  const image = block.locator("img.bn-visual-media");
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  await page.keyboard.press("Control+s");
  await expect.poll(() => page.evaluate(() => Object.entries(sessionStorage)
    .filter(([key]) => key.startsWith("preshot.browser-blocknote-plan-v15:"))
    .some(([, value]) => {
      const block = JSON.parse(value).document.blocks.find((entry: { id: string }) => entry.id === "capture-image");
      return /^media\/.+\.png$/.test(block?.props.url ?? "");
    }))).toBe(true);
  await page.reload();
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
});
