import { expect, test, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  decodePDFRawStream,
  PDFArray,
  PDFDocument,
  PDFRawStream,
} from "pdf-lib";
import { unzipDocx } from "./docxTestArchive";

function pageContent(pdf: PDFDocument, pageIndex: number): string {
  const contents = pdf.getPages()[pageIndex].node.normalizedEntries().Contents;
  if (!(contents instanceof PDFArray)) return "";
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  for (let index = 0; index < contents.size(); index += 1) {
    const stream = pdf.context.lookup(contents.get(index));
    if (!(stream instanceof PDFRawStream)) continue;
    chunks.push(decoder.decode(decodePDFRawStream(stream).decode()));
  }
  return chunks.join("\n");
}

function pageImageDrawCount(pdf: PDFDocument, pageIndex: number): number {
  return pageContent(pdf, pageIndex).match(/\/I\d+\s+Do/g)?.length ?? 0;
}

function pageImageDrawBoxes(
  pdf: PDFDocument,
  pageIndex: number,
): Array<{ width: number; height: number; x: number; y: number }> {
  return [...pageContent(pdf, pageIndex).matchAll(
    /(-?[\d.]+)\s+0\s+0\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+cm\s+\/I\d+\s+Do/g,
  )].map((match) => ({
    width: Math.abs(Number(match[1])),
    height: Math.abs(Number(match[2])),
    x: Number(match[3]),
    y: Number(match[4]),
  }));
}

function pngDimensions(bytes: Uint8Array): {
  width: number;
  height: number;
} {
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
  };
}

function jpegDimensions(bytes: Uint8Array): {
  width: number;
  height: number;
} {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error("Expected a JPEG SOI signature");
  }
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1]!;
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.length) {
      throw new Error("Invalid JPEG segment length");
    }
    if (
      marker >= 0xc0 &&
      marker <= 0xc3
    ) {
      return {
        height: (bytes[offset + 3]! << 8) | bytes[offset + 4]!,
        width: (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
      };
    }
    offset += length;
  }
  throw new Error("JPEG dimensions were not found");
}

async function openExportMenu(page: Page, format: "PDF" | "DOCX") {
  const trigger = page.getByRole("button", { name: "导出", exact: true });
  await trigger.click();
  const option = page.getByRole("menuitem", {
    name: `导出 ${format}`,
    exact: true,
  });
  await expect(option).toBeVisible();
  return { option, trigger };
}

test("operates the production export menu by mouse and keyboard", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 700 });
  await page.goto("/");

  const trigger = page.getByRole("button", { name: "导出", exact: true });
  await expect(trigger).toHaveCount(1);
  await expect(trigger).toHaveAttribute("aria-haspopup", "menu");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toHaveAttribute("title", "导出");
  await expect(page.getByRole("menu", { name: "导出格式" })).toHaveCount(0);

  const toolbarBox = await trigger.locator(
    "xpath=ancestor::div[contains(@class,'h-11')][1]",
  ).boundingBox();
  const triggerBox = await trigger.boundingBox();
  if (!toolbarBox || !triggerBox) throw new Error("Expected export toolbar geometry");
  expect(toolbarBox.x + toolbarBox.width - triggerBox.x - triggerBox.width)
    .toBeCloseTo(16, 0);

  await trigger.click();
  const menu = page.getByRole("menu", { name: "导出格式" });
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(menu.getByRole("menuitem").allTextContents()).resolves.toEqual([
    "导出 PDF",
    "导出 DOCX",
    "导出长图",
  ]);
  const menuBox = await menu.boundingBox();
  if (!menuBox) throw new Error("Expected export menu geometry");
  expect(menuBox.y).toBeGreaterThanOrEqual(triggerBox.y + triggerBox.height);
  expect(menuBox.x).toBeGreaterThanOrEqual(0);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(1280);
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(700);

  await trigger.click();
  await expect(menu).toHaveCount(0);
  await trigger.click();
  await page.locator(".bn-editor").click();
  await expect(menu).toHaveCount(0);

  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Space");
  await expect(menu).toHaveCount(0);

  await page.keyboard.press("ArrowDown");
  const pdfOption = page.getByRole("menuitem", { name: "导出 PDF" });
  const docxOption = page.getByRole("menuitem", { name: "导出 DOCX" });
  const longImageOption = page.getByRole("menuitem", { name: "导出长图" });
  await expect(pdfOption).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(docxOption).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(longImageOption).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(docxOption).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await page.keyboard.press("ArrowUp");
  await expect(longImageOption).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(menu).toHaveCount(0);
  await expect(trigger).not.toBeFocused();
  expect(await page.evaluate(() => document.activeElement === document.body))
    .toBe(false);
});

test("opts into splitting and downloads one offline 900px JPEG long image", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const editor = page.locator(".bn-editor");
  await editor.click();
  await page.keyboard.type("长图浏览器导出验收");

  const externalRequests: string[] = [];
  const appOrigin = new URL(page.url()).origin;
  let exporting = false;
  page.on("request", (request) => {
    if (!exporting) return;
    const url = request.url();
    if (/^https?:\/\//i.test(url) && new URL(url).origin !== appOrigin) {
      externalRequests.push(url);
    }
  });

  const trigger = page.getByRole("button", { name: "导出", exact: true });
  await trigger.click();
  await page.getByRole("menuitem", { name: "导出长图" }).click();

  const dialog = page.getByRole("dialog", { name: "导出长图" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "微信兼容" })).toBeFocused();
  await expect(dialog.getByRole("radio", { name: "微信兼容" })).toBeChecked();
  await expect(dialog.getByLabel("图片格式")).toHaveValue("jpeg");
  await expect(dialog.getByRole("radio", { name: "900 px" })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "自动分图" }))
    .not.toBeChecked();
  await expect(dialog.getByText(
    "默认将整个文档导出为一张长图；勾选“自动分图”后，才会按完整区块边界导出多张连续图片。",
  )).toBeVisible();
  await dialog.getByText("无损 PNG", { exact: true }).click();
  await expect(dialog.getByRole("checkbox", { name: "自动分图" }))
    .not.toBeChecked();
  await expect(dialog.getByLabel("JPEG 体积目标")).toBeDisabled();
  await dialog.getByLabel("图片格式").selectOption("jpeg");
  await expect(dialog.getByRole("checkbox", { name: "自动分图" }))
    .not.toBeChecked();
  await dialog.getByText("890 px", { exact: true }).click();
  await expect(dialog.getByRole("checkbox", { name: "自动分图" }))
    .not.toBeChecked();
  await dialog.getByText("900 px", { exact: true }).click();
  await dialog.getByRole("checkbox", { name: "自动分图" }).check();
  await expect(dialog.getByRole("checkbox", { name: "自动分图" }))
    .toBeChecked();

  await trigger.evaluate((button) => {
    const target = window as typeof window & {
      __PRESHOT_LONG_IMAGE_PROGRESS_SEEN__?: boolean;
    };
    target.__PRESHOT_LONG_IMAGE_PROGRESS_SEEN__ = false;
    const observer = new MutationObserver(() => {
      if (
        button.textContent?.includes("正在导出长图…") &&
        button.getAttribute("aria-disabled") === "true"
      ) {
        target.__PRESHOT_LONG_IMAGE_PROGRESS_SEEN__ = true;
        observer.disconnect();
      }
    });
    observer.observe(button, {
      attributes: true,
      childList: true,
      subtree: true,
    });
  });
  const downloadPromise = page.waitForEvent("download");
  exporting = true;
  await dialog.getByRole("button", { name: "开始导出" }).click();
  await expect(dialog).toHaveCount(0);
  const download = await downloadPromise;
  const imagePath = testInfo.outputPath("production-long-image.jpg");
  await download.saveAs(imagePath);
  await expect(trigger).toHaveAccessibleName("导出", { timeout: 30_000 });
  expect(await page.evaluate(() =>
    (window as typeof window & {
      __PRESHOT_LONG_IMAGE_PROGRESS_SEEN__?: boolean;
    }).__PRESHOT_LONG_IMAGE_PROGRESS_SEEN__
  )).toBe(true);
  exporting = false;

  const bytes = new Uint8Array(await readFile(imagePath));
  expect([...bytes.slice(0, 2)]).toEqual([0xff, 0xd8]);
  const dimensions = jpegDimensions(bytes);
  expect(dimensions.width).toBe(900);
  expect(dimensions.height).toBeGreaterThan(0);
  expect(dimensions.height).toBeLessThanOrEqual(6_000);
  expect(bytes.length).toBeLessThanOrEqual(1_048_576);
  expect(download.suggestedFilename()).toMatch(/\.jpg$/);
  expect(externalRequests).toEqual([]);
  await testInfo.attach("production long image", {
    path: imagePath,
    contentType: "image/jpeg",
  });

  const reviewArtifactDirectory =
    process.env.PRESHOT_LONG_IMAGE_REVIEW_ARTIFACTS;
  if (reviewArtifactDirectory) {
    const directory = resolve(reviewArtifactDirectory);
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, "browser-production-900.jpg"), bytes);
    await writeFile(
      resolve(directory, "browser-production-summary.json"),
      JSON.stringify({
        bytes: bytes.length,
        dimensions,
        externalRequests,
        filename: download.suggestedFilename(),
        signature: [...bytes.slice(0, 2)],
        targetBytes: 1_048_576,
        targetHeight: 6_000,
      }, null, 2),
    );
  }
});

test("creates, edits, saves, and exports a BlockNote v15 project", async ({ page }) => {
  await page.goto("/");
  const editor = page.locator('[data-editor-engine="blocknote"]');
  await expect(editor).toBeVisible();
  await expect(page.getByTestId("plan-document-canvas")).toHaveCount(1);
  await expect(page.getByTestId("canvas-page-background")).toHaveCount(0);
  await expect(page.locator(".bn-editor")).toBeVisible();

  await page.locator(".bn-editor").click();
  await page.keyboard.type("BlockNote 文档");
  const blocksBeforeEnter = await page.locator(".bn-block-outer").count();
  await page.keyboard.press("Enter");
  await expect(page.locator(".bn-block-outer")).toHaveCount(
    blocksBeforeEnter + 1,
  );
  await page.keyboard.type("第二行");
  await expect(page.locator(".bn-editor").locator("p")).toContainText([
    "BlockNote 文档",
    "第二行",
  ]);
  await page.keyboard.type("/");
  await page.getByText("图片组", { exact: true }).click();
  const group = page.locator(".preshot-blocknote-image-group");
  await expect(group).toBeVisible();
  await expect(group.getByRole("button", { name: "添加图片" }).first())
    .toHaveAttribute("title", "插入图片");
  await expect(group.getByRole("button", { name: "截图" }))
    .toHaveAttribute("title", "截图");
  await expect(group.getByRole("button", { name: "删除图片组" }))
    .toHaveAttribute("title", "删除图片组");
  await expect(group.getByText("图片组", { exact: true }))
    .toHaveAttribute("title", "拖动图片组");
  await expect.poll(() => group.locator(
    ".preshot-blocknote-image-group-toolbar",
  ).evaluate((toolbar) =>
    Array.from(toolbar.children).map((element) =>
      getComputedStyle(element).cursor),
  )).toEqual(["default", "default", "default", "default"]);
  const blockContent = group.locator(
    'xpath=ancestor::div[@data-content-type="imageGroup"]',
  );
  const groupBox = await group.boundingBox();
  const contentBox = await blockContent.boundingBox();
  if (!groupBox || !contentBox) {
    throw new Error("Expected image-group content geometry");
  }
  expect(groupBox.x).toBeCloseTo(contentBox.x, 0);
  expect(groupBox.x + groupBox.width).toBeCloseTo(
    contentBox.x + contentBox.width,
    0,
  );
  const canvas = page.getByTestId("plan-document-canvas");
  const canvasBeforeZoom = await canvas.boundingBox();
  if (!canvasBeforeZoom) throw new Error("Expected continuous canvas geometry");
  expect(await canvas.evaluate((element) => Number.parseFloat(
    getComputedStyle(element).width,
  ))).toBeCloseTo(1080, 1);
  const scrollerBox = await page.getByTestId("canvas-scroller").boundingBox();
  if (!scrollerBox) throw new Error("Expected canvas scroller geometry");
  expect(canvasBeforeZoom.x - scrollerBox.x).toBeLessThanOrEqual(25);
  expect(scrollerBox.x + scrollerBox.width - canvasBeforeZoom.x - canvasBeforeZoom.width)
    .toBeLessThanOrEqual(25);
  const initialZoom = Number.parseInt(
    (await page.getByRole("button", { name: "恢复 100% 缩放" }).textContent()) ?? "",
    10,
  );
  await page.mouse.move(
    canvasBeforeZoom.x + canvasBeforeZoom.width / 2,
    canvasBeforeZoom.y + 180,
  );
  await page.mouse.wheel(0, -120);
  await expect(page.getByRole("button", { name: "恢复 100% 缩放" }))
    .toHaveText(`${initialZoom}%`);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -120);
  await page.keyboard.up("Control");
  await expect(page.getByRole("button", { name: "恢复 100% 缩放" }))
    .toHaveText(`${initialZoom + 15}%`);
  await expect.poll(async () => (await canvas.boundingBox())?.width ?? 0)
    .toBeGreaterThan(canvasBeforeZoom.width);
  await group.getByRole("button", { name: "添加图片" }).first().click();
  await expect(group.locator("[data-image-id]")).toHaveCount(2);
  await expect.poll(async () => {
    const frames = await group.locator("[data-image-id]").evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        const image = element.querySelector("img");
        return {
          width: rect.width,
          height: rect.height,
          naturalWidth: image?.naturalWidth ?? 0,
          naturalHeight: image?.naturalHeight ?? 0,
        };
      }),
    );
    return frames.every((frame) =>
      frame.naturalWidth > 0 &&
      frame.naturalHeight > 0 &&
      Math.abs(
        frame.width / frame.height -
        frame.naturalWidth / frame.naturalHeight,
      ) < 0.02,
    ) && Math.abs(frames[0].height - frames[1].height) < 1;
  }).toBe(true);
  await expect(group.locator("[data-image-resize-edge]")).toHaveCount(16);
  await expect(group.locator("[data-group-resize-edge]")).toHaveCount(0);
  const firstImageButton = group.getByRole("button", {
    name: "选择参考图 1",
  });

  await firstImageButton.click();
  await expect(firstImageButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("dialog", { name: "参考图" })).toHaveCount(0);
  await firstImageButton.dblclick();
  await expect(page.getByRole("dialog", { name: "参考图" })).toBeVisible();
  await page.getByRole("button", { name: "关闭图片" }).click();

  const firstFrame = group.locator("[data-image-id]").nth(0);
  const firstFrameBeforeResize = await firstFrame.boundingBox();
  const firstWidth = firstFrameBeforeResize?.width ?? 0;
  const firstHeight = firstFrameBeforeResize?.height ?? 0;
  const firstRatio = firstFrameBeforeResize
    ? firstFrameBeforeResize.width / firstFrameBeforeResize.height
    : 0;
  const rightEdge = firstFrame.locator('[data-image-resize-edge="right"]');
  await rightEdge.evaluate((handle) => {
    const rect = handle.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    handle.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      clientX,
      clientY,
      pointerId: 201,
    }));
    document.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      clientX: clientX + 18,
      clientY,
      pointerId: 201,
    }));
    document.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      clientX: clientX + 18,
      clientY,
      pointerId: 201,
    }));
  });
  await expect.poll(async () => (await firstFrame.boundingBox())?.width ?? 0)
    .toBeGreaterThan(firstWidth);
  await expect.poll(async () => (await firstFrame.boundingBox())?.height ?? 0)
    .toBeCloseTo(firstHeight, 0);
  await expect.poll(async () => {
    const box = await firstFrame.boundingBox();
    return box ? box.width / box.height : 0;
  }).toBeGreaterThan(firstRatio);

  const sourceIds = await group.locator("[data-image-id]").evaluateAll((frames) =>
    frames.map((frame) => (frame as HTMLElement).dataset.imageId ?? ""));
  const sourceGroupId = await group.getAttribute("data-image-group-id");
  const firstBox = await group.locator(`[data-image-id="${sourceIds[0]}"]`).boundingBox();
  const secondBox = await group.locator(`[data-image-id="${sourceIds[1]}"]`).boundingBox();
  if (!firstBox || !secondBox || !sourceGroupId) {
    throw new Error("Expected BlockNote image drag geometry");
  }
  await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(secondBox.x + secondBox.width - 3, secondBox.y + secondBox.height / 2, {
    steps: 8,
  });
  await expect(page.getByRole("dialog", { name: "参考图" })).toHaveCount(0);
  await expect(page.locator("[data-image-drag-overlay]")).toBeVisible();
  await expect(group.locator(
    `[data-image-placeholder-id="${sourceIds[0]}"]`,
  )).toHaveAttribute("data-image-drag-target-insertion", "true");
  await expect.poll(async () =>
    group.locator("[data-image-id]").evaluateAll((frames) =>
      frames.map((frame) => (frame as HTMLElement).dataset.imageId ?? "")),
  ).toEqual([sourceIds[1]]);
  await expect.poll(async () => {
    const box = await group.locator(
      `[data-image-id="${sourceIds[1]}"]`,
    ).boundingBox();
    return box ? { x: Math.round(box.x), y: Math.round(box.y) } : null;
  }).toEqual({ x: Math.round(firstBox.x), y: Math.round(firstBox.y) });
  expect(await page.evaluate(({ groupId, ids }) => {
    const projectPath = "C:\\Preshot Demo\\编辑大片示例";
    const stored = sessionStorage.getItem(
      `preshot.browser-blocknote-plan-v15:${encodeURIComponent(projectPath)}`,
    );
    const plan = stored ? JSON.parse(stored) : null;
    return plan?.imageGroups
      ?.find((entry: { id: string }) => entry.id === groupId)
      ?.images.map((image: { id: string }) => image.id) ?? ids;
  }, { groupId: sourceGroupId, ids: sourceIds })).toEqual(sourceIds);
  await page.mouse.up();
  await expect.poll(async () =>
    group.locator("[data-image-id]").evaluateAll((frames) =>
      frames.map((frame) => (frame as HTMLElement).dataset.imageId ?? "")),
  ).toEqual([sourceIds[1], sourceIds[0]]);
  await expect(page.getByTestId("save-status")).toHaveText(
    "已保存所有更改",
    { timeout: 10_000 },
  );
  await expect.poll(() => page.evaluate((groupId) => {
    const projectPath = "C:\\Preshot Demo\\编辑大片示例";
    const stored = sessionStorage.getItem(
      `preshot.browser-blocknote-plan-v15:${encodeURIComponent(projectPath)}`,
    );
    const plan = stored ? JSON.parse(stored) : null;
    return plan?.imageGroups
      ?.find((entry: { id: string }) => entry.id === groupId)
      ?.images.map((image: { id: string }) => image.id);
  }, sourceGroupId)).toEqual([sourceIds[1], sourceIds[0]]);

  await page.getByRole("button", { name: "适合宽度" }).click();
  const blockOuter = group.locator(
    'xpath=ancestor::div[@data-node-type="blockOuter"]',
  );
  await blockOuter.hover();
  await page.getByRole("button", { name: "打开菜单" }).click();
  await page.getByText("复制 block", { exact: true }).click();
  await expect(page.locator(".preshot-blocknote-image-group")).toHaveCount(2);
  const groupIds = await page.locator(".preshot-blocknote-image-group")
    .evaluateAll((groups) =>
      groups.map((entry) => entry.getAttribute("data-image-group-id")));
  expect(new Set(groupIds).size).toBe(2);

  const duplicate = page.locator(".preshot-blocknote-image-group").nth(1);
  await duplicate.getByRole("button", { name: "删除图片组" }).click();
  await expect(page.locator(".preshot-blocknote-image-group")).toHaveCount(1);
  await expect(page.locator(".preshot-block-operation-toast"))
    .toContainText("已删除 block");
  await page.getByRole("button", { name: "撤销" }).click();
  await expect(page.locator(".preshot-blocknote-image-group")).toHaveCount(2);

  const restoredDuplicate = page.locator(
    ".preshot-blocknote-image-group",
  ).nth(1);
  const duplicateOuter = restoredDuplicate.locator(
    'xpath=ancestor::div[@data-node-type="blockOuter"]',
  );
  await duplicateOuter.hover();
  await page.getByRole("button", { name: "打开菜单" }).click();
  await page.getByText("删除 block", { exact: true }).click();
  await expect(page.locator(".preshot-blocknote-image-group")).toHaveCount(1);

  await expect(page.getByTestId("save-status")).toHaveText(
    "已保存所有更改",
    { timeout: 10_000 },
  );

  const { option, trigger } = await openExportMenu(page, "PDF");
  await option.click();
  await expect(trigger).toHaveText("导出", { timeout: 30_000 });
});

test("creates and persists a merged prop information field", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".bn-editor").click();
  await page.keyboard.type("/");
  const menuItems = page.locator('[role="option"]');
  await expect(menuItems.filter({ hasText: "图片组" }).first()).toBeVisible();
  await expect(menuItems.filter({ hasText: "拍摄场地" }).first()).toBeVisible();
  await expect(menuItems.filter({ hasText: "模特信息" }).first()).toBeVisible();
  await expect(menuItems.filter({ hasText: "服装" }).first()).toBeVisible();
  await expect(menuItems.filter({ hasText: "道具" }).first()).toBeVisible();
  await page.getByText("道具", { exact: true }).click();

  const prop = page.locator('[data-artifact-kind="prop"]');
  await expect(prop).toBeVisible();
  const propName = prop.getByRole("textbox", { name: "道具名称" });
  const info = prop.getByRole("textbox", { name: /道具信息/ });
  await propName.fill("磨砂铝反光板");
  await propName.blur();
  await info.fill("Studio Supply / 徐汇仓");
  await info.blur();

  await page.keyboard.press("Control+S");
  await expect(page.getByText("已保存所有更改")).toBeVisible();
  const persisted = await page.evaluate(() => {
    const values = Object.values(sessionStorage);
    const raw = values.find((value) =>
      value.includes('"schemaVersion":15') &&
      value.includes('"kind":"prop"')
    );
    return raw ? JSON.parse(raw) : null;
  });
  expect(persisted).toMatchObject({
    schemaVersion: 15,
    document: { version: 3 },
    artifacts: [{
      kind: "prop",
      title: "磨砂铝反光板",
      source: "Studio Supply / 徐汇仓",
    }],
  });

  await page.reload();
  const restored = page.locator('[data-artifact-kind="prop"]');
  await expect(restored).toBeVisible();
  await expect(
    restored.getByRole("textbox", { name: "道具名称" }),
  ).toHaveValue("磨砂铝反光板");
  await expect(
    restored.getByRole("textbox", { name: /道具信息/ }),
  ).toHaveValue("Studio Supply / 徐汇仓");
  await restored.getByRole("textbox", { name: /道具信息/ })
    .fill("");
  await restored.getByRole("textbox", { name: /道具信息/ }).blur();
  await page.locator(".bn-editor p").first().click();
  await expect(restored.getByRole("textbox", { name: /道具信息/ }))
    .toHaveValue("");
});

test("keeps model information and samples compact and equal-height", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const projectPath = "C:\\Preshot Demo\\编辑大片示例";
    const key =
      `preshot.browser-blocknote-plan-v15:${encodeURIComponent(projectPath)}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(
      key,
      JSON.stringify({
        schemaVersion: 15,
        title: "Compact model card",
        document: {
          format: "preshot-blocks",
          version: 3,
          blocks: [{
            id: "model-block",
            type: "modelCard",
            props: { artifactId: "model" },
            children: [],
          }],
        },
        imageGroups: [],
        artifacts: [{
          id: "model",
          kind: "modelCard",
          revision: 0,
          modelId: "林夏",
          heightCm: 168,
          weightKg: 48,
          shoeSize: "38",
          samples: {
            id: "model-samples",
            images: [],
          },
        }],
      }),
    );
  });
  await page.goto("/");

  const model = page.locator('[data-artifact-kind="modelCard"]');
  await expect(model.getByRole("group", { name: "模特信息" })).toBeVisible();
  await expect(model.locator("[data-image-id]")).toHaveCount(0);
  const dimensions = await model.evaluate((element) => {
    const information = element.querySelector(
      ".preshot-balanced-model-fields",
    ) as HTMLElement;
    const gallery = element.querySelector(
      ".preshot-blocknote-image-group",
    ) as HTMLElement;
    const layout = element.querySelector(
      ".preshot-artifact-balanced-layout",
    ) as HTMLElement;
    return {
      informationHeight: information.offsetHeight,
      galleryHeight: gallery.offsetHeight,
      layoutHeight: layout.offsetHeight,
    };
  });
  expect(Math.abs(
    dimensions.informationHeight - dimensions.galleryHeight,
  )).toBeLessThanOrEqual(1);
  expect(dimensions.layoutHeight).toBeLessThan(280);

  const notes = model.getByRole("textbox", { name: "其他信息" });
  await expect(notes).toHaveValue("");
  expect(await notes.evaluate((element) => element.getBoundingClientRect().height))
    .toBeLessThanOrEqual(50);
  await notes.fill("可自备黑色长靴\n周末档期需提前确认");
  await notes.blur();
  await expect.poll(() => model.evaluate((element) => {
    const information = element.querySelector(
      ".preshot-balanced-model-fields",
    ) as HTMLElement;
    const gallery = element.querySelector(
      ".preshot-blocknote-image-group",
    ) as HTMLElement;
    return Math.abs(information.offsetHeight - gallery.offsetHeight);
  })).toBeLessThanOrEqual(1);
  await page.keyboard.press("Control+s");
  await expect(page.getByTestId("save-status")).toHaveText(
    "已保存所有更改",
    { timeout: 10_000 },
  );
  await expect.poll(() => page.evaluate(() => {
    const projectPath = "C:\\Preshot Demo\\编辑大片示例";
    const stored = sessionStorage.getItem(
      `preshot.browser-blocknote-plan-v15:${encodeURIComponent(projectPath)}`,
    );
    const plan = stored ? JSON.parse(stored) : null;
    return plan?.artifacts?.find(
      (artifact: { id: string }) => artifact.id === "model",
    )?.notes;
  })).toBe("可自备黑色长靴\n周末档期需提前确认");
});

test("keeps artifact cards full-width and ignores legacy card layout", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const projectPath = "C:\\Preshot Demo\\编辑大片示例";
    const key =
      `preshot.browser-blocknote-plan-v15:${encodeURIComponent(projectPath)}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(
      key,
      JSON.stringify({
        schemaVersion: 15,
        title: "Artifact row layout",
        document: {
          format: "preshot-blocks",
          version: 3,
          blocks: [
            {
              id: "model-block",
              type: "modelCard",
              props: { artifactId: "model" },
              children: [],
            },
            {
              id: "prop-block",
              type: "prop",
              props: { artifactId: "prop" },
              children: [],
            },
          ],
        },
        imageGroups: [],
        artifacts: [
          {
            id: "model",
            kind: "modelCard",
            revision: 0,
            modelId: "林夏",
            heightCm: 168,
            weightKg: 48,
            shoeSize: "38",
            layout: {
              widthRatio: 0.5,
              offsetRatio: 0.25,
              minHeight: 600,
            },
            samples: { id: "model-samples", images: [] },
          },
          {
            id: "prop",
            kind: "prop",
            revision: 0,
            title: "圆形反光板",
            source: "银白双面，直径 110 cm",
            gallery: { id: "prop-gallery", images: [] },
          },
        ],
      }),
    );
  });
  await page.goto("/");

  const model = page.locator('[data-artifact-kind="modelCard"]');
  await expect(page.locator(".bn-block-column")).toHaveCount(0);
  await expect.poll(() => model.evaluate((element) => {
    const layout = element.querySelector(
      ".preshot-artifact-balanced-layout",
    ) as HTMLElement;
    return getComputedStyle(layout).gridTemplateColumns.split(" ").length;
  })).toBe(2);
  await expect(model.locator("[data-artifact-resize-edge]")).toHaveCount(0);
  const modelContent = model.locator(
    'xpath=ancestor::div[@data-content-type="modelCard"][1]',
  );
  const modelBox = await model.boundingBox();
  const contentBox = await modelContent.boundingBox();
  if (!modelBox || !contentBox) throw new Error("Expected model card geometry");
  expect(modelBox.x).toBeCloseTo(contentBox.x, 0);
  expect(modelBox.x + modelBox.width).toBeCloseTo(
    contentBox.x + contentBox.width,
    0,
  );
  expect(modelBox.height).toBeLessThan(600);

  await page.reload();
  await expect(page.locator(".bn-block-column")).toHaveCount(0);
  const reloadedModel = page.locator('[data-artifact-kind="modelCard"]');
  await expect(reloadedModel).toBeVisible();
  await expect(reloadedModel.locator("[data-artifact-resize-edge]"))
    .toHaveCount(0);
  const reloadedModelBox = await reloadedModel.boundingBox();
  const reloadedContentBox = await reloadedModel.locator(
    'xpath=ancestor::div[@data-content-type="modelCard"][1]',
  ).boundingBox();
  if (!reloadedModelBox || !reloadedContentBox) {
    throw new Error("Expected reloaded model card geometry");
  }
  expect(reloadedModelBox.x).toBeCloseTo(reloadedContentBox.x, 0);
  expect(reloadedModelBox.x + reloadedModelBox.width).toBeCloseTo(
    reloadedContentBox.x + reloadedContentBox.width,
    0,
  );
  expect(reloadedModelBox.height).toBeLessThan(600);
  await expect(page.locator('[data-artifact-kind="prop"]')).toBeVisible();
});

test("does not group an artifact card beside text", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const projectPath = "C:\\Preshot Demo\\编辑大片示例";
    const key =
      `preshot.browser-blocknote-plan-v15:${encodeURIComponent(projectPath)}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, JSON.stringify({
      schemaVersion: 15,
      title: "Artifact beside text",
      document: {
        format: "preshot-blocks",
        version: 3,
        blocks: [
          {
            id: "text-block",
            type: "paragraph",
            props: {},
            content: [{
              type: "text",
              text: "拍摄说明",
              styles: {},
            }],
            children: [],
          },
          {
            id: "prop-block",
            type: "prop",
            props: { artifactId: "prop" },
            children: [],
          },
        ],
      },
      imageGroups: [],
      artifacts: [{
        id: "prop",
        kind: "prop",
        revision: 0,
        title: "圆形反光板",
        source: "银白双面，直径 110 cm",
        gallery: { id: "prop-gallery", images: [] },
      }],
    }));
  });
  await page.goto("/");

  const prop = page.locator('[data-artifact-kind="prop"]');
  const surfaceBox = await prop.locator("header > span").first().boundingBox();
  const textBox = await page.getByText("拍摄说明", { exact: true }).locator(
    'xpath=ancestor::div[@data-node-type="blockOuter"][1]',
  ).boundingBox();
  if (!surfaceBox || !textBox) {
    throw new Error("Expected artifact-to-text drag geometry");
  }
  await page.mouse.move(
    surfaceBox.x + surfaceBox.width / 2,
    surfaceBox.y + surfaceBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    textBox.x + textBox.width - 2,
    textBox.y + textBox.height / 2,
    { steps: 12 },
  );
  await expect(page.locator(
    '[data-preshot-block-drop-overlay="right"], ' +
      '[data-preshot-block-drop-overlay="left"]',
  )).toHaveCount(0);
  await page.mouse.up();

  await expect(page.locator(".bn-block-column")).toHaveCount(0);
  await expect(page.getByText("拍摄说明", { exact: true })).toBeVisible();
  await expect(page.locator('[data-artifact-kind="prop"]')).toBeVisible();
});

test("balances autosizing location information with wrapped images", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const projectPath = "C:\\Preshot Demo\\编辑大片示例";
    const image = (index: number) => {
      const frameHeight = index % 2 === 0 ? 220 : 110;
      return {
        id: `location-${index}`,
        file: `references/location-${index}.png`,
        aspectRatio: 1.5,
        sourceWidth: 900,
        sourceHeight: 600,
        frameWidth: frameHeight * 1.5,
        frameHeight,
      };
    };
    sessionStorage.setItem(
      `preshot.browser-blocknote-plan-v15:${encodeURIComponent(projectPath)}`,
      JSON.stringify({
        schemaVersion: 15,
        title: "Balanced location",
        document: {
          format: "preshot-blocks",
          version: 3,
          blocks: [{
            id: "location-block",
            type: "shootingLocation",
            props: { artifactId: "location" },
            children: [],
          }],
        },
        imageGroups: [],
        artifacts: [{
          id: "location",
          kind: "shootingLocation",
          revision: 0,
          venueName: "118 广场",
          address: "虹口区东大名路",
          description: "朝北落地窗",
          gallery: {
            id: "location-gallery",
            images: Array.from({ length: 6 }, (_, index) => image(index)),
          },
        }],
      }),
    );
  });
  await page.goto("/");

  const location = page.locator('[data-artifact-kind="shootingLocation"]');
  const title = location.getByRole("textbox", { name: "场地名称" });
  const information = location.getByRole("textbox", { name: "场地信息" });
  const gallery = location.locator(".preshot-blocknote-image-group");
  await expect(title).toHaveValue("118 广场");
  await expect(information).toHaveValue("虹口区东大名路\n朝北落地窗");
  await expect(gallery.locator("[data-image-id]")).toHaveCount(6);

  const measure = () => location.evaluate((element) => {
    const textarea = element.querySelector("textarea")!;
    const imageRegion = element.querySelector(
      ".preshot-blocknote-image-group",
    )!;
    const frames = [...element.querySelectorAll<HTMLElement>("[data-image-id]")];
    return {
      informationHeight: textarea.getBoundingClientRect().height,
      imageRegionHeight: imageRegion.getBoundingClientRect().height,
      scrollHeight: textarea.scrollHeight,
      clientHeight: textarea.clientHeight,
      rows: new Set(frames.map((frame) =>
        Math.round(frame.getBoundingClientRect().top))).size,
      ratios: frames.map((frame) => {
        const rect = frame.getBoundingClientRect();
        return rect.width / rect.height;
      }),
      frameHeights: frames.map((frame) =>
        frame.getBoundingClientRect().height),
    };
  });
  await expect.poll(async () =>
    (await measure()).ratios.every(
      (ratio) => Math.abs(ratio - 1.5) < 0.02,
    )
  ).toBe(true);
  const initial = await measure();
  expect(Math.abs(initial.informationHeight - initial.imageRegionHeight))
    .toBeLessThan(1);
  expect(initial.rows).toBeGreaterThan(1);
  expect(initial.scrollHeight).toBeLessThanOrEqual(initial.clientHeight);
  expect(Math.max(...initial.frameHeights) / Math.min(...initial.frameHeights))
    .toBeGreaterThan(1.8);
  await expect(
    gallery.locator("[data-image-resize-edge]"),
  ).toHaveCount(48);

  const firstFrame = gallery.locator('[data-image-id="location-0"]');
  const beforeResize = await firstFrame.boundingBox();
  if (!beforeResize) throw new Error("Expected location image frame");
  await firstFrame.locator('[data-image-resize-edge="right"]').evaluate(
    (handle) => {
      const rect = handle.getBoundingClientRect();
      const startX = rect.left + rect.width / 2;
      const startY = rect.top + rect.height / 2;
      handle.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        buttons: 1,
        clientX: startX,
        clientY: startY,
        isPrimary: true,
        pointerId: 770,
        pointerType: "mouse",
      }));
      document.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        buttons: 1,
        clientX: startX + 36,
        clientY: startY,
        isPrimary: true,
        pointerId: 770,
        pointerType: "mouse",
      }));
      document.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        clientX: startX + 36,
        clientY: startY,
        isPrimary: true,
        pointerId: 770,
        pointerType: "mouse",
      }));
    },
  );
  await expect.poll(async () => (await firstFrame.boundingBox())?.width ?? 0)
    .toBeGreaterThan(beforeResize.width + 10);
  const afterHorizontal = await firstFrame.boundingBox();
  if (!afterHorizontal) throw new Error("Expected horizontally resized frame");
  expect(afterHorizontal.height).toBeCloseTo(beforeResize.height, 0);

  const dragResizeZone = async (
    direction: string,
    deltaX: number,
    deltaY: number,
    pointerId: number,
  ) => {
    await firstFrame.locator(
      `[data-image-resize-edge="${direction}"]`,
    ).evaluate((handle, input) => {
      const { deltaX, deltaY, pointerId } = input as {
        deltaX: number;
        deltaY: number;
        pointerId: number;
      };
      const rect = handle.getBoundingClientRect();
      const startX = rect.left + rect.width / 2;
      const startY = rect.top + rect.height / 2;
      handle.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        buttons: 1,
        clientX: startX,
        clientY: startY,
        isPrimary: true,
        pointerId,
        pointerType: "mouse",
      }));
      document.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        buttons: 1,
        clientX: startX + deltaX,
        clientY: startY + deltaY,
        isPrimary: true,
        pointerId,
        pointerType: "mouse",
      }));
      document.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        clientX: startX + deltaX,
        clientY: startY + deltaY,
        isPrimary: true,
        pointerId,
        pointerType: "mouse",
      }));
    }, { deltaX, deltaY, pointerId });
  };

  await dragResizeZone("bottom", 0, 30, 771);
  const afterVertical = await firstFrame.boundingBox();
  if (!afterVertical) throw new Error("Expected vertically resized frame");
  expect(afterVertical.width).toBeCloseTo(afterHorizontal.width, 0);
  expect(afterVertical.height).toBeGreaterThan(afterHorizontal.height + 10);

  const ratioBeforeCorner = afterVertical.width / afterVertical.height;
  await dragResizeZone("bottom-right", 24, 16, 772);
  const afterCorner = await firstFrame.boundingBox();
  if (!afterCorner) throw new Error("Expected corner-resized frame");
  expect(afterCorner.width / afterCorner.height)
    .toBeCloseTo(ratioBeforeCorner, 2);

  await firstFrame.getByRole("button", {
    name: "切换参考图 1 为自由变形",
  }).click();
  await expect(firstFrame.getByRole("button", {
    name: "切换参考图 1 为裁切适配",
  })).toBeVisible();
  await expect.poll(() =>
    firstFrame.locator("img").evaluate((image) => image.style.width)
  ).toBe("100%");

  const secondImage = gallery.getByRole("button", {
    name: "选择参考图 2",
  });
  await secondImage.focus();
  await page.keyboard.press("Space");
  await expect(page.locator('[data-image-drag-overlay="true"]')).toBeVisible();
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-image-drag-overlay="true"]')).toHaveCount(0);
  await expect.poll(() =>
    gallery.locator("[data-image-id]").evaluateAll((frames) =>
      frames.map((frame) => (frame as HTMLElement).dataset.imageId))
  ).toEqual([
    "location-1",
    "location-0",
    "location-2",
    "location-3",
    "location-4",
    "location-5",
  ]);

  await information.fill(
    Array.from(
      { length: 24 },
      (_, index) => `场地补充说明 ${index + 1}：器材、灯光和进场安排。`,
    ).join("\n"),
  );
  const expanded = await measure();
  expect(expanded.informationHeight).toBeGreaterThan(
    initial.informationHeight,
  );
  expect(Math.abs(expanded.informationHeight - expanded.imageRegionHeight))
    .toBeLessThan(1);
  expect(expanded.scrollHeight).toBeLessThanOrEqual(expanded.clientHeight);

  await title.fill("北外滩 118 广场");
  await title.blur();
  await information.blur();
  await page.keyboard.press("Control+s");
  await expect(page.getByTestId("save-status")).toHaveText(
    "已保存所有更改",
    { timeout: 10_000 },
  );
  await expect.poll(() => page.evaluate(() => {
    const projectPath = "C:\\Preshot Demo\\编辑大片示例";
    const stored = sessionStorage.getItem(
      `preshot.browser-blocknote-plan-v15:${encodeURIComponent(projectPath)}`,
    );
    const plan = stored ? JSON.parse(stored) : null;
    const location = plan?.artifacts?.find(
      (artifact: { id: string }) => artifact.id === "location",
    );
    return location?.gallery?.images?.find(
      (image: { id: string }) => image.id === "location-0",
    )?.fitMode;
  })).toBe("stretch");
});

test("previews and commits a cross-group image drag transaction", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const projectPath = "C:\\Preshot Demo\\编辑大片示例";
    const image = (id: string) => ({
      id,
      file: `references/${id}.png`,
      aspectRatio: 1.5,
      sourceWidth: 900,
      sourceHeight: 600,
      frameWidth: 135,
      frameHeight: 90,
    });
    sessionStorage.setItem(
      `preshot.browser-blocknote-plan-v15:${encodeURIComponent(projectPath)}`,
      JSON.stringify({
        schemaVersion: 15,
        title: "Image drag transaction",
        document: {
          format: "preshot-blocks",
          version: 3,
          blocks: [
            {
              id: "source-block",
              type: "imageGroup",
              props: { groupId: "source-group" },
              children: [],
            },
            {
              id: "target-block",
              type: "imageGroup",
              props: { groupId: "target-group" },
              children: [],
            },
          ],
        },
        imageGroups: [
          {
            id: "source-group",
            name: "Source",
            type: "reference",
            x: 0,
            width: 420,
            height: 126,
            description: "",
            images: [image("source-a"), image("source-b")],
          },
          {
            id: "target-group",
            name: "Target",
            type: "reference",
            x: 0,
            width: 420,
            height: 126,
            description: "",
            images: [image("target-a")],
          },
        ],
        artifacts: [],
      }),
    );
  });
  await page.goto("/");

  const source = page.locator('[data-image-group-id="source-group"]');
  const target = page.locator('[data-image-group-id="target-group"]');
  await expect(source.locator("[data-image-id]")).toHaveCount(2);
  await expect(target.locator("[data-image-id]")).toHaveCount(1);
  const canvas = page.getByTestId("plan-document-canvas");
  const originalZoom = await canvas.evaluate(
    (element) => (element as HTMLElement).style.zoom,
  );
  const originalMinHeight = await canvas.evaluate(
    (element) => (element as HTMLElement).style.minHeight,
  );
  await canvas.evaluate((element) => {
    (element as HTMLElement).style.minHeight = "2400px";
  });

  const keyboardImage = source.getByRole("button", {
    name: "选择参考图 2",
  });
  await keyboardImage.focus();
  await expect(page.getByTestId("image-drag-announcement")).toContainText(
    "已选择第 1 个图片组",
  );
  await page.keyboard.press("Space");
  await expect(page.locator("[data-image-drag-overlay]")).toBeVisible();
  await page.keyboard.press("Home");
  await expect(source.locator(
    '[data-image-placeholder-id="source-b"]',
  )).toHaveAttribute("data-image-drag-target-insertion", "true");
  await page.keyboard.press("Control+ArrowRight");
  await expect(target.locator(
    '[data-image-placeholder-id="source-b"]',
  )).toHaveAttribute("data-image-drag-target-insertion", "true");
  await page.keyboard.press("End");
  await expect(page.getByTestId("image-drag-announcement")).toContainText(
    "第 2 个图片组“Target”的第 2 位",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-image-drag-overlay]")).toHaveCount(0);

  for (const zoom of [0.55, 0.85, 1, 1.8]) {
    await canvas.evaluate((element, value) => {
      (element as HTMLElement).style.zoom = String(value);
    }, zoom);
    await target.evaluate((element) => {
      element.scrollIntoView({ block: "center", inline: "center" });
    });
    const sourceFirstBox = await source.locator(
      '[data-image-id="source-a"]',
    ).boundingBox();
    let zoomTargetBox = await target.boundingBox();
    let zoomTargetImageBox = await target.locator(
      '[data-image-id="target-a"]',
    ).boundingBox();
    const zoomScrollerBox = await page.getByTestId("canvas-scroller")
      .boundingBox();
    if (
      !sourceFirstBox ||
      !zoomTargetBox ||
      !zoomTargetImageBox ||
      !zoomScrollerBox
    ) {
      throw new Error(`Expected image drag geometry at zoom ${zoom}`);
    }

    await keyboardImage.focus();
    await page.keyboard.press("Space");
    await expect(page.locator("[data-image-drag-overlay]").last()).toBeVisible({
      timeout: 15_000,
    });
    await page.keyboard.press("Home");
    await expect(source.locator(
      '[data-image-placeholder-id="source-b"]',
    )).toHaveAttribute("data-image-drag-target-insertion", "true");
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-image-drag-overlay]")).toHaveCount(0);

    let pointerId = 800 + Math.round(zoom * 100);
    const sourcePoint = {
      x: sourceFirstBox.x + sourceFirstBox.width / 2,
      y: sourceFirstBox.y + sourceFirstBox.height / 2,
    };
    await source.locator(
      '[data-image-id="source-a"] [data-image-drag-activator="true"]',
    ).dispatchEvent("pointerdown", {
      button: 0,
      buttons: 1,
      clientX: sourcePoint.x,
      clientY: sourcePoint.y,
      isPrimary: true,
      pointerId,
      pointerType: "mouse",
    });
    await page.evaluate(() =>
      new Promise<void>((resolveFrame) =>
        requestAnimationFrame(() => resolveFrame())));
    await page.waitForTimeout(50);
    await page.evaluate(({ point, id }) => {
      document.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        buttons: 1,
        clientX: point.x + 8,
        clientY: point.y,
        isPrimary: true,
        pointerId: id,
        pointerType: "mouse",
      }));
    }, { point: sourcePoint, id: pointerId });
    await page.waitForTimeout(100);
    if (await page.locator("[data-image-drag-overlay]").count() === 0) {
      await page.evaluate((id) => {
        document.dispatchEvent(new PointerEvent("pointercancel", {
          bubbles: true,
          isPrimary: true,
          pointerId: id,
          pointerType: "mouse",
        }));
      }, pointerId);
      pointerId += 10_000;
      await source.locator(
        '[data-image-id="source-a"] [data-image-drag-activator="true"]',
      ).dispatchEvent("pointerdown", {
        button: 0,
        buttons: 1,
        clientX: sourcePoint.x,
        clientY: sourcePoint.y,
        isPrimary: true,
        pointerId,
        pointerType: "mouse",
      });
      await page.waitForTimeout(200);
      await page.evaluate(({ point, id }) => {
        document.dispatchEvent(new PointerEvent("pointermove", {
          bubbles: true,
          buttons: 1,
          clientX: point.x + 10,
          clientY: point.y,
          isPrimary: true,
          pointerId: id,
          pointerType: "mouse",
        }));
      }, { point: sourcePoint, id: pointerId });
    }
    await expect(page.locator("[data-image-drag-overlay]").last()).toBeVisible({
      timeout: 15_000,
    });
    if (zoom === 1) {
      await page.evaluate(() =>
        new Promise<void>((resolveFrames) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => resolveFrames()))));
      const scroller = page.getByTestId("canvas-scroller");
      const initialScrollTop = await scroller.evaluate(
        (element) => element.scrollTop,
      );
      await page.evaluate(({ x, y, id }) => {
        document.dispatchEvent(new PointerEvent("pointermove", {
          bubbles: true,
          buttons: 1,
          clientX: x,
          clientY: y,
          isPrimary: true,
          pointerId: id,
          pointerType: "mouse",
        }));
      }, {
        x: zoomScrollerBox.x + zoomScrollerBox.width / 2,
        y: zoomScrollerBox.y + zoomScrollerBox.height - 8,
        id: pointerId,
      });
      await page.evaluate(() =>
        new Promise<void>((resolveFrame) =>
          requestAnimationFrame(() => resolveFrame())));
      await page.evaluate(({ x, y, id }) => {
        document.dispatchEvent(new PointerEvent("pointermove", {
          bubbles: true,
          buttons: 1,
          clientX: x,
          clientY: y,
          isPrimary: true,
          pointerId: id,
          pointerType: "mouse",
        }));
      }, {
        x: zoomScrollerBox.x + zoomScrollerBox.width / 2,
        y: zoomScrollerBox.y + zoomScrollerBox.height - 8,
        id: pointerId,
      });
      await expect.poll(() =>
        scroller.evaluate((element) => element.scrollTop)
      ).toBeGreaterThan(initialScrollTop);
      const firstScrollTop = await scroller.evaluate(
        (element) => element.scrollTop,
      );
      await page.evaluate(() =>
        new Promise<void>((resolveFrames) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => resolveFrames()))));
      await expect.poll(() =>
        scroller.evaluate((element) => element.scrollTop)
      ).toBeGreaterThan(firstScrollTop);

      await page.evaluate(({ x, y, id }) => {
        document.dispatchEvent(new PointerEvent("pointermove", {
          bubbles: true,
          buttons: 1,
          clientX: x,
          clientY: y,
          isPrimary: true,
          pointerId: id,
          pointerType: "mouse",
        }));
      }, {
        x: zoomScrollerBox.x + zoomScrollerBox.width / 2,
        y: zoomScrollerBox.y + zoomScrollerBox.height / 2,
        id: pointerId,
      });
      await page.evaluate(() =>
        new Promise<void>((resolveFrames) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => resolveFrames()))));
      const stoppedScrollTop = await scroller.evaluate(
        (element) => element.scrollTop,
      );
      await page.evaluate(() =>
        new Promise<void>((resolveFrames) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => resolveFrames()))));
      expect(await scroller.evaluate((element) => element.scrollTop)).toBe(
        stoppedScrollTop,
      );
    }
    await target.evaluate((element) => {
      element.scrollIntoView({ block: "center", inline: "center" });
    });
    await page.evaluate(() =>
      new Promise<void>((resolveFrames) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => resolveFrames()))));
    zoomTargetBox = await target.boundingBox();
    zoomTargetImageBox = await target.locator(
      '[data-image-id="target-a"]',
    ).boundingBox();
    if (!zoomTargetBox || !zoomTargetImageBox) {
      throw new Error(`Expected remeasured target at zoom ${zoom}`);
    }
    await page.evaluate(({ x, y, id }) => {
      document.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        buttons: 1,
        clientX: x,
        clientY: y,
        isPrimary: true,
        pointerId: id,
        pointerType: "mouse",
      }));
    }, {
      x: zoomTargetBox.x + Math.min(48, zoomTargetBox.width / 4),
      y: zoomTargetImageBox.y + zoomTargetImageBox.height / 2,
      id: pointerId,
    });
    await page.evaluate(() =>
      new Promise<void>((resolveFrame) =>
        requestAnimationFrame(() => resolveFrame())));
    await page.evaluate(({ x, y, id }) => {
      document.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        buttons: 1,
        clientX: x,
        clientY: y,
        isPrimary: true,
        pointerId: id,
        pointerType: "mouse",
      }));
    }, {
      x: zoomTargetBox.x + Math.min(48, zoomTargetBox.width / 4),
      y: zoomTargetImageBox.y + zoomTargetImageBox.height / 2,
      id: pointerId,
    });
    await page.waitForTimeout(50);
    await expect(target.locator(
      '[data-image-placeholder-id="source-a"]',
    ), `cross-group projection at zoom ${zoom}`).toHaveAttribute(
      "data-image-drag-target-insertion",
      "true",
    );
    await page.keyboard.press("Escape");
    await page.evaluate((id) => {
      document.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        isPrimary: true,
        pointerId: id,
        pointerType: "mouse",
      }));
    }, pointerId);
    await expect(page.locator("[data-image-drag-overlay]")).toHaveCount(0);
    await expect(source.locator("[data-image-id]")).toHaveCount(2);
    await expect(target.locator("[data-image-id]")).toHaveCount(1);
  }
  await canvas.evaluate((element, value) => {
    (element as HTMLElement).style.zoom = value;
  }, originalZoom);
  await canvas.evaluate((element, value) => {
    (element as HTMLElement).style.minHeight = value;
  }, originalMinHeight);

  const sourceBoxBefore = await source.boundingBox();
  const movingActivator = source.locator(
    '[data-image-id="source-a"] [data-image-drag-activator="true"]',
  );
  await movingActivator.hover();
  const movingBox = await movingActivator.boundingBox();
  const targetBox = await target.boundingBox();
  const targetImageBox = await target.locator(
    '[data-image-id="target-a"]',
  ).boundingBox();
  if (!sourceBoxBefore || !movingBox || !targetBox || !targetImageBox) {
    throw new Error("Expected cross-group drag geometry");
  }

  await page.mouse.move(
    movingBox.x + movingBox.width / 2,
    movingBox.y + movingBox.height / 2,
  );
  await page.mouse.down();
  await page.waitForTimeout(200);
  await page.mouse.move(
    movingBox.x + movingBox.width / 2 + 8,
    movingBox.y + movingBox.height / 2,
    { steps: 2 },
  );
  await page.waitForTimeout(100);
  if (await page.locator("[data-image-drag-overlay]").count() === 0) {
    await page.mouse.up();
    await page.waitForTimeout(200);
    await page.mouse.move(
      movingBox.x + movingBox.width / 2,
      movingBox.y + movingBox.height / 2,
    );
    await page.mouse.down();
    await page.waitForTimeout(200);
    await page.mouse.move(
      movingBox.x + movingBox.width / 2 + 10,
      movingBox.y + movingBox.height / 2,
      { steps: 4 },
    );
  }
  await expect(page.locator("[data-image-drag-overlay]")).toBeVisible();
  await page.mouse.move(
    targetBox.x + targetBox.width - 18,
    targetImageBox.y + targetImageBox.height / 2,
    { steps: 12 },
  );

  await expect(page.locator("[data-image-drag-overlay]")).toBeVisible();
  await expect(source.locator("[data-image-drag-source-placeholder]"))
    .toBeVisible();
  await expect(target).toHaveAttribute("data-image-drag-target", "true");
  await expect(target.locator(
    '[data-image-placeholder-id="source-a"]',
  )).toHaveAttribute("data-image-drag-target-insertion", "true");
  await expect.poll(async () =>
    source.locator("[data-image-id]").evaluateAll((frames) =>
      frames.map((frame) => (frame as HTMLElement).dataset.imageId)),
  ).toEqual(["source-b"]);
  await expect.poll(async () =>
    target.locator(
      "[data-image-id], [data-image-placeholder-id]",
    ).evaluateAll((frames) =>
      frames.map((frame) =>
        (frame as HTMLElement).dataset.imageId ??
        (frame as HTMLElement).dataset.imagePlaceholderId)),
  ).toEqual(["target-a", "source-a"]);
  expect((await source.boundingBox())?.height ?? 0)
    .toBeGreaterThanOrEqual(sourceBoxBefore.height);
  expect(await page.evaluate(() => {
    const projectPath = "C:\\Preshot Demo\\编辑大片示例";
    const stored = sessionStorage.getItem(
      `preshot.browser-blocknote-plan-v15:${encodeURIComponent(projectPath)}`,
    );
    const plan = stored ? JSON.parse(stored) : null;
    return plan?.imageGroups.map(
      (group: { id: string; images: Array<{ id: string }> }) => [
        group.id,
        group.images.map((image: { id: string }) => image.id),
      ],
    );
  })).toEqual([
    ["source-group", ["source-a", "source-b"]],
    ["target-group", ["target-a"]],
  ]);
  const previewScreenshot = await page.screenshot({ animations: "disabled" });
  await testInfo.attach("live image drag preview", {
    body: previewScreenshot,
    contentType: "image/png",
  });

  await page.mouse.up();
  await expect.poll(async () =>
    source.locator("[data-image-id]").evaluateAll((frames) =>
      frames.map((frame) => (frame as HTMLElement).dataset.imageId)),
  ).toEqual(["source-b"]);
  await expect.poll(async () =>
    target.locator("[data-image-id]").evaluateAll((frames) =>
      frames.map((frame) => (frame as HTMLElement).dataset.imageId)),
  ).toEqual(["target-a", "source-a"]);
  await expect(page.getByTestId("save-status")).toHaveText(
    "已保存所有更改",
    { timeout: 10_000 },
  );
  await expect.poll(() => page.evaluate(() => {
    const projectPath = "C:\\Preshot Demo\\编辑大片示例";
    const stored = sessionStorage.getItem(
      `preshot.browser-blocknote-plan-v15:${encodeURIComponent(projectPath)}`,
    );
    const plan = stored ? JSON.parse(stored) : null;
    return plan?.imageGroups.map(
      (group: { id: string; images: Array<{ id: string }> }) => [
        group.id,
        group.images.map((image: { id: string }) => image.id),
      ],
    );
  })).toEqual([
    ["source-group", ["source-b"]],
    ["target-group", ["target-a", "source-a"]],
  ]);
  const committedScreenshot = await page.screenshot({
    animations: "disabled",
  });
  await testInfo.attach("committed image drag", {
    body: committedScreenshot,
    contentType: "image/png",
  });
  const reviewArtifactDirectory =
    process.env.PRESHOT_IMAGE_DRAG_REVIEW_ARTIFACTS;
  if (reviewArtifactDirectory) {
    const directory = resolve(reviewArtifactDirectory);
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, "live-preview.png"), previewScreenshot);
    await writeFile(
      resolve(directory, "committed-layout.png"),
      committedScreenshot,
    );
    await writeFile(
      resolve(directory, "browser-summary.json"),
      `${JSON.stringify({
        cssZooms: [0.55, 0.85, 1, 1.8],
        previewPersisted: false,
        committedOrder: [
          ["source-group", ["source-b"]],
          ["target-group", ["target-a", "source-a"]],
        ],
      }, null, 2)}\n`,
    );
  }
});

test("downloads and inspects production React-PDF bytes without external export traffic", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const editor = page.locator(".bn-editor");
  await editor.click();
  await page.keyboard.type("浏览器导出验收第一段");
  await page.keyboard.press("Enter");
  await page.keyboard.type("浏览器导出验收第二段");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  await page.getByText("图片组", { exact: true }).click();

  const group = page.locator(".preshot-blocknote-image-group");
  await expect(group).toBeVisible();
  await group.getByRole("button", { name: "添加图片" }).first().click();
  await expect(group.locator("[data-image-id]")).toHaveCount(2);

  const firstFrame = group.locator("[data-image-id]").first();
  const widthBefore = (await firstFrame.boundingBox())?.width ?? 0;
  await firstFrame.locator('[data-image-resize-edge="right"]').evaluate(
    (handle) => {
      const rect = handle.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;
      handle.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        clientX,
        clientY,
        pointerId: 301,
      }));
      document.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        clientX: clientX + 24,
        clientY,
        pointerId: 301,
      }));
      document.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        clientX: clientX + 24,
        clientY,
        pointerId: 301,
      }));
    },
  );
  await expect.poll(async () => (await firstFrame.boundingBox())?.width ?? 0)
    .toBeGreaterThan(widthBefore);
  await expect(page.getByTestId("save-status")).toHaveText(
    "已保存所有更改",
    { timeout: 10_000 },
  );

  const externalRequests: string[] = [];
  const appOrigin = new URL(page.url()).origin;
  let exporting = false;
  page.on("request", (request) => {
    if (!exporting) return;
    const url = request.url();
    if (
      /^https?:\/\//i.test(url) &&
      new URL(url).origin !== appOrigin
    ) {
      externalRequests.push(url);
    }
  });

  const { option, trigger } = await openExportMenu(page, "PDF");
  await trigger.evaluate((button) => {
    const target = window as typeof window & {
      __PRESHOT_PDF_PROGRESS_SEEN__?: boolean;
    };
    target.__PRESHOT_PDF_PROGRESS_SEEN__ = false;
    const observer = new MutationObserver(() => {
      if (
        button.textContent?.includes("正在导出 PDF…") &&
        button.getAttribute("aria-disabled") === "true"
      ) {
        target.__PRESHOT_PDF_PROGRESS_SEEN__ = true;
        observer.disconnect();
      }
    });
    observer.observe(button, {
      attributes: true,
      childList: true,
      subtree: true,
    });
  });
  const downloadPromise = page.waitForEvent("download");
  let downloadCount = 0;
  page.on("download", () => {
    downloadCount += 1;
  });
  exporting = true;
  await option.click();
  await expect(page.getByRole("menu", { name: "导出格式" })).toHaveCount(0);
  const download = await downloadPromise;
  const pdfPath = testInfo.outputPath("production-react-pdf.pdf");
  await download.saveAs(pdfPath);
  await expect(trigger).toHaveText("导出", { timeout: 30_000 });
  expect(await page.evaluate(() =>
    (window as typeof window & {
      __PRESHOT_PDF_PROGRESS_SEEN__?: boolean;
    }).__PRESHOT_PDF_PROGRESS_SEEN__
  )).toBe(true);
  expect(downloadCount).toBe(1);
  exporting = false;

  const bytes = new Uint8Array(await readFile(pdfPath));
  const pdf = await PDFDocument.load(bytes);
  expect(new TextDecoder().decode(bytes.slice(0, 8))).toMatch(/^%PDF-/);
  expect(download.suggestedFilename()).toBe("output.pdf");
  expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
  expect(pdf.getPages()[0].getWidth()).toBeCloseTo(595.28, 1);
  expect(pdf.getPages()[0].getHeight()).toBeCloseTo(841.89, 1);
  expect(pdf.getPages().reduce(
    (total, _page, index) => total + pageImageDrawCount(pdf, index),
    0,
  )).toBe(2);
  const drawBoxes = pdf.getPages().flatMap((_page, index) =>
    pageImageDrawBoxes(pdf, index)
  );
  expect(drawBoxes).toHaveLength(2);
  expect(drawBoxes[0].width).not.toBeCloseTo(drawBoxes[1].width, 1);
  expect(drawBoxes.every((box) =>
    box.width > 0 &&
    box.height > 0 &&
    box.x >= 0 &&
    box.y >= 0
  )).toBe(true);
  expect(externalRequests).toEqual([]);
  await testInfo.attach("production React-PDF", {
    path: pdfPath,
    contentType: "application/pdf",
  });

  let textOrderVerified = false;
  const textResult = spawnSync("pdftotext", [pdfPath, "-"], {
    encoding: "utf8",
  });
  if (textResult.status === 0) {
    const extracted = textResult.stdout;
    expect(extracted.indexOf("浏览器导出验收第一段")).toBeGreaterThanOrEqual(0);
    expect(extracted.indexOf("浏览器导出验收第二段")).toBeGreaterThan(
      extracted.indexOf("浏览器导出验收第一段"),
    );
    expect(extracted).not.toMatch(/添加图片|删除图片组|打开菜单/);
    textOrderVerified = true;
  }

  const pngBase = testInfo.outputPath("production-react-pdf-page-1");
  const renderResult = spawnSync("pdftoppm", [
    "-png",
    "-f",
    "1",
    "-singlefile",
    pdfPath,
    pngBase,
  ]);
  let renderedDimensions: { width: number; height: number } | null = null;
  let renderedPng: Uint8Array | null = null;
  if (renderResult.status === 0) {
    const pngPath = `${pngBase}.png`;
    const png = new Uint8Array(await readFile(pngPath));
    const dimensions = pngDimensions(png);
    expect(dimensions.width / dimensions.height).toBeCloseTo(
      595.28 / 841.89,
      2,
    );
    renderedDimensions = dimensions;
    renderedPng = png;
    await testInfo.attach("production React-PDF page 1", {
      path: pngPath,
      contentType: "image/png",
    });
  }

  const reviewArtifactDirectory =
    process.env.PRESHOT_PDF_REVIEW_ARTIFACTS;
  if (reviewArtifactDirectory) {
    const directory = resolve(reviewArtifactDirectory);
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, "browser-production.pdf"), bytes);
    if (renderedPng) {
      await writeFile(
        resolve(directory, "browser-production-page-1.png"),
        renderedPng,
      );
    }
    await writeFile(
      resolve(directory, "browser-production-summary.json"),
      JSON.stringify({
        pageCount: pdf.getPageCount(),
        pageSize: {
          width: pdf.getPages()[0].getWidth(),
          height: pdf.getPages()[0].getHeight(),
        },
        imageDrawBoxes: drawBoxes,
        externalRequests,
        textOrderVerified,
        renderedDimensions,
      }, null, 2),
    );
  }
});

test("downloads and inspects production DOCX ZIP/XML", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const editor = page.locator(".bn-editor");
  await editor.click();
  await page.keyboard.type("DOCX 浏览器验收");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  await page.getByText("图片组", { exact: true }).click();
  const group = page.locator(".preshot-blocknote-image-group");
  await expect(group).toBeVisible();
  await group.getByRole("button", { name: "添加图片" }).first().click();
  await expect(group.locator("[data-image-id]")).toHaveCount(2);

  const externalRequests: string[] = [];
  const appOrigin = new URL(page.url()).origin;
  let exporting = false;
  page.on("request", (request) => {
    if (!exporting) return;
    const url = request.url();
    if (
      /^https?:\/\//i.test(url) &&
      new URL(url).origin !== appOrigin
    ) {
      externalRequests.push(url);
    }
  });

  const { option, trigger } = await openExportMenu(page, "DOCX");
  await trigger.evaluate((button) => {
    const target = window as typeof window & {
      __PRESHOT_DOCX_PROGRESS_SEEN__?: boolean;
    };
    target.__PRESHOT_DOCX_PROGRESS_SEEN__ = false;
    const observer = new MutationObserver(() => {
      if (
        button.textContent?.includes("正在导出 DOCX…") &&
        button.getAttribute("aria-disabled") === "true"
      ) {
        target.__PRESHOT_DOCX_PROGRESS_SEEN__ = true;
        observer.disconnect();
      }
    });
    observer.observe(button, {
      attributes: true,
      childList: true,
      subtree: true,
    });
  });
  const downloadPromise = page.waitForEvent("download");
  let downloadCount = 0;
  page.on("download", () => {
    downloadCount += 1;
  });
  exporting = true;
  await option.click();
  await expect(page.getByRole("menu", { name: "导出格式" })).toHaveCount(0);
  const download = await downloadPromise;
  const docxPath = testInfo.outputPath("production-blocknote.docx");
  await download.saveAs(docxPath);
  await expect(trigger).toHaveText("导出", { timeout: 30_000 });
  expect(await page.evaluate(() =>
    (window as typeof window & {
      __PRESHOT_DOCX_PROGRESS_SEEN__?: boolean;
    }).__PRESHOT_DOCX_PROGRESS_SEEN__
  )).toBe(true);
  expect(downloadCount).toBe(1);
  exporting = false;

  const bytes = new Uint8Array(await readFile(docxPath));
  expect(download.suggestedFilename()).toBe("output.docx");
  expect(bytes.length).toBeGreaterThan(4);
  expect([...bytes.slice(0, 2)]).toEqual([0x50, 0x4b]);
  expect(externalRequests).toEqual([]);

  const entries = await unzipDocx(bytes);
  for (const required of [
    "[Content_Types].xml",
    "_rels/.rels",
    "word/document.xml",
    "word/_rels/document.xml.rels",
    "word/settings.xml",
    "word/styles.xml",
  ]) {
    expect(entries.has(required), `missing DOCX entry ${required}`).toBe(true);
  }
  const decode = (name: string) =>
    new TextDecoder().decode(entries.get(name));
  const documentXml = decode("word/document.xml");
  const relationshipsXml = decode("word/_rels/document.xml.rels");
  const settingsXml = decode("word/settings.xml");
  const stylesXml = decode("word/styles.xml");
  const mediaEntries = [...entries.keys()].filter((name) =>
    name.startsWith("word/media/") && !name.endsWith("/")
  );
  const inlineCount = documentXml.match(/<wp:inline\b/g)?.length ?? 0;

  expect(documentXml).toContain("DOCX 浏览器验收");
  expect(inlineCount).toBe(1);
  expect(mediaEntries).toHaveLength(1);
  expect(documentXml).toContain("<w:keepLines");
  expect(documentXml).not.toContain("<wp:anchor");
  expect(documentXml).not.toContain("<w:pageBreakBefore");
  expect(documentXml).not.toMatch(
    /添加图片|删除图片组|打开菜单|selection|toolbar|placeholder/i,
  );
  expect(documentXml).not.toMatch(
    /references\/|\\\\\?\\|[A-Za-z]:\\/i,
  );
  expect(relationshipsXml).not.toMatch(
    /Target="https?:\/\/|TargetMode="External"|references\/|\\\\\?\\|[A-Za-z]:\\/i,
  );
  expect(settingsXml).toContain("<w:settings");
  expect(stylesXml).toContain('w:val="zh-CN"');

  await testInfo.attach("production DOCX", {
    path: docxPath,
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });

  const reviewArtifactDirectory =
    process.env.PRESHOT_DOCX_REVIEW_ARTIFACTS;
  if (reviewArtifactDirectory) {
    const directory = resolve(reviewArtifactDirectory);
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, "browser-production.docx"), bytes);
    await writeFile(
      resolve(directory, "browser-production-summary.json"),
      JSON.stringify({
        bytes: bytes.length,
        entries: entries.size,
        inlineImages: inlineCount,
        mediaEntries,
        externalRequests,
        editableTextVerified: documentXml.includes("DOCX 浏览器验收"),
        keepLines: documentXml.includes("<w:keepLines"),
        hasAnchor: documentXml.includes("<wp:anchor"),
        hasPageBreakBefore: documentXml.includes("<w:pageBreakBefore"),
        hasPrivatePath:
          /references\/|\\\\\?\\|[A-Za-z]:\\/i.test(documentXml) ||
          /Target="https?:\/\/|references\/|\\\\\?\\|[A-Za-z]:\\/i.test(
            relationshipsXml,
          ),
      }, null, 2),
    );
  }
});

test("blocks schema-v12 projects without opening the canvas", async ({ page }) => {
  await page.addInitScript(() => {
    const projectPath = "C:\\Preshot Demo\\编辑大片示例";
    sessionStorage.setItem(
      `preshot.browser-blocknote-plan-v14:${encodeURIComponent(projectPath)}`,
      JSON.stringify({
        schemaVersion: 12,
        title: "Legacy",
        documentHtml: "<p>Legacy</p>",
        components: [],
      }),
    );
  });
  await page.goto("/");

  await expect(page.getByRole("alert")).toContainText("方案版本不兼容");
  await expect(page.getByRole("alert")).toContainText("schema 12");
  await expect(page.locator('[data-editor-engine="blocknote"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "导出" })).toHaveCount(0);
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("migrates schema-v13 projects to artifact-capable schema v15", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const projectPath = "C:\\Preshot Demo\\编辑大片示例";
    sessionStorage.setItem(
      `preshot.browser-blocknote-plan-v14:${encodeURIComponent(projectPath)}`,
      JSON.stringify({
        schemaVersion: 13,
        title: "Legacy v13",
        document: {
          format: "preshot-blocks",
          version: 1,
          blocks: [{
            id: "paragraph",
            type: "paragraph",
            props: {},
            content: [{
              type: "text",
              text: "Migrated",
              styles: {},
            }],
            children: [],
          }],
        },
        imageGroups: [],
      }),
    );
  });
  await page.goto("/");

  await expect(page.getByText("Migrated", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const projectPath = "C:\\Preshot Demo\\编辑大片示例";
    const stored = sessionStorage.getItem(
      `preshot.browser-blocknote-plan-v15:${encodeURIComponent(projectPath)}`,
    );
    const plan = stored ? JSON.parse(stored) : null;
    return plan
      ? [plan.schemaVersion, plan.document?.version]
      : null;
  })).toEqual([15, 3]);
});

test("operates nested blocks from the block side menu", async ({ page }) => {
  await page.goto("/");
  const editor = page.locator(".bn-editor");
  await editor.click();
  await page.keyboard.type("第一段");
  await page.keyboard.press("Enter");
  await page.keyboard.type("第二段");
  await page.keyboard.press("Enter");
  await page.keyboard.type("第三段");

  const openMenuForText = async (text: string) => {
    const blockId = await page.evaluate((targetText) => {
      const target = window as typeof window & {
        __PRESHOT_BLOCKNOTE_EDITOR__?: {
          forEachBlock(
            callback: (block: {
              id: string;
              content?: Array<{ type: string; text?: string }>;
            }) => boolean,
          ): void;
        };
      };
      let match = "";
      target.__PRESHOT_BLOCKNOTE_EDITOR__?.forEachBlock((block) => {
        if (block.content?.some((entry) => entry.text === targetText)) {
          match = block.id;
          return false;
        }
        return true;
      });
      return match;
    }, text);
    const content = page.getByText(text, { exact: true }).first();
    const outer = content.locator(
      'xpath=ancestor::div[@data-node-type="blockOuter"][1]',
    );
    const alternateText = text === "第三段" ? "第一段" : "第三段";
    await page.getByText(alternateText, { exact: true }).first().hover();
    await page.waitForTimeout(100);
    await outer.locator(".bn-inline-content").first().click();
    await content.hover();
    await page.waitForTimeout(120);
    await page.getByRole("button", { name: "打开菜单" }).click();
    await expect(
      page.locator(`[data-block-operation-id="${blockId}"]`),
    ).toBeAttached();
  };

  await openMenuForText("第二段");
  await expect(page.getByRole("button", { name: "增加缩进" })).toBeVisible();
  await page.getByRole("button", { name: "增加缩进" }).click();
  await expect.poll(() => page.evaluate(() => {
    const target = window as typeof window & {
      __PRESHOT_BLOCKNOTE_EDITOR__?: {
        document: Array<{
          content?: Array<{ type: string; text?: string }>;
          children: Array<{
            content?: Array<{ type: string; text?: string }>;
          }>;
        }>;
      };
    };
    return target.__PRESHOT_BLOCKNOTE_EDITOR__?.document.some((block) =>
      block.children.some((child) =>
        child.content?.some((entry) => entry.text === "第二段")));
  })).toBe(true);

  await openMenuForText("第二段");
  await page.getByRole("button", { name: "减少缩进" }).click();
  await expect.poll(() => page.evaluate(() => {
    const target = window as typeof window & {
      __PRESHOT_BLOCKNOTE_EDITOR__?: {
        document: Array<{
          content?: Array<{ type: string; text?: string }>;
        }>;
      };
    };
    return target.__PRESHOT_BLOCKNOTE_EDITOR__?.document.some((block) =>
      block.content?.some((entry) => entry.text === "第二段"));
  })).toBe(true);

  await openMenuForText("第二段");
  await page.getByText("转换为", { exact: true }).click();
  await page.getByText("二级标题", { exact: true }).click();
  await expect(editor.locator("h2")).toContainText("第二段");

  await openMenuForText("第二段");
  await page.getByRole("button", { name: "下移 block" }).evaluate(
    (button: HTMLButtonElement) => button.click(),
  );
  await expect.poll(() => page.evaluate(() => {
    const target = window as typeof window & {
      __PRESHOT_BLOCKNOTE_EDITOR__?: {
        document: Array<{
          content?: Array<{ type: string; text?: string }>;
        }>;
      };
    };
    return target.__PRESHOT_BLOCKNOTE_EDITOR__?.document[2]?.content?.[0]
      ?.text;
  })).toBe("第二段");

  const countBeforeDuplicate = await page.locator(".bn-block-outer").count();
  await openMenuForText("第二段");
  await page.getByText("复制 block", { exact: true }).click();
  await expect(page.locator(".bn-block-outer")).toHaveCount(
    countBeforeDuplicate + 1,
  );

  await openMenuForText("第二段");
  await page.getByText("删除 block", { exact: true }).click();
  await expect(page.locator(".preshot-block-operation-toast"))
    .toContainText("已删除 block");
  const countAfterDelete = await page.locator(".bn-block-outer").count();
  await page.getByRole("button", { name: "撤销" }).click();
  await expect.poll(async () =>
    (await page.locator(".bn-block-outer").count()) > countAfterDelete,
  ).toBe(true);

  await page.getByText("第三段", { exact: true }).click();
  const countBeforeShortcut = await page.locator(".bn-block-outer").count();
  await page.keyboard.press("Control+d");
  await expect(page.locator(".bn-block-outer")).toHaveCount(
    countBeforeShortcut + 1,
  );
});

test("drags blocks with the pointer at fit-width zoom", async ({ page }) => {
  await page.goto("/");
  const editor = page.locator(".bn-editor");
  await editor.click();
  await page.keyboard.type("第一段");
  await page.keyboard.press("Enter");
  await page.keyboard.type("第二段");
  await page.keyboard.press("Enter");
  await page.keyboard.type("第三段");

  await page.getByText("第二段", { exact: true }).hover();
  await page.waitForTimeout(120);
  const handleBox = await page.getByRole("button", {
    name: "打开菜单",
  }).boundingBox();
  const sideMenuBox = await page.locator(".bn-side-menu").boundingBox();
  const canvasBox = await page.getByTestId("plan-document-canvas")
    .boundingBox();
  const contentBox = await page.getByText("第二段", { exact: true }).locator(
    'xpath=ancestor::div[@data-content-type="paragraph"][1]',
  ).boundingBox();
  const firstBlockBox = await page.getByText("第一段", {
    exact: true,
  }).locator(
    'xpath=ancestor::div[@data-node-type="blockOuter"][1]',
  ).boundingBox();
  if (
    !handleBox ||
    !sideMenuBox ||
    !canvasBox ||
    !contentBox ||
    !firstBlockBox
  ) {
    throw new Error("Expected block drag geometry");
  }
  const zoomPercent = Number.parseInt(
    (await page.getByRole("button", {
      name: "恢复 100% 缩放",
    }).textContent()) ?? "",
    10,
  );
  expect(sideMenuBox.x).toBeGreaterThanOrEqual(canvasBox.x - 0.1);
  expect(sideMenuBox.x + sideMenuBox.width)
    .toBeLessThanOrEqual(contentBox.x + 0.1);
  expect(handleBox.width).toBeCloseTo(18 * zoomPercent / 100, 1);

  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    firstBlockBox.x + firstBlockBox.width / 2,
    firstBlockBox.y + 2,
    { steps: 12 },
  );
  await expect(page.locator(
    '[data-preshot-block-drop-overlay="before"]',
  )).toBeVisible();
  await page.mouse.up();

  await expect.poll(() => page.evaluate(() => {
    const target = window as typeof window & {
      __PRESHOT_BLOCKNOTE_EDITOR__?: {
        document: Array<{
          content?: Array<{ type: string; text?: string }>;
        }>;
      };
    };
    return target.__PRESHOT_BLOCKNOTE_EDITOR__?.document.map((block) =>
      block.content?.map((entry) => entry.text ?? "").join(""));
  })).toEqual(["第二段", "第一段", "第三段"]);
  await expect(page.locator("[data-preshot-block-drop-overlay]"))
    .toHaveCount(0);

});

test("uploads and persists native image video and audio blocks", async ({
  page,
}) => {
  await page.goto("/");
  const editor = page.locator(".bn-editor");
  await editor.click();
  await page.keyboard.type("/");
  await expect(page.locator(".bn-suggestion-menu").getByText(
    "图片",
    { exact: true },
  )).toBeVisible();
  await expect(page.locator(".bn-suggestion-menu").getByText(
    "视频",
    { exact: true },
  )).toBeVisible();
  await expect(page.locator(".bn-suggestion-menu").getByText(
    "音频",
    { exact: true },
  )).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Backspace");

  await page.evaluate(async () => {
    const target = window as typeof window & {
      __PRESHOT_BLOCKNOTE_EDITOR__?: {
        document: Array<{ id: string }>;
        uploadFile(file: File): Promise<string | { url?: string }>;
        insertBlocks(
          blocks: Array<{
            type: string;
            props: Record<string, unknown>;
          }>,
          reference: { id: string },
          placement: "before",
        ): void;
      };
    };
    const editor = target.__PRESHOT_BLOCKNOTE_EDITOR__;
    if (!editor) throw new Error("Expected BlockNote editor");
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const pngBytes = Uint8Array.from(
      atob(pngBase64),
      (character) => character.charCodeAt(0),
    );
    const inputs = [
      {
        type: "image",
        file: new File([pngBytes], "look.png", { type: "image/png" }),
      },
      {
        type: "video",
        file: new File(
          [new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112])],
          "clip.mp4",
          { type: "video/mp4" },
        ),
      },
      {
        type: "audio",
        file: new File(
          [new Uint8Array([73, 68, 51, 4, 0, 0, 0, 0])],
          "track.mp3",
          { type: "audio/mpeg" },
        ),
      },
    ];
    for (const input of inputs) {
      const uploaded = await editor.uploadFile(input.file);
      const url = typeof uploaded === "string"
        ? uploaded
        : String(uploaded.url ?? "");
      const reference = editor.document.at(-1);
      if (!reference) throw new Error("Expected trailing block");
      editor.insertBlocks([{
        type: input.type,
        props: {
          url,
          name: input.file.name,
          caption: "",
          showPreview: true,
        },
      }], reference, "before");
    }
  });

  await expect(page.locator('[data-content-type="image"] img')).toBeVisible();
  await expect(page.locator('[data-content-type="video"] video')).toBeVisible();
  await expect(page.locator('[data-content-type="audio"] audio')).toBeVisible();
  await page.keyboard.press("Control+s");
  await expect(page.getByTestId("save-status")).toHaveText(
    "已保存所有更改",
    { timeout: 10_000 },
  );
  await expect.poll(() => page.evaluate(() => {
    const projectPath = "C:\\Preshot Demo\\编辑大片示例";
    const stored = sessionStorage.getItem(
      `preshot.browser-blocknote-plan-v15:${encodeURIComponent(projectPath)}`,
    );
    const plan = stored ? JSON.parse(stored) : null;
    const urls: string[] = [];
    const visit = (blocks: Array<{
      type: string;
      props: Record<string, unknown>;
      children: unknown[];
    }>) => {
      for (const block of blocks) {
        if (
          block.type === "image" ||
          block.type === "video" ||
          block.type === "audio"
        ) {
          urls.push(String(block.props.url));
        }
        visit(block.children as typeof blocks);
      }
    };
    if (plan) visit(plan.document.blocks);
    return urls;
  })).toEqual([
    "media/blocknote-0001.png",
    "media/blocknote-0002.mp4",
    "media/blocknote-0003.mp3",
  ]);

  await page.reload();
  await expect(page.locator('[data-content-type="image"] img')).toBeVisible();
  await expect(page.locator('[data-content-type="video"] video')).toBeVisible();
  await expect(page.locator('[data-content-type="audio"] audio')).toBeVisible();
  const { option, trigger } = await openExportMenu(page, "PDF");
  await option.click();
  await expect(trigger).toHaveText("导出", { timeout: 10_000 });
});
