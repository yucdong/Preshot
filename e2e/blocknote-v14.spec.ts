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
  await expect(pdfOption).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(docxOption).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(pdfOption).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(docxOption).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await page.keyboard.press("ArrowUp");
  await expect(docxOption).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(menu).toHaveCount(0);
  await expect(trigger).not.toBeFocused();
  expect(await page.evaluate(() => document.activeElement === document.body))
    .toBe(false);
});

test("creates, edits, saves, and exports a BlockNote v14 project", async ({ page }) => {
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
  await expect(group.locator("[data-image-resize-edge]")).toHaveCount(4);
  await expect(group.locator("[data-group-resize-edge]")).toHaveCount(8);
  const firstImageButton = group.getByRole("button", {
    name: "选择参考图 1",
  });
  await firstImageButton.click();
  await expect(firstImageButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("dialog", { name: "参考图" })).toHaveCount(0);
  await firstImageButton.dblclick();
  await expect(page.getByRole("dialog", { name: "参考图" })).toBeVisible();
  await page.getByRole("button", { name: "关闭图片" }).click();

  const groupHeightBeforeResize = (await group.boundingBox())?.height ?? 0;
  await group.locator('[data-group-resize-edge="bottom"]').evaluate((handle) => {
    const rect = handle.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    handle.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      clientX,
      clientY,
      pointerId: 200,
    }));
    document.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      clientX,
      clientY: clientY + 18,
      pointerId: 200,
    }));
  });
  await expect.poll(async () => (await group.boundingBox())?.height ?? 0)
    .toBeGreaterThan(groupHeightBeforeResize);
  await expect(page.locator("[data-group-resize-preview]")).toHaveCount(0);
  await expect.poll(() =>
    group.locator("xpath=..").evaluate((shell) =>
      getComputedStyle(shell).outlineStyle),
  ).toBe("none");
  await page.evaluate(() => {
    document.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      pointerId: 200,
    }));
  });

  const firstFrame = group.locator("[data-image-id]").nth(0);
  const firstFrameBeforeResize = await firstFrame.boundingBox();
  const firstWidth = firstFrameBeforeResize?.width ?? 0;
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
  await expect.poll(async () => {
    const box = await firstFrame.boundingBox();
    return box ? box.width / box.height : 0;
  }).toBeCloseTo(firstRatio, 2);

  const sourceIds = await group.locator("[data-image-id]").evaluateAll((frames) =>
    frames.map((frame) => (frame as HTMLElement).dataset.imageId ?? ""));
  const firstBox = await group.locator(`[data-image-id="${sourceIds[0]}"]`).boundingBox();
  const secondBox = await group.locator(`[data-image-id="${sourceIds[1]}"]`).boundingBox();
  if (!firstBox || !secondBox) throw new Error("Expected BlockNote image drag geometry");
  await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(secondBox.x + secondBox.width - 3, secondBox.y + secondBox.height / 2, {
    steps: 8,
  });
  await expect(page.getByRole("dialog", { name: "参考图" })).toHaveCount(0);
  await page.mouse.up();
  await expect.poll(async () =>
    group.locator("[data-image-id]").evaluateAll((frames) =>
      frames.map((frame) => (frame as HTMLElement).dataset.imageId ?? "")),
  ).toEqual([sourceIds[1], sourceIds[0]]);

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
  await expect(trigger).toHaveText("导出", { timeout: 10_000 });
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

test("migrates schema-v13 projects to multi-column schema v14", async ({
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
      `preshot.browser-blocknote-plan-v14:${encodeURIComponent(projectPath)}`,
    );
    const plan = stored ? JSON.parse(stored) : null;
    return plan
      ? [plan.schemaVersion, plan.document?.version]
      : null;
  })).toEqual([14, 2]);
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

  await page.getByText("第三段", { exact: true }).hover();
  await page.waitForTimeout(120);
  const thirdHandle = await page.getByRole("button", {
    name: "打开菜单",
  }).boundingBox();
  const firstTarget = await page.getByText("第一段", {
    exact: true,
  }).locator(
    'xpath=ancestor::div[@data-node-type="blockOuter"][1]',
  ).boundingBox();
  if (!thirdHandle || !firstTarget) {
    throw new Error("Expected same-row drag geometry");
  }
  await page.mouse.move(
    thirdHandle.x + thirdHandle.width / 2,
    thirdHandle.y + thirdHandle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    firstTarget.x + firstTarget.width - 2,
    firstTarget.y + firstTarget.height / 2,
    { steps: 12 },
  );
  await expect(page.locator(
    '[data-preshot-block-drop-overlay="right"]',
  )).toBeVisible();
  await page.mouse.up();
  await expect(page.locator(".bn-block-column-list")).toHaveCount(1);
  await expect(page.locator(".bn-block-column")).toHaveCount(2);
});

test("persists text and an image group in the same column row", async ({
  page,
}) => {
  await page.goto("/");
  const editor = page.locator(".bn-editor");
  await editor.click();
  await page.keyboard.type("/");
  await page.getByText("两列", { exact: true }).click();

  const columns = page.locator(".bn-block-column");
  await expect(columns).toHaveCount(2);
  await columns.nth(0).locator('[data-content-type="paragraph"]').click({
    position: { x: 12, y: 10 },
  });
  await page.keyboard.type("左侧拍摄说明");
  await page.evaluate(() => {
    const target = window as typeof window & {
      __PRESHOT_BLOCKNOTE_EDITOR__?: {
        document: Array<{
          type: string;
          children: Array<{ children: Array<{ id: string }> }>;
        }>;
        setTextCursorPosition(blockId: string, placement: "start"): void;
      };
    };
    const editor = target.__PRESHOT_BLOCKNOTE_EDITOR__;
    const rightBlock = editor?.document
      .find((block) => block.type === "columnList")
      ?.children[1]?.children[0];
    if (editor && rightBlock) {
      editor.setTextCursorPosition(rightBlock.id, "start");
    }
  });
  await page.keyboard.type("/");
  await page.getByText("图片组", { exact: true }).click();
  const imageGroup = page.locator(".preshot-blocknote-image-group");
  await expect(imageGroup).toBeVisible();
  await imageGroup.getByRole("button", { name: "添加图片" }).first().click();
  await expect(imageGroup.locator("[data-image-id]")).toHaveCount(2);

  await expect.poll(() => page.evaluate(() => {
    const target = window as typeof window & {
      __PRESHOT_BLOCKNOTE_EDITOR__?: {
        document: Array<{
          type: string;
          children: Array<{
            type: string;
            props: Record<string, unknown>;
            children: Array<{ type: string }>;
          }>;
        }>;
      };
    };
    const columnList = target.__PRESHOT_BLOCKNOTE_EDITOR__?.document.find(
      (block) => block.type === "columnList",
    );
    return columnList
      ? {
          widths: columnList.children.map((column) => column.props.width),
          rightTypes: columnList.children[1]?.children.map(
            (block) => block.type,
          ),
        }
      : null;
  })).toEqual({
    widths: [1, 1],
    rightTypes: ["imageGroup"],
  });

  const leftBox = await columns.nth(0).boundingBox();
  if (!leftBox) throw new Error("Expected column resize geometry");
  await page.mouse.move(leftBox.x + leftBox.width, leftBox.y + 60);
  await page.mouse.down();
  await page.mouse.move(leftBox.x + leftBox.width + 35, leftBox.y + 60, {
    steps: 8,
  });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => {
    const target = window as typeof window & {
      __PRESHOT_BLOCKNOTE_EDITOR__?: {
        document: Array<{
          type: string;
          children: Array<{ props: Record<string, unknown> }>;
        }>;
      };
    };
    return target.__PRESHOT_BLOCKNOTE_EDITOR__?.document
      .find((block) => block.type === "columnList")
      ?.children.map((column) => column.props.width);
  })).not.toEqual([1, 1]);

  await expect(page.getByTestId("save-status")).toHaveText(
    "已保存所有更改",
    { timeout: 10_000 },
  );
  await page.reload();
  await expect(page.locator(".bn-block-column")).toHaveCount(2);
  await expect(page.getByText("左侧拍摄说明", { exact: true })).toBeVisible();
  await expect(page.locator(".preshot-blocknote-image-group")).toBeVisible();
  const { option, trigger } = await openExportMenu(page, "PDF");
  await option.click();
  await expect(trigger).toHaveText("导出", { timeout: 10_000 });
});

test("drags an image group from its gray surface beside another group", async ({
  page,
}) => {
  await page.goto("/");
  const editor = page.locator(".bn-editor");
  await editor.click();
  for (let index = 0; index < 2; index += 1) {
    await page.keyboard.type("/");
    await page.locator(".bn-suggestion-menu").getByText(
      "图片组",
      { exact: true },
    ).click();
    if (index === 0) {
      await page.evaluate(() => {
        const target = window as typeof window & {
          __PRESHOT_BLOCKNOTE_EDITOR__?: {
            document: Array<{ id: string; type: string }>;
            setTextCursorPosition(blockId: string, placement: "start"): void;
          };
        };
        const block = target.__PRESHOT_BLOCKNOTE_EDITOR__?.document.at(-1);
        if (block?.type === "paragraph") {
          target.__PRESHOT_BLOCKNOTE_EDITOR__?.setTextCursorPosition(
            block.id,
            "start",
          );
        }
      });
    }
  }

  const groups = page.locator(".preshot-blocknote-image-group");
  await expect(groups).toHaveCount(2);
  for (let index = 0; index < 2; index += 1) {
    const group = groups.nth(index);
    await group.getByRole("button", { name: "添加图片" }).first().click();
    await expect(group.locator("[data-image-id]")).toHaveCount(2);
  }
  const sourceBox = await groups.nth(1).boundingBox();
  const sourceImageBoxes = await groups.nth(1).locator("[data-image-id]")
    .evaluateAll((images) => images.map((image) => {
      const rect = image.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
    }));
  const targetBox = await groups.nth(0).locator(
    'xpath=ancestor::div[@data-node-type="blockOuter"][1]',
  ).boundingBox();
  if (!sourceBox || !targetBox || sourceImageBoxes.length < 2) {
    throw new Error("Expected image-group block drag geometry");
  }
  const [firstImageBox, secondImageBox] = sourceImageBoxes;
  const sourcePoint = secondImageBox.x >= firstImageBox.x + firstImageBox.width
    ? {
        x: (firstImageBox.x + firstImageBox.width + secondImageBox.x) / 2,
        y: Math.max(firstImageBox.y, secondImageBox.y) +
          Math.min(firstImageBox.height, secondImageBox.height) / 2,
      }
    : {
        x: Math.max(firstImageBox.x, secondImageBox.x) +
          Math.min(firstImageBox.width, secondImageBox.width) / 2,
        y: (firstImageBox.y + firstImageBox.height + secondImageBox.y) / 2,
      };
  await page.mouse.move(
    sourcePoint.x,
    sourcePoint.y,
  );
  await page.mouse.down();
  await page.mouse.move(
    targetBox.x + targetBox.width - 2,
    targetBox.y + targetBox.height / 2,
    { steps: 15 },
  );
  await expect(page.locator(
    '[data-preshot-block-drop-overlay="right"]',
  )).toBeVisible();
  await page.mouse.up();

  await expect(page.locator(".bn-block-column-list")).toHaveCount(1);
  await expect(page.locator(".bn-block-column")).toHaveCount(2);
  await expect(page.locator(".bn-block-column").nth(0)
    .locator(".preshot-blocknote-image-group")).toHaveCount(1);
  await expect(page.locator(".bn-block-column").nth(1)
    .locator(".preshot-blocknote-image-group")).toHaveCount(1);
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
  await expect(page.getByTestId("save-status")).toHaveText(
    "已保存所有更改",
    { timeout: 10_000 },
  );
  await expect.poll(() => page.evaluate(() => {
    const projectPath = "C:\\Preshot Demo\\编辑大片示例";
    const stored = sessionStorage.getItem(
      `preshot.browser-blocknote-plan-v14:${encodeURIComponent(projectPath)}`,
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
