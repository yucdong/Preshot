import { expect, test } from "@playwright/test";

const storageKey = `preshot.browser-blocknote-plan-v15:${encodeURIComponent("C:\\Preshot Demo\\编辑大片示例")}`;
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const block = (id: string, type: string, props = {}, text?: string) => ({ id, type, props,
  ...(text ? { content: [{ type: "text", text, styles: {} }] } : {}), children: [] });
const rows = [
  [block("text", "paragraph", {}, "南京长江大桥 · 拍摄说明"), block("model", "modelCard", { artifactId: "model" })],
  [block("photo", "image", { url: "media/alignment.png", previewWidth: 260, name: "参考图", caption: "", showPreview: true }), block("prop", "prop", { artifactId: "prop" })],
  [block("group", "imageGroup", { groupId: "group" }), block("location", "shootingLocation", { artifactId: "location" })],
  [block("heading", "heading", { level: 1 }, "拍摄安排"), block("clothing", "clothing", { artifactId: "clothing" })],
];
const fixture = {
  schemaVersion: 17, title: "Mixed block alignment",
  document: { format: "preshot-blocks", version: 5, blocks: rows.map((children, i) => ({
    id: `row-${i}`, type: "columnList", props: {}, children: children.map((child, j) => ({
      id: `column-${i}-${j}`, type: "column", props: { width: 1 }, children: [child],
    })),
  })) },
  imageGroups: [{ id: "group", name: "参考图片", type: "reference", x: 0, width: 1008, height: 258,
    description: "", images: [{ id: "reference", file: "references/alignment.png", aspectRatio: 1,
      sourceWidth: 1, sourceHeight: 1, frameWidth: 200, frameHeight: 200 }] }],
  artifacts: [
    { id: "model", kind: "modelCard", revision: 0, modelId: "模特 A", heightCm: 170, weightKg: 50, shoeSize: "38", samples: { id: "model-gallery", images: [] } },
    { id: "prop", kind: "prop", revision: 0, title: "透明伞", source: "自备", gallery: { id: "prop-gallery", images: [] } },
    { id: "location", kind: "shootingLocation", revision: 0, venueName: "南京长江大桥", address: "南京", description: "日落前", gallery: { id: "location-gallery", images: [] } },
    { id: "clothing", kind: "clothing", revision: 0, title: "浅色长裙", source: "自备", mainGallery: { id: "clothing-gallery", images: [] }, tryOn: { expanded: false, gallery: { id: "try-on-gallery", images: [] } } },
  ],
};
const visibleContent = '.preshot-artifact-block, .bn-inline-content, .bn-visual-media-wrapper, .preshot-image-group-heading';

for (const zoom of [100, 70, 130]) test(`mixed column blocks and their drag handles share a top edge at ${zoom}%`, async ({ page }, info) => {
  await page.setViewportSize({ width: 1500, height: 1050 });
  await page.addInitScript(({ storageKey, fixture, png }) => {
    sessionStorage.setItem(storageKey, JSON.stringify(fixture));
    sessionStorage.setItem("preshot.browser-blocknote-media:media/alignment.png", png);
  }, { storageKey, fixture, png });
  await page.goto("/");
  await expect(page.locator(".bn-editor .bn-block-column")).toHaveCount(8);
  await page.getByRole("button", { name: "恢复 100% 缩放" }).click();
  if (zoom !== 100) for (let i = 0; i < 2; i++) await page.getByRole("button", { name: zoom < 100 ? "缩小画布" : "放大画布", exact: true }).click();
  const measurements = [];
  for (const pair of rows) {
    const boxes = [];
    for (const item of pair) {
      const content = page.locator(`.bn-editor .bn-block-content[data-content-type="${item.type}"]`).filter({ has: page.locator(visibleContent) }).first();
      const surface = content.locator(visibleContent).first();
      await surface.scrollIntoViewIfNeeded();
      await surface.hover({ position: { x: 35, y: 5 } });
      const handle = page.locator(".preshot-block-drag-trigger:visible").last();
      await expect(handle).toBeVisible();
      const top = (await surface.boundingBox())!.y;
      await expect.configure({ soft: true }).poll(async () => Math.abs((await handle.boundingBox())!.y - (await surface.boundingBox())!.y), { message: `${item.type} handle top`, timeout: 1000 }).toBeLessThan(1.5);
      boxes.push({ type: item.type, top, handle: (await handle.boundingBox())!.y,
        padding: await content.evaluate(el => getComputedStyle(el).paddingTop) });
    }
    // Re-read both after scrolling so the coordinates share the same viewport.
    const tops = await Promise.all(pair.map(item => page.locator(`.bn-editor .bn-block-content[data-content-type="${item.type}"]`).first().locator(visibleContent).first().evaluate(el => el.getBoundingClientRect().top)));
    expect.soft(Math.abs(tops[0] - tops[1]), `${pair.map(item => item.type).join(" / ")} top alignment`).toBeLessThan(1.5);
    measurements.push(boxes);
    await page.screenshot({ path: info.outputPath(`${pair[0].id}-${pair[1].id}.png`), animations: "disabled" });
  }
  await info.attach("alignment-measurements", { body: JSON.stringify(measurements, null, 2), contentType: "application/json" });
});
