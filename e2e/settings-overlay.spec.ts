import { expect, test } from "@playwright/test";

interface SettingsFixtureEditor {
  document: Array<{ id: string }>;
  uploadFile(file: File): Promise<string | { url?: string }>;
  replaceBlocks(current: Array<{ id: string }>, blocks: Array<{
    id?: string; type: string; props?: Record<string, unknown>; content?: string;
  }>): void;
  updateBlock(id: string, update: { props: Record<string, unknown> }): void;
  getBlock(id: string): { props: Record<string, unknown> } | undefined;
}

test("settings theme and language clicks stay above a selected native image resize edge", async ({ page }, info) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await expect(page.locator(".bn-editor")).toBeVisible();
  await page.evaluate(async () => {
    const editor = (window as typeof window & {
      __PRESHOT_BLOCKNOTE_EDITOR__?: SettingsFixtureEditor;
    }).__PRESHOT_BLOCKNOTE_EDITOR__;
    if (!editor) throw new Error("Expected the real BlockNote editor");
    const canvas = document.createElement("canvas");
    canvas.width = 600; canvas.height = 400;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#79a6b4";
    context.fillRect(0, 0, 600, 400);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob(value => resolve(value!), "image/png"));
    const uploaded = await editor.uploadFile!(new File([blob], "settings-background.png", { type: "image/png" }));
    const url = typeof uploaded === "string" ? uploaded : String(uploaded.url);
    editor.replaceBlocks(editor.document, [
      ...Array.from({ length: 20 }, (_, index) => ({ type: "paragraph" as const, content: `拍摄准备 ${index + 1}` })),
      { id: "settings-background-image", type: "image", props: { url, name: "背景图片", previewWidth: 600, previewHeight: 350 } },
      ...Array.from({ length: 20 }, (_, index) => ({ type: "paragraph" as const, content: `拍摄安排 ${index + 1}` })),
    ]);
  });
  const image = page.locator('[data-id="settings-background-image"] .bn-visual-media-wrapper');
  await expect(image).toBeVisible();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  let settings = page.getByRole("dialog", { name: "设置", exact: true });
  await settings.getByRole("button", { name: "English", exact: true }).click();
  settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("button", { name: "Dark", exact: true }).click();
  const light = settings.getByRole("button", { name: "Light", exact: true });
  const box = await light.boundingBox();
  if (!box) throw new Error("Expected the Light theme button");
  const target = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await settings.getByRole("button", { name: "Close settings", exact: true }).click();

  // Resize the real image so its transparent right edge coincides with the
  // settings button, then scroll it into the same vertical range as the modal.
  await image.evaluate((element, point) => {
    const editor = (window as typeof window & {
      __PRESHOT_BLOCKNOTE_EDITOR__?: SettingsFixtureEditor;
    }).__PRESHOT_BLOCKNOTE_EDITOR__!;
    const rect = element.getBoundingClientRect();
    const scale = rect.width / 600;
    editor.updateBlock("settings-background-image", { props: { previewWidth: (point.x - rect.left + 8) / scale } });
  }, target);
  await image.click({ position: { x: 40, y: 40 } });
  await image.evaluate((element, point) => {
    const scroller = element.closest('[data-testid="canvas-scroller"]');
    if (!(scroller instanceof HTMLElement)) throw new Error("Expected document scroller");
    scroller.scrollTop += element.getBoundingClientRect().top - (point.y - 100);
  }, target);
  const edge = image.locator('[data-image-resize-edge="right"]');
  const edgeBox = await edge.boundingBox();
  if (!edgeBox) throw new Error("Expected native image resize edge");
  expect(target.x).toBeGreaterThan(edgeBox.x);
  expect(target.x).toBeLessThan(edgeBox.x + edgeBox.width);
  expect(target.y).toBeGreaterThan(edgeBox.y);
  expect(target.y).toBeLessThan(edgeBox.y + edgeBox.height);
  const imageBefore = await page.evaluate(() => (window as typeof window & {
    __PRESHOT_BLOCKNOTE_EDITOR__?: SettingsFixtureEditor;
  }).__PRESHOT_BLOCKNOTE_EDITOR__!.getBlock("settings-background-image")?.props);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  settings = page.getByRole("dialog", { name: "Settings", exact: true });
  const hit = await page.evaluate(point => {
    const element = document.elementFromPoint(point.x, point.y);
    return { tag: element?.tagName, className: element?.className,
      resizeEdge: element?.getAttribute("data-image-resize-edge"),
      inSettings: Boolean(element?.closest('[role="dialog"]')) };
  }, target);
  await info.attach("theme-button-hit-test", { body: JSON.stringify(hit), contentType: "application/json" });
  await page.screenshot({ path: info.outputPath("settings-over-selected-image.png") });
  await page.mouse.click(target.x, target.y);
  await expect(settings.getByRole("button", { name: "Light", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(hit.inSettings).toBe(true);
  await settings.getByRole("button", { name: "简体中文", exact: true }).click();
  settings = page.getByRole("dialog", { name: "设置", exact: true });
  await expect(settings.getByRole("button", { name: "浅色", exact: true })).toHaveAttribute("aria-pressed", "true");
  await settings.getByRole("button", { name: "关闭设置", exact: true }).click();
  await expect(page.getByRole("button", { name: "设置", exact: true })).toBeFocused();
  expect(await page.evaluate(() => (window as typeof window & {
    __PRESHOT_BLOCKNOTE_EDITOR__?: SettingsFixtureEditor;
  }).__PRESHOT_BLOCKNOTE_EDITOR__!.getBlock("settings-background-image")?.props)).toEqual(imageBefore);
});

test("standalone gallery heading and image count remain readable in both themes", async ({ page }, info) => {
  await page.goto("/");
  const editor = page.locator(".bn-editor");
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.type("/");
  await page.locator(".bn-suggestion-menu").getByText("图片组", { exact: true }).click();
  const heading = page.locator('[data-content-type="imageGroup"] .preshot-image-group-heading').first();
  await expect(heading).toBeVisible();
  for (const theme of ["浅色", "深色"]) {
    await page.getByRole("button", { name: "设置", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "设置", exact: true });
    await settings.getByRole("button", { name: theme, exact: true }).click();
    await settings.getByRole("button", { name: "关闭设置", exact: true }).click();
    const colors = await heading.evaluate(element => {
      const swatch = document.createElement("canvas");
      swatch.width = 1; swatch.height = 1;
      const context = swatch.getContext("2d")!;
      const rgb = (value: string) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = value;
        context.fillRect(0, 0, 1, 1);
        return Array.from(context.getImageData(0, 0, 1, 1).data);
      };
      const luminance = (values: number[]) => values.slice(0, 3).map(value => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      let background = "rgb(255, 255, 255)";
      for (let parent: Element | null = element; parent; parent = parent.parentElement) {
        const color = getComputedStyle(parent).backgroundColor;
        const components = rgb(color);
        if (components[3] === 255) { background = color; break; }
      }
      return ["h3", ".preshot-image-group-count"].map(selector => {
        const foreground = getComputedStyle(element.querySelector(selector)!).color;
        const a = luminance(rgb(foreground)), b = luminance(rgb(background));
        return { selector, foreground, background, contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
      });
    });
    await info.attach(`gallery-colors-${theme}`, { body: JSON.stringify(colors), contentType: "application/json" });
    await page.screenshot({ path: info.outputPath(`gallery-${theme === "浅色" ? "light" : "dark"}.png`) });
    for (const color of colors) expect.soft(color.contrast, `${theme} ${JSON.stringify(color)}`).toBeGreaterThanOrEqual(4.5);
  }
});
