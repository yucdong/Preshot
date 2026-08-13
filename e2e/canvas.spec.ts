import { expect, test, type Page } from "@playwright/test";

async function openCanvas(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("plan-document-canvas")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "方案正文" })).toHaveCount(1);
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改", {
    timeout: 10_000,
  });
}

async function selectText(page: Page) {
  const editor = page.getByRole("textbox", { name: "方案正文" });
  const box = await editor.locator("p").first().boundingBox();
  if (!box) throw new Error("Expected visible document editor");
  await page.mouse.click(box.x + 80, box.y + 60);
  await editor.evaluate((element) => {
    const block = element.querySelector("p") ?? element.querySelector("h1,h2,h3,h4,h5,h6");
    const text = block?.firstChild;
    if (!block || !text) throw new Error("Expected document text");
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  return editor;
}

async function selectGroup(page: Page, id = "ref-1") {
  const group = page.locator(`[data-image-group-id="${id}"]`);
  await group.dispatchEvent("pointerdown", {
    button: 0,
    isPrimary: true,
    pointerId: 1,
    pointerType: "mouse",
  });
  return group;
}

async function insertFromTop(page: Page) {
  await page.getByRole("button", { name: /^插入$/ }).dispatchEvent("click");
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveCount(1);
  await menu.getByRole("menuitem", { name: "图片组" }).dispatchEvent("click");
}

async function activateTrailingBlankInsert(page: Page) {
  const editor = page.getByRole("textbox", { name: "方案正文" });
  await editor.locator("p:last-child").click();
  const button = page.getByRole("button", { name: "在空白行插入组件" });
  await expect(button).toBeVisible();
  return button;
}

test("renders one unrestricted document with atomic image groups", async ({ page }) => {
  await openCanvas(page);

  const editor = page.getByRole("textbox", { name: "方案正文" });
  await expect(page.locator("[data-component-frame=true]")).toHaveCount(0);
  await expect(page.getByTestId("canvas-page-background").locator(":scope > div")).toHaveCount(0);
  await expect(page.locator('[data-image-group-id="ref-1"]')).toHaveCount(1);
  await expect(editor.locator("h2")).toContainText(["日落大片", "造型参考"]);
  await expect(page.getByRole("button", { name: "在空白行插入组件" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^插入组件$/ })).toHaveCount(0);

  const groupWidth = await page.locator('[data-image-group-id="ref-1"]').evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  const editorContentWidth = await editor.evaluate((element) => {
    const style = getComputedStyle(element);
    return element.getBoundingClientRect().width -
      Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
  });
  expect(Math.abs(groupWidth - editorContentWidth)).toBeLessThanOrEqual(5);
  const documentSurface = await editor.evaluate((element) => {
    const editorStyle = getComputedStyle(element);
    const group = element.querySelector("[data-image-group-id]");
    const groupStyle = group ? getComputedStyle(group) : null;
    return {
      editorBorder: editorStyle.borderTopWidth,
      editorBackground: editorStyle.backgroundColor,
      editorPadding: editorStyle.paddingLeft,
      groupBorder: groupStyle?.borderTopWidth,
    };
  });
  expect(documentSurface.editorBorder).toBe("0px");
  expect(documentSurface.editorBackground).toBe("rgba(0, 0, 0, 0)");
  expect(documentSurface.editorPadding).toBe("0px");
  expect(documentSurface.groupBorder).toBe("1px");
});

test("shows page-scaled contextual property bars only for active selections", async ({ page }) => {
  await openCanvas(page);
  await expect(page.getByRole("toolbar", { name: "文字属性" })).toBeHidden();
  const editor = await selectText(page);
  const textToolbar = page.getByRole("toolbar", { name: "文字属性" });
  await expect(textToolbar).toBeVisible();
  const textToolbarBox = await textToolbar.boundingBox();
  const textSelectionBox = await editor.evaluate(() => {
    const selection = window.getSelection();
    if (!selection?.rangeCount) throw new Error("Expected text selection");
    return selection.getRangeAt(0).getBoundingClientRect().toJSON();
  });
  const canvasBox = await page.getByTestId("paged-canvas-surface").boundingBox();
  const canvasScale = (canvasBox?.width ?? 0) / 595;
  expect(textToolbarBox?.height).toBeCloseTo(67 * canvasScale, 0);
  expect((textToolbarBox?.x ?? 0)).toBeGreaterThanOrEqual((textSelectionBox.right ?? 0) - 1);
  await expect(textToolbar.getByRole("button", { name: /插入图片组/ })).toHaveCount(0);
  await expect(textToolbar.getByRole("button", { name: "增加缩进" })).toBeVisible();
  await expect(textToolbar.getByRole("button", { name: "减少缩进" })).toBeVisible();
  await expect(textToolbar.getByRole("button", { name: "居中对齐" })).toBeVisible();

  await page.getByTestId("canvas-scroller").click({ position: { x: 8, y: 8 } });
  await expect(textToolbar).toBeHidden();
  await expect.poll(() => editor.evaluate(() => window.getSelection()?.isCollapsed)).toBe(true);

  const group = await selectGroup(page);
  const groupToolbar = page.getByRole("toolbar", { name: "图片组属性" });
  await expect(groupToolbar).toBeVisible();
  const groupToolbarBox = await groupToolbar.boundingBox();
  const groupBox = await group.boundingBox();
  expect(groupToolbarBox?.height).toBeCloseTo(40 * canvasScale, 0);
  expect(Math.abs((groupToolbarBox?.x ?? 0) - (groupBox?.x ?? 0))).toBeLessThanOrEqual(1);
  await expect(groupToolbar.getByRole("button", { name: "添加图片" })).toBeVisible();
  await expect(groupToolbar.getByRole("button", { name: "删除图片组" })).toBeVisible();
});

test("double-click selects a text block and any other click clears the selection", async ({ page }) => {
  await openCanvas(page);
  const editor = page.getByRole("textbox", { name: "方案正文" });
  const paragraph = editor.locator("p").first();
  const expectedText = (await paragraph.textContent())?.trim();
  if (!expectedText) throw new Error("Expected seeded paragraph text");

  await paragraph.dblclick({ position: { x: 16, y: 10 } });
  await expect(page.getByRole("toolbar", { name: "文字属性" })).toBeVisible();
  await expect.poll(() => editor.evaluate(() => window.getSelection()?.toString())).toBe(expectedText);
  await expect(paragraph).toHaveCSS("cursor", "text");

  await editor.locator("h2").last().click({ position: { x: 8, y: 8 } });
  await expect(page.getByRole("toolbar", { name: "文字属性" })).toBeHidden();
  await expect.poll(() => editor.evaluate(() => window.getSelection()?.isCollapsed)).toBe(true);
});

test("closes the top insert menu when clicking elsewhere", async ({ page }) => {
  await openCanvas(page);
  await page.getByRole("button", { name: /^插入$/ }).click();
  await expect(page.getByRole("menu")).toBeVisible();

  await page.getByTestId("canvas-scroller").click({ position: { x: 8, y: 8 } });
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("keeps the document horizontally centered while wheel zooming", async ({ page }) => {
  await openCanvas(page);
  const scroller = page.getByTestId("canvas-scroller");
  const canvas = page.getByTestId("paged-canvas-surface");
  const centerDelta = async () => {
    const scrollerBox = await scroller.boundingBox();
    const canvasBox = await canvas.boundingBox();
    if (!scrollerBox || !canvasBox) throw new Error("Expected canvas geometry");
    return Math.abs(
      canvasBox.x + canvasBox.width / 2 - (scrollerBox.x + scrollerBox.width / 2),
    );
  };

  expect(await centerDelta()).toBeLessThanOrEqual(1);
  const scrollerBox = await scroller.boundingBox();
  if (!scrollerBox) throw new Error("Expected canvas scroller");
  await scroller.dispatchEvent("wheel", {
    clientX: scrollerBox.x + scrollerBox.width / 2,
    clientY: scrollerBox.y + scrollerBox.height / 2,
    ctrlKey: true,
    deltaY: -100,
  });
  await expect.poll(centerDelta).toBeLessThanOrEqual(1);
});

test("keeps every text block and image group within one A4 page", async ({ page }) => {
  const paragraphs = Array.from({ length: 14 }, (_unused, index) =>
    `<p>${`第 ${index + 1} 段分页测试文字。`.repeat(20)}</p>`,
  ).join("");
  const oversized = `<p>${"超长文字块必须自动缩放到单页。".repeat(450)}</p>`;
  await page.addInitScript(({ html }) => {
    window.sessionStorage.setItem("preshot.browser-canvas-plan", JSON.stringify({
      schemaVersion: 12,
      title: "分页测试",
      documentHtml: `${html}<figure data-preshot-node="image-group" data-preshot-group-id="pagination-group"></figure><p></p>`,
      components: [{
        id: "pagination-group",
        name: "分页图片组",
        type: "reference",
        x: 0,
        width: 547.28,
        height: 180,
        description: "",
        images: [],
      }],
    }));
  }, { html: paragraphs + oversized });
  await openCanvas(page);
  await expect.poll(() => page.getByTestId("canvas-page-background").count(), { timeout: 10_000 }).toBeGreaterThan(1);
  const containment = await page.evaluate(() => {
    const pages = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="canvas-page-background"]'))
      .map((pageElement) => pageElement.getBoundingClientRect());
    const pageWidth = pages[0]?.width ?? 595.28;
    const margin = 24 * pageWidth / 595.28;
    const textBlocks = Array.from(document.querySelectorAll<HTMLElement>(
      '.tiptap-editor > p:not(:last-child)',
    )).map((element, index) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return { name: `text-${index}`, rect: range.getBoundingClientRect() };
    });
    const group = document.querySelector<HTMLElement>('[data-image-group-id="pagination-group"]');
    const items = [
      ...textBlocks,
      ...(group ? [{ name: "image-group", rect: group.getBoundingClientRect() }] : []),
    ];
    return items.map(({ name, rect }) => ({
      name,
      contained: pages.some((pageRect) =>
        rect.top >= pageRect.top + margin - 1 && rect.bottom <= pageRect.bottom - margin + 1,
      ),
      top: rect.top,
      bottom: rect.bottom,
    }));
  });
  expect(containment.filter((item) => !item.contained)).toEqual([]);
});

test("keeps pagination geometry stable while typing", async ({ page }) => {
  const html = Array.from({ length: 10 }, (_unused, index) =>
    `<p>${`第 ${index + 1} 段输入稳定性测试。`.repeat(30)}</p>`,
  ).join("");
  await page.addInitScript((documentHtml) => {
    window.sessionStorage.setItem("preshot.browser-canvas-plan", JSON.stringify({
      schemaVersion: 12,
      title: "输入稳定性测试",
      documentHtml: `${documentHtml}<p></p>`,
      components: [],
    }));
  }, html);
  await openCanvas(page);

  const editor = page.getByRole("textbox", { name: "方案正文" });
  const target = editor.locator(".preshot-document-page-spacer + p").first();
  await expect(target).toBeVisible();
  const initialSpacerCount = await editor.locator(".preshot-document-page-spacer").count();
  expect(initialSpacerCount).toBeGreaterThan(0);
  await target.click({ position: { x: 24, y: 12 } });
  await page.keyboard.press("End");

  await target.evaluate((element) => {
    const samples: Array<{
      spacerCount: number;
      targetOffset: number;
    }> = [];
    const state = window as typeof window & {
      __paginationInputRecorder?: {
        running: boolean;
        samples: typeof samples;
      };
    };
    state.__paginationInputRecorder = { running: true, samples };
    const sample = () => {
      if (!state.__paginationInputRecorder?.running) return;
      samples.push({
        spacerCount: document.querySelectorAll(".preshot-document-page-spacer").length,
        targetOffset: element.getBoundingClientRect().top -
          (document.querySelector<HTMLElement>(".tiptap-editor")?.getBoundingClientRect().top ?? 0),
      });
      window.requestAnimationFrame(sample);
    };
    window.requestAnimationFrame(sample);
  });

  for (const character of "分页输入稳定") {
    await page.keyboard.insertText(character);
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(250);
  const samples = await page.evaluate(() => {
    const state = window as typeof window & {
      __paginationInputRecorder?: {
        running: boolean;
        samples: Array<{ spacerCount: number; targetOffset: number }>;
      };
    };
    if (!state.__paginationInputRecorder) throw new Error("Expected pagination recorder");
    state.__paginationInputRecorder.running = false;
    return state.__paginationInputRecorder.samples;
  });

  expect(samples.length).toBeGreaterThan(10);
  expect(Math.min(...samples.map((sample) => sample.spacerCount))).toBeGreaterThan(0);
  const targetOffsets = samples.map((sample) => sample.targetOffset);
  const transitions = samples.filter((sample, index) =>
    index === 0 || Math.abs(sample.targetOffset - samples[index - 1].targetOffset) > 0.1);
  expect(
    Math.max(...targetOffsets) - Math.min(...targetOffsets),
    JSON.stringify(transitions),
  ).toBeLessThanOrEqual(1);
  await expect(target).toContainText("分页输入稳定");
});

test("renders Word-style page corners and keeps page gaps non-editable", async ({ page }) => {
  const html = Array.from({ length: 18 }, (_unused, index) =>
    `<p>${`第 ${index + 1} 段自动分页正文。`.repeat(18)}</p>`,
  ).join("");
  await page.addInitScript((documentHtml) => {
    window.sessionStorage.setItem("preshot.browser-canvas-plan", JSON.stringify({
      schemaVersion: 12,
      title: "统一正文",
      documentHtml: `${documentHtml}<p></p>`,
      components: [],
    }));
  }, html);
  await openCanvas(page);
  const pages = page.getByTestId("canvas-page-background");
  await expect.poll(() => pages.count()).toBeGreaterThan(1);
  await expect(page.getByRole("textbox", { name: "画布标题" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "方案正文" })).toHaveCount(1);
  await expect(pages.first().getByTestId("canvas-page-corner")).toHaveCount(4);

  const gap = page.getByTestId("canvas-page-gap").first();
  await expect(gap).toBeVisible();
  const editor = page.getByRole("textbox", { name: "方案正文" });
  await editor.locator("p").first().dblclick();
  await expect.poll(() => editor.evaluate(() => window.getSelection()?.isCollapsed)).toBe(false);
  await gap.click();
  await expect.poll(() => editor.evaluate(() => window.getSelection()?.isCollapsed)).toBe(true);
  await expect(page.getByRole("toolbar", { name: "文字属性" })).toBeHidden();
});

test("formats text in the single document and persists it", async ({ page }) => {
  await openCanvas(page);
  const editor = await selectText(page);
  await page.getByRole("toolbar", { name: "文字属性" }).getByRole("button", { name: "加粗" }).click();
  await expect.poll(() => editor.innerHTML()).toContain("<strong>");
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改", {
    timeout: 10_000,
  });
  await page.reload();
  await expect(page.getByRole("textbox", { name: "方案正文" })).toContainText("海滨的黄金时刻");
  await expect(page.getByRole("textbox", { name: "方案正文" }).locator("strong")).toContainText(
    "海滨的黄金时刻",
  );
});

test("exposes all document block styles plus alignment and indentation controls", async ({ page }) => {
  await openCanvas(page);
  const editor = await selectText(page);
  const toolbar = page.getByRole("toolbar", { name: "文字属性" });

  await toolbar.getByRole("button", { name: "段落" }).click();
  const menu = page.getByRole("menu", { name: "块类型" });
  await expect(menu.getByRole("menuitem")).toHaveText([
    "段落",
    "一级标题",
    "二级标题",
    "三级标题",
    "四级标题",
    "五级标题",
    "六级标题",
    "引用",
    "无序列表",
    "有序列表",
    "任务列表",
    "代码块",
  ]);
  await menu.getByRole("menuitem", { name: "代码块" }).click();
  await expect(editor.locator("pre")).toContainText("海滨的黄金时刻");

  await page.reload();
  const centeredEditor = await selectText(page);
  const centeredToolbar = page.getByRole("toolbar", { name: "文字属性" });
  await centeredToolbar.getByRole("button", { name: "居中对齐" }).click();
  await expect.poll(() => centeredEditor.locator("p").first().evaluate((element) => getComputedStyle(element).textAlign)).toBe("center");
  await expect(centeredToolbar.getByRole("button", { name: "增加缩进" })).toBeVisible();
  await expect(centeredToolbar.getByRole("button", { name: "减少缩进" })).toBeVisible();
});

test("shows the minimum mixed font size and normalizes the selection on adjustment", async ({ page }) => {
  await openCanvas(page);
  const editor = page.getByRole("textbox", { name: "方案正文" });
  const selectRange = async (start: number, end: number) => editor.evaluate((element, range) => {
    const paragraph = element.querySelector("p");
    if (!paragraph) throw new Error("Expected paragraph text");
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let textNode: Node | null;
    while ((textNode = walker.nextNode())) textNodes.push(textNode as Text);
    const nodeAtOffset = (offset: number) => {
      let remaining = offset;
      for (const node of textNodes) {
        if (remaining <= node.data.length) return { node, offset: remaining };
        remaining -= node.data.length;
      }
      throw new Error("Range offset exceeds paragraph text");
    };
    const rangeStart = nodeAtOffset(range.start);
    const rangeEnd = nodeAtOffset(range.end);
    const selectionRange = document.createRange();
    selectionRange.setStart(rangeStart.node, rangeStart.offset);
    selectionRange.setEnd(rangeEnd.node, rangeEnd.offset);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(selectionRange);
    element.focus();
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }, { start, end });

  await selectRange(0, 2);
  await page.getByRole("toolbar", { name: "文字属性" }).getByRole("button", { name: "增大字号" }).click();
  await selectRange(0, "海滨的黄金时刻。记得带 85mm 镜头。".length);

  const mixedSize = page.getByLabel("混合字号，最小值 16 像素");
  await expect(mixedSize).toHaveText("16+");
  await page.getByRole("toolbar", { name: "文字属性" }).getByRole("button", { name: "增大字号" }).click();
  await expect(page.getByLabel("字号 17 像素")).toHaveText("17");
  await expect.poll(() => editor.locator("p").first().evaluate((element) => {
    const sizes = new Set(Array.from(element.querySelectorAll("span")).map((span) => getComputedStyle(span).fontSize));
    return [...sizes];
  })).toEqual(["17px"]);
});

test("applies a custom RGB color through the independent More Colors surface", async ({ page }) => {
  await openCanvas(page);
  const editor = await selectText(page);
  const toolbar = page.getByRole("toolbar", { name: "文字属性" });

  await toolbar.getByRole("button", { name: "选择文字颜色" }).click();
  await expect(page.getByRole("listbox", { name: "标准颜色" })).toBeVisible();
  await page.getByRole("button", { name: /More Colors/ }).click();
  await expect(page.getByRole("listbox", { name: "标准颜色" })).toHaveCount(0);
  const picker = page.getByRole("dialog", { name: "更多颜色" });
  await expect(picker).toBeVisible();
  await picker.getByRole("spinbutton", { name: "R 颜色值" }).fill("123");
  await picker.getByRole("spinbutton", { name: "G 颜色值" }).fill("45");
  await picker.getByRole("spinbutton", { name: "B 颜色值" }).fill("210");
  await picker.getByRole("button", { name: "应用" }).click();

  await expect.poll(() => editor.locator("p span").first().evaluate((element) => getComputedStyle(element).color)).toBe("rgb(123, 45, 210)");
});

test("top and page-end insert menus only create image groups and survive reload", async ({ page }) => {
  await openCanvas(page);
  const before = await page.locator("[data-image-group-id]").count();

  await insertFromTop(page);
  await expect(page.locator("[data-image-group-id]")).toHaveCount(before + 1);
  const endPlus = await activateTrailingBlankInsert(page);
  await endPlus.click();
  const inlineMenu = page.getByRole("menu", { name: "选择组件" });
  await expect(inlineMenu.getByRole("menuitem")).toHaveCount(1);
  await inlineMenu.getByRole("menuitem", { name: "图片组" }).click();
  await expect(page.locator("[data-image-group-id]")).toHaveCount(before + 2);
  await expect(page.getByRole("button", { name: "在空白行插入组件" })).toBeVisible();
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改", {
    timeout: 10_000,
  });

  await page.reload();
  await expect(page.locator("[data-image-group-id]")).toHaveCount(before + 2);
  await expect(page.getByRole("textbox", { name: "方案正文" })).toHaveCount(1);
});

test("shows a blank-line insert control and inserts an image group at that line", async ({ page }) => {
  await openCanvas(page);
  const editor = page.getByRole("textbox", { name: "方案正文" });
  const before = await page.locator("[data-image-group-id]").count();

  await editor.locator("p:last-child").click();

  const blankInsert = page.getByRole("button", { name: "在空白行插入组件" });
  await expect(blankInsert).toBeVisible();
  const blankBox = await editor.locator("p:last-child").boundingBox();
  const insertBox = await blankInsert.boundingBox();
  expect((insertBox?.x ?? 0)).toBeLessThan(blankBox?.x ?? 0);

  await blankInsert.click();
  const menu = page.getByRole("menu", { name: "选择组件" });
  await expect(menu.getByRole("menuitem")).toHaveCount(1);
  await menu.getByRole("menuitem", { name: "图片组" }).click();
  await expect(page.locator("[data-image-group-id]")).toHaveCount(before + 1);
  await expect(editor.locator("p:last-child")).toHaveCount(1);
});

test("imports into an empty group, changes group height, and removes it atomically", async ({ page }) => {
  await openCanvas(page);
  const before = await page.locator("[data-image-group-id]").count();
  await insertFromTop(page);
  await expect(page.locator("[data-image-group-id]")).toHaveCount(before + 1);
  const emptyGroup = page.locator("[data-image-group-id]").last();
  const id = await emptyGroup.getAttribute("data-image-group-id");
  if (!id) throw new Error("Expected inserted image-group id");

  await selectGroup(page, id);
  const toolbar = page.getByRole("toolbar", { name: "图片组属性" });
  await toolbar.getByRole("button", { name: "添加图片" }).click();
  await expect(emptyGroup.getByRole("button", { name: /选择参考图/ })).toHaveCount(2, {
    timeout: 10_000,
  });

  const firstImage = emptyGroup.getByRole("button", { name: /选择参考图/ }).first();
  const beforeHeight = (await firstImage.boundingBox())?.height ?? 0;
  const heightInput = toolbar.getByRole("spinbutton", { name: "图片组高度" });
  await heightInput.fill(String(Math.round(beforeHeight + 24)));
  await heightInput.press("Enter");
  await expect.poll(async () => (await firstImage.boundingBox())?.height ?? 0).toBeGreaterThan(beforeHeight);

  await firstImage.dispatchEvent("click");
  const imageToolbar = page.getByRole("toolbar", { name: "图片属性" });
  await expect(imageToolbar).toBeVisible();
  await imageToolbar.getByRole("button", { name: "删除图片" }).click();
  await expect(emptyGroup.getByRole("button", { name: /选择参考图/ })).toHaveCount(1);

  await toolbar.getByRole("button", { name: "删除图片组" }).click();
  await expect(page.locator(`[data-image-group-id="${id}"]`)).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "方案正文" }).locator(
    `figure[data-preshot-group-id="${id}"]`,
  )).toHaveCount(0);
});

test("resizes image and group corners, persists the image view, and dismisses the toolbar on wheel", async ({ page }) => {
  await openCanvas(page);
  const unselectedGroup = page.locator('[data-image-group-id="ref-1"]');
  const groupStyleBefore = await unselectedGroup.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      border: style.borderWidth,
      shadow: style.boxShadow,
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
    };
  });
  const group = await selectGroup(page);
  const image = group.getByRole("button", { name: "选择参考图 1" });
  const imageStyleBefore = await image.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      border: style.borderWidth,
      shadow: style.boxShadow,
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
    };
  });
  await image.dispatchEvent("click");
  const imageFrame = image.locator("..");
  const selectionStyle = await group.evaluate((element) => {
    const style = getComputedStyle(element);
    const imageButton = element.querySelector<HTMLElement>(".preshot-document-image-button")!;
    const imageStyle = getComputedStyle(imageButton);
    return {
      groupBackground: style.backgroundColor,
      groupBorder: style.borderWidth,
      groupShadow: style.boxShadow,
      groupWidth: element.getBoundingClientRect().width,
      groupHeight: element.getBoundingClientRect().height,
      groupPseudo: getComputedStyle(element, "::before").content,
      imageBorder: imageStyle.borderWidth,
      imageShadow: imageStyle.boxShadow,
      imageWidth: imageButton.getBoundingClientRect().width,
      imageHeight: imageButton.getBoundingClientRect().height,
    };
  });
  expect(selectionStyle.groupBackground).not.toBe(groupStyleBefore.background);
  expect(selectionStyle.groupBorder).toBe(groupStyleBefore.border);
  expect(selectionStyle.groupShadow).toBe(groupStyleBefore.shadow);
  expect(selectionStyle.groupWidth).toBeCloseTo(groupStyleBefore.width, 2);
  expect(selectionStyle.groupHeight).toBeCloseTo(groupStyleBefore.height, 2);
  expect(selectionStyle.groupPseudo).toBe("none");
  expect(selectionStyle.imageBorder).toBe(imageStyleBefore.border);
  expect(selectionStyle.imageShadow).toBe(imageStyleBefore.shadow);
  expect(selectionStyle.imageWidth).toBeCloseTo(imageStyleBefore.width, 2);
  expect(selectionStyle.imageHeight).toBeCloseTo(imageStyleBefore.height, 2);
  await expect(imageFrame.locator(".preshot-document-image-index")).toHaveText("01");
  await expect(imageFrame.locator('[data-image-resize-handle="edge"]')).toHaveCount(4);
  await expect(imageFrame.locator('[data-image-resize-handle="corner"]')).toHaveCount(4);
  await expect(group.locator('[data-group-resize-handle="edge"]')).toHaveCount(4);
  await expect(group.locator('[data-group-resize-handle="corner"]')).toHaveCount(4);
  await expect(imageFrame.getByRole("button", { name: "恢复参考图 1" })).toHaveCount(0);
  await expect(imageFrame.getByRole("button", { name: /删除参考图/ })).toHaveCount(0);
  await expect(page.getByRole("toolbar", { name: "图片属性" })).toBeVisible();
  await expect(page.getByRole("button", { name: "删除图片" })).toBeVisible();
  const invisibleResizeChrome = await page.evaluate(() => {
    const handles = [
      ...document.querySelectorAll<HTMLElement>(
        '[data-image-resize-handle], [data-group-resize-handle]',
      ),
    ];
    return handles.every((handle) => {
      const style = getComputedStyle(handle);
      return style.backgroundColor === "rgba(0, 0, 0, 0)" &&
        style.borderTopWidth === "0px";
    });
  });
  expect(invisibleResizeChrome).toBe(true);

  const imageBefore = await image.boundingBox();
  if (!imageBefore) throw new Error("Expected selected image geometry");
  await image.evaluate((element) => {
    element.dataset.resizeIdentity = "stable";
  });
  await imageFrame.locator('[data-image-resize-edge="bottom-right"]').evaluate((handle) => {
    const rect = handle.getBoundingClientRect();
    handle.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      clientX: rect.right,
      clientY: rect.bottom,
      pointerId: 71,
    }));
    document.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      clientX: rect.right + 12,
      clientY: rect.bottom + 9,
      pointerId: 71,
    }));
    document.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      clientX: rect.right + 12,
      clientY: rect.bottom + 9,
      pointerId: 71,
    }));
  });
  await expect.poll(async () => (await image.boundingBox())?.width ?? 0).toBeGreaterThan(imageBefore.width);
  await expect.poll(async () => (await image.boundingBox())?.height ?? 0).toBeGreaterThan(imageBefore.height);
  await expect(group.getByRole("button", { name: "选择参考图 1" })).toHaveAttribute(
    "data-resize-identity",
    "stable",
  );
  const resizedImage = await image.boundingBox();
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改", { timeout: 10_000 });

  await page.reload();
  await openCanvas(page);
  const reloadedGroup = await selectGroup(page);
  const reloadedImage = reloadedGroup.getByRole("button", { name: "选择参考图 1" });
  const reloadedImageBox = await reloadedImage.boundingBox();
  expect(reloadedImageBox?.width).toBeCloseTo(resizedImage?.width ?? 0, 0);
  expect(reloadedImageBox?.height).toBeCloseTo(resizedImage?.height ?? 0, 0);

  await reloadedImage.dispatchEvent("dblclick");
  await expect(page.getByRole("button", { name: "恢复尺寸" })).toBeVisible();
  await page.getByRole("button", { name: "恢复尺寸" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(async () => (await reloadedImage.boundingBox())?.width ?? 0).toBeCloseTo(imageBefore.width, 0);

  for (const [edge, delta, pointerId] of [
    ["left", -8, 73],
    ["right", 8, 74],
  ] as const) {
    const beforeEdgeResize = await reloadedImage.boundingBox();
    if (!beforeEdgeResize) throw new Error(`Expected ${edge} edge image geometry`);
    await reloadedGroup.locator(`[data-image-resize-edge="${edge}"]`).first().evaluate(
      (handle, input) => {
        const rect = handle.getBoundingClientRect();
        const clientX = rect.left + rect.width / 2;
        const clientY = rect.top + rect.height / 2;
        handle.dispatchEvent(new PointerEvent("pointerdown", {
          bubbles: true,
          clientX,
          clientY,
          pointerId: input.pointerId,
        }));
        document.dispatchEvent(new PointerEvent("pointermove", {
          bubbles: true,
          clientX: clientX + input.delta,
          clientY,
          pointerId: input.pointerId,
        }));
        document.dispatchEvent(new PointerEvent("pointerup", {
          bubbles: true,
          clientX: clientX + input.delta,
          clientY,
          pointerId: input.pointerId,
        }));
      },
      { delta, pointerId },
    );
    await expect.poll(async () => (await reloadedImage.boundingBox())?.width ?? 0)
      .toBeGreaterThan(beforeEdgeResize.width);
    await expect.poll(async () => (await reloadedImage.boundingBox())?.height ?? 0)
      .toBeCloseTo(beforeEdgeResize.height, 1);
    await reloadedImage.dispatchEvent("dblclick");
    await page.getByRole("button", { name: "恢复尺寸" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }

  const groupBefore = await reloadedGroup.boundingBox();
  if (!groupBefore) throw new Error("Expected image-group geometry");
  await reloadedGroup.locator('[data-group-resize-edge="bottom-right"]').evaluate((handle) => {
    const rect = handle.getBoundingClientRect();
    handle.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      clientX: rect.right,
      clientY: rect.bottom,
      pointerId: 72,
    }));
    document.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      clientX: rect.right - 16,
      clientY: rect.bottom + 10,
      pointerId: 72,
    }));
    document.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      clientX: rect.right - 16,
      clientY: rect.bottom + 10,
      pointerId: 72,
    }));
  });
  await expect.poll(async () => (await reloadedGroup.boundingBox())?.width ?? 0).toBeLessThan(groupBefore.width);
  await expect.poll(async () => (await reloadedGroup.boundingBox())?.height ?? 0).toBeGreaterThan(groupBefore.height);

  const toolbar = page.getByRole("toolbar", { name: "图片组属性" });
  await expect(toolbar).toBeVisible();
  await page.dispatchEvent("body", "wheel", { deltaY: 40 });
  await expect(toolbar).toBeHidden();
});

test("exports the v12 document to PDF", async ({ page }) => {
  await openCanvas(page);
  const button = page.getByRole("button", { name: "导出 PDF" });
  await button.click();
  await expect(button).toHaveText("导出 PDF", { timeout: 10_000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
});
