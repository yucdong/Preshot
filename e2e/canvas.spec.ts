import { expect, test, type Locator, type Page } from "@playwright/test";

const SEEDED_REFERENCE_IMAGE_COUNT = 4;
const FRAME = '[data-sortable-component-id]';

async function waitForReferenceImages(page: Page) {
  const images = page.getByRole("img", { name: "参考图" });
  await expect(images).toHaveCount(SEEDED_REFERENCE_IMAGE_COUNT);
  await expect
    .poll(() =>
      images.evaluateAll((elements) => ({
        count: elements.length,
        ready: elements.every((element) => {
          const image = element as HTMLImageElement;
          return image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
        }),
      })),
    )
    .toEqual({ count: SEEDED_REFERENCE_IMAGE_COUNT, ready: true });
}

async function componentOrder(page: Page) {
  return page.locator(FRAME).evaluateAll((elements) =>
    elements.map((element) => (element as HTMLElement).dataset.componentId ?? ""),
  );
}

async function logicalComponentIds(page: Page) {
  return page.locator(FRAME).evaluateAll((elements) =>
    [...new Set(elements.map((element) => (element as HTMLElement).dataset.componentId ?? ""))],
  );
}

test("loads the seeded canvas with plan and reference components", async ({ page }) => {
  await page.goto("/");

  const canvas = page.getByTestId("plan-canvas");
  await expect(canvas).toBeVisible();

  // Assert seeded content from the v6 browser plan (the editor contains the HTML).
  const editor = page.locator('[contenteditable="true"]').first();
  await expect(editor).toBeVisible();

  // Assert reference images are visible
  await expect(page.getByRole("img", { name: "参考图" }).first()).toBeVisible();

  // Should start in a saved state
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改");
});

test("gives the canvas more default space and zooms it with Ctrl+wheel", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/");

  await expect(page.getByRole("separator", { name: "调整项目栏宽度" })).toHaveAttribute(
    "aria-valuenow",
    "192",
  );
  await expect(page.getByRole("separator", { name: "调整助手栏宽度" })).toHaveAttribute(
    "aria-valuenow",
    "272",
  );

  const scroller = page.getByTestId("canvas-scroller");
  const paper = page.getByTestId("canvas-page-background").first();
  const initialWidth = (await paper.boundingBox())?.width ?? 0;
  const scrollerWidth = (await scroller.boundingBox())?.width ?? 1;
  expect(initialWidth / scrollerWidth).toBeGreaterThanOrEqual(0.8);
  expect(initialWidth / scrollerWidth).toBeLessThanOrEqual(0.84);
  const paperBox = await paper.boundingBox();
  const insertToolbarBox = await page.getByTestId("canvas-insert-toolbar").boundingBox();
  expect(Math.abs((paperBox?.x ?? 0) - (insertToolbarBox?.x ?? 0))).toBeLessThanOrEqual(2);
  await scroller.hover({ position: { x: 300, y: 250 } });
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");

  await expect.poll(async () => (await paper.boundingBox())?.width ?? 0).toBeCloseTo(
    initialWidth * 1.1,
    1,
  );
  const zoomedWidth = (await paper.boundingBox())?.width ?? 0;

  await page.mouse.wheel(0, 100);
  await expect.poll(async () => (await paper.boundingBox())?.width ?? 0).toBeCloseTo(
    zoomedWidth,
    1,
  );

  await page.keyboard.down("Control");
  await page.mouse.wheel(0, 100);
  await page.keyboard.up("Control");
  await expect.poll(async () => (await paper.boundingBox())?.width ?? 0).toBeCloseTo(
    initialWidth,
    1,
  );

  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect.poll(async () => {
    const paperWidth = (await paper.boundingBox())?.width ?? 0;
    const workspaceWidth = (await scroller.boundingBox())?.width ?? 1;
    return paperWidth / workspaceWidth;
  }).toBeGreaterThanOrEqual(0.8);

  await page.setViewportSize({ width: 960, height: 720 });
  await expect.poll(async () => {
    const paperBox = await paper.boundingBox();
    const toolbarBox = await page.getByTestId("canvas-insert-toolbar").boundingBox();
    return Math.abs((paperBox?.x ?? 0) - (toolbarBox?.x ?? 0));
  }).toBeLessThanOrEqual(3);
});

test("inserts a plan component and marks the canvas unsaved", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改");

  // Count initial components
  const initialFrames = await page.locator(FRAME).count();

  // Open the insert menu
  await page.getByRole("button", { name: "插入组件" }).click();

  // Insert a plan component
  await page.getByRole("menuitem", { name: "文案" }).click();

  // Assert count grew
  await expect(page.locator(FRAME)).toHaveCount(initialFrames + 1);

  // Assert save status changed to unsaved
  await expect(page.getByTestId("save-status")).toHaveText("有未保存的更改");
});

test("inserts a reference component and marks the canvas unsaved", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改");

  const initialComponentIds = await logicalComponentIds(page);

  // Open the insert menu
  await page.getByRole("button", { name: "插入组件" }).click();

  // Insert a reference component
  await page.getByRole("menuitem", { name: "图片组" }).click();

  await expect.poll(() => logicalComponentIds(page)).toHaveLength(initialComponentIds.length + 1);

  // Assert save status changed to unsaved
  await expect(page.getByTestId("save-status")).toHaveText("有未保存的更改");
});

test("uses flat component order for arrow reordering", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.goto("/");
  await waitForReferenceImages(page);
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改", {
    timeout: 10_000,
  });

  const controls = page.locator('[data-component-move-controls="ref-1"]');
  await expect(controls).toHaveCSS("opacity", "0");
  await page.locator(`${FRAME}[data-component-id="ref-1"]`).hover();
  await expect(controls).toHaveCSS("opacity", "1");
  await expect(controls.getByText("上移", { exact: true })).toBeVisible();
  await page
    .locator('[data-component-move-controls="ref-1"]')
    .getByRole("button", { name: "上移一个位置" })
    .click();
  await expect.poll(() => componentOrder(page)).toEqual(["ref-1", "plan-1"]);
  await expect(page.locator("[data-component-drag-handle]")).toHaveCount(0);
});

test("does not render logical row drop targets", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId(/row-drop-zone:/)).toHaveCount(0);
});

test("reorders a full-width component with its down arrow", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改");

  await page.locator(`${FRAME}[data-component-id="plan-1"]`).hover();
  await page
    .locator('[data-component-move-controls="plan-1"]')
    .getByRole("button", { name: "下移一个位置" })
    .click();

  await expect.poll(() => componentOrder(page)).toEqual(["ref-1", "plan-1"]);
  await expect(page.getByTestId("save-status")).toHaveText("有未保存的更改");
});

test("resizes a component's width and commits the change", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改");

  const frames = page.locator(FRAME);
  const firstFrame = frames.nth(0);

  await firstFrame.scrollIntoViewIfNeeded();

  // Get the initial width
  const initialBox = await firstFrame.boundingBox();
  if (!initialBox) throw new Error("component not visible");
  const initialWidth = initialBox.width;

  // Find the width resize handle (right edge)
  const widthHandle = firstFrame.locator('[data-resize-handle="right"]');
  const handleBox = await widthHandle.boundingBox();
  if (!handleBox) throw new Error("width handle not visible");

  // Drag the width handle to the left (shrink)
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x - 100, handleBox.y + handleBox.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  // Assert the width changed
  const newBox = await firstFrame.boundingBox();
  if (!newBox) throw new Error("component not visible after resize");
  expect(newBox.width).toBeLessThan(initialWidth - 50);

  // Assert save status changed to unsaved
  await expect(page.getByTestId("save-status")).toHaveText("有未保存的更改");
});

test("adds an image to a reference component and opens the lightbox", async ({ page }) => {
  await page.goto("/");

  // The seeded reference component has images
  const firstImage = page.getByRole("img", { name: "参考图" }).first();
  await expect(firstImage).toBeVisible();

  // Single click selects; double click opens the original in the lightbox.
  await page.getByRole("button", { name: "选择参考图 1" }).dblclick();

  // Assert lightbox opened and contains an image
  await expect(page.getByRole("dialog")).toBeVisible();
  const lightboxImage = page.getByRole("dialog").getByRole("img", { name: "参考图" });
  await expect(lightboxImage).toBeVisible();

  // Close the lightbox
  await page.getByRole("button", { name: "关闭图片" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("single click selects an image and double click opens the lightbox", async ({ page }) => {
  await page.goto("/");
  const tile = page.locator('[data-image-id="img-1"]');
  const selectButton = tile.getByRole("button", { name: "选择参考图 1" });

  await selectButton.click();
  await expect(tile).toHaveAttribute("data-selected", "true");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await selectButton.dblclick();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("overflows to multiple pages when inserting tall components", async ({ page }) => {
  await page.goto("/");

  // Initially should have one page
  await expect(page.getByTestId("canvas-page-background")).toHaveCount(1);

  // Insert multiple tall components to overflow to a second page
  // The seeded plan already has 2 components. Each component has ~220-320px height.
  // A4 is ~842pt (~1122px at 100% scale, but we're at 0.5 scale so ~561px visible).
  // Need to insert enough to exceed the first page. Let's insert 4 more.
  for (let i = 0; i < 4; i++) {
    await page.getByRole("button", { name: "插入组件" }).click();
    await page.getByRole("menuitem", { name: "图片组" }).click();
  }

  // Assert at least two pages now exist (may be more depending on component heights)
  const pageCount = await page.getByTestId("canvas-page-background").count();
  expect(pageCount).toBeGreaterThanOrEqual(2);
});

test("exports the canvas to PDF", async ({ page }) => {
  await page.goto("/");
  await waitForReferenceImages(page);

  await page.getByRole("button", { name: "导出 PDF" }).click();

  // Assert the button shows exporting state
  await expect(page.getByRole("button", { name: "正在导出…" })).toBeVisible();

  // Assert the button returns to normal state
  await expect(page.getByRole("button", { name: "导出 PDF" })).toBeVisible({ timeout: 30000 });

  // No error alerts
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("inserts a plan component and the editor becomes editable", async ({ page }) => {
  await page.goto("/");

  // Wait for the canvas to load
  await expect(page.getByTestId("plan-canvas")).toBeVisible();

  // Count initial components
  const initialFrames = await page.locator(FRAME).count();

  // Open the insert menu
  await page.getByRole("button", { name: "插入组件" }).click();

  // Insert a plan component
  await page.getByRole("menuitem", { name: "文案" }).click();

  // Wait for the new component frame to be added
  await expect(page.locator(FRAME)).toHaveCount(initialFrames + 1);

  // Get the first (newly inserted at top) component frame
  const newPlanFrame = page.locator(FRAME).first();

  // Find the contenteditable editor within the new plan frame
  const editor = newPlanFrame.locator('[contenteditable="true"]');
  await expect(editor).toBeVisible();

  // The plan component is seeded with the default Chinese template on insert,
  // so its four fill-in lines must render in the editor.
  await expect(editor).toContainText("拍摄时间：");
  await expect(editor).toContainText("拍摄地点：");
  await expect(editor).toContainText("道具和服装：");
  await expect(editor).toContainText("器材：");
});

test("keeps recursive text leaves title-free, aligned, auto-sized, and undoable", async ({ page }) => {
  await page.goto("/");
  const planFrame = page.locator(`${FRAME}[data-component-id="plan-1"]`);
  const firstLeaf = planFrame.locator("[data-text-leaf-id]").first();

  await firstLeaf.hover();
  await firstLeaf.getByRole("button", { name: "左右拆分当前文案" }).click();
  await expect(planFrame.locator("[data-text-leaf-id]")).toHaveCount(2);
  await expect(planFrame.locator("[data-text-split-id]")).toHaveCount(1);
  await expect(planFrame.getByRole("button", { name: "+ 插入标题" })).toHaveCount(0);
  await expect(planFrame.getByRole("textbox", { name: "子文案标题" })).toHaveCount(0);

  const leafHeights = await planFrame.locator("[data-text-leaf-id]").evaluateAll((leaves) =>
    leaves.map((leaf) => leaf.getBoundingClientRect().height),
  );
  expect(Math.abs(leafHeights[0] - leafHeights[1])).toBeLessThanOrEqual(1);
  await expect.poll(() => planFrame.evaluate((frame) =>
    Array.from(frame.querySelectorAll("[data-text-leaf-id], .preshot-editor-wrap, .preshot-editor-container, .tiptap-editor, .ProseMirror")).every(
      (element) => {
        const html = element as HTMLElement;
        const overflowY = getComputedStyle(html).overflowY;
        return overflowY !== "auto" && overflowY !== "scroll" && html.scrollHeight <= html.clientHeight + 1;
      },
    ),
  )).toBe(true);

  const beforeNarrowing = await planFrame.boundingBox();
  const rightHandle = planFrame.locator('[data-resize-handle="right"]');
  let handleBox = await rightHandle.boundingBox();
  if (!handleBox || !beforeNarrowing) throw new Error("Plan resize handle is not visible");
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x - 1_000, handleBox.y + handleBox.height / 2, { steps: 8 });
  await expect(planFrame.getByRole("status")).toHaveText("内容已达到最小尺寸");
  await expect(planFrame.locator('[data-resize-handle="right"]')).toHaveAttribute(
    "data-resize-limited",
    "true",
  );
  const constrainedLeaves = await planFrame.locator("[data-text-leaf-id]").evaluateAll(
    (leaves) => {
      const frame = leaves[0]?.closest('[data-component-frame="true"]');
      const surface = frame?.closest('[data-testid="paged-canvas-surface"]');
      if (!(frame instanceof HTMLElement) || !(surface instanceof HTMLElement)) return [];
      const frameRect = frame.getBoundingClientRect();
      const scale = surface.getBoundingClientRect().width / 595.28;
      return leaves.map((leaf) => {
        const element = leaf as HTMLElement;
        const rect = element.getBoundingClientRect();
        return {
          contained:
            rect.left >= frameRect.left &&
            rect.right <= frameRect.right &&
            rect.top >= frameRect.top &&
            rect.bottom <= frameRect.bottom,
          logicalWidth: rect.width / scale,
          scrollbars:
            element.scrollWidth > element.clientWidth ||
            element.scrollHeight > element.clientHeight,
        };
      });
    },
  );
  expect(constrainedLeaves).toHaveLength(2);
  expect(constrainedLeaves.every((leaf) => leaf.contained && !leaf.scrollbars)).toBe(true);
  expect(constrainedLeaves.every((leaf) => leaf.logicalWidth >= 132)).toBe(true);
  await page.mouse.up();
  await expect.poll(async () => (await planFrame.boundingBox())?.height ?? 0).toBeGreaterThan(
    beforeNarrowing.height,
  );
  const narrowed = await planFrame.boundingBox();
  handleBox = await rightHandle.boundingBox();
  if (!handleBox || !narrowed) throw new Error("Narrow plan resize handle is not visible");
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + 500, handleBox.y + handleBox.height / 2, { steps: 8 });
  await expect(planFrame.getByRole("status")).toHaveCount(0);
  await page.mouse.up();
  await expect.poll(async () => (await planFrame.boundingBox())?.height ?? 0).toBeLessThan(
    narrowed.height,
  );

  const secondLeaf = planFrame.locator("[data-text-leaf-id]").nth(1);
  await secondLeaf.hover();
  await secondLeaf.getByRole("button", { name: "上下拆分当前文案" }).click();

  await expect(planFrame.locator("[data-text-leaf-id]")).toHaveCount(3);
  await expect(planFrame.locator("[data-text-split-id]")).toHaveCount(2);
  await expect.poll(() => planFrame.evaluate((frame) => {
    const frameRight = frame.getBoundingClientRect().right;
    return Array.from(frame.querySelectorAll("[data-text-leaf-id], .preshot-editor-wrap, .tiptap-editor")).every(
      (element) => element.getBoundingClientRect().right <= frameRight + 1,
    );
  })).toBe(true);
  const beforeGrowth = await planFrame.boundingBox();
  const bottomEditor = planFrame.locator("[data-text-leaf-id]").nth(2).locator('[contenteditable="true"]');
  await bottomEditor.click();
  await page.keyboard.type("第一行\n第二行\n第三行\n第四行\n第五行\n第六行");
  await expect.poll(async () => (await planFrame.boundingBox())?.height ?? 0).toBeGreaterThan(
    beforeGrowth?.height ?? 0,
  );
  await expect.poll(() => planFrame.evaluate((frame) => {
    const frameBottom = frame.getBoundingClientRect().bottom;
    return Array.from(frame.querySelectorAll("[data-text-leaf-id]")).every(
      (leaf) => leaf.getBoundingClientRect().bottom <= frameBottom + 1,
    );
  })).toBe(true);
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改", {
    timeout: 10_000,
  });

  await page.reload();
  await expect(planFrame.locator("[data-text-leaf-id]")).toHaveCount(3, {
    timeout: 10_000,
  });
  await expect(planFrame.getByRole("textbox", { name: "子文案标题" })).toHaveCount(0);

  await planFrame.locator("[data-text-leaf-id]").nth(2).hover();
  await planFrame.locator("[data-text-leaf-id]").nth(2).getByRole("button", { name: "删除当前子文案" }).click();
  const deleteDialog = page.getByRole("dialog");
  await expect(deleteDialog).toContainText("删除这块文案？");
  await expect(planFrame.locator("[data-text-leaf-id]")).toHaveCount(3);
  await deleteDialog.getByRole("button", { name: "取消" }).click();
  await planFrame.locator("[data-text-leaf-id]").nth(2).hover();
  await planFrame.locator("[data-text-leaf-id]").nth(2).getByRole("button", { name: "删除当前子文案" }).click();
  await deleteDialog.getByRole("button", { name: "删除" }).click();
  await expect(planFrame.locator("[data-text-leaf-id]")).toHaveCount(2);
  await expect(planFrame.locator("[data-text-split-id]")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "撤销" })).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect(planFrame.locator("[data-text-leaf-id]")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "撤销" })).toHaveCount(0);
  await planFrame.locator("[data-text-leaf-id]").nth(2).hover();
  await planFrame.locator("[data-text-leaf-id]").nth(2).getByRole("button", { name: "删除当前子文案" }).click();
  await deleteDialog.getByRole("button", { name: "删除" }).click();
  await expect(planFrame.locator("[data-text-leaf-id]")).toHaveCount(2);

  await planFrame.locator("[data-text-leaf-id]").nth(1).hover();
  await planFrame.locator("[data-text-leaf-id]").nth(1).getByRole("button", { name: "删除当前子文案" }).click();
  await deleteDialog.getByRole("button", { name: "删除" }).click();
  await expect(planFrame.locator("[data-text-leaf-id]")).toHaveCount(1);
  await expect(planFrame.locator("[data-text-split-id]")).toHaveCount(0);
});

test("shows contextual formatting for a text selection and persists font size", async ({ page }) => {
  await page.goto("/");
  const planFrame = page.locator(`${FRAME}[data-component-id="plan-1"]`);
  const editor = planFrame.locator('[contenteditable="true"]').first();
  const toolbar = planFrame.locator("[data-text-leaf-id]").first().getByRole("toolbar");
  await editor.click();
  await editor.evaluate((element) => {
    const textNode = element.querySelector("p")?.firstChild;
    if (!textNode) throw new Error("Expected paragraph text");
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new Event("mouseup", { bubbles: true }));
  });

  const fontSize = toolbar.getByRole("button", { name: "选择字号" });
  await expect(fontSize).toBeVisible();
  await toolbar.getByRole("button", { name: "加粗" }).click();
  await expect.poll(() => editor.innerHTML()).toContain("<strong>");
  await fontSize.click();
  await page.getByRole("option", { name: "24" }).click();
  await expect.poll(() => editor.innerHTML()).toContain("font-size");
  await expect.poll(() => editor.innerHTML()).toContain("24px");
  await expect(page.getByTestId("save-status")).toHaveText("有未保存的更改");
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改", {
    timeout: 10_000,
  });

  await page.reload();
  await expect.poll(() => editor.innerHTML()).toContain("font-size");
  await expect.poll(() => editor.innerHTML()).toContain("24px");
});

test("shows the visual font size for each block type and closes the size menu outside", async ({ page }) => {
  await page.goto("/");
  const planFrame = page.locator(`${FRAME}[data-component-id="plan-1"]`);
  const firstLeaf = planFrame.locator("[data-text-leaf-id]").first();
  const editor = firstLeaf.locator('[contenteditable="true"]');
  const toolbar = firstLeaf.getByRole("toolbar");
  const pointer = { button: 0, isPrimary: true, pointerType: "mouse" };

  await editor.evaluate((element) => {
    const textNode = element.querySelector("p")?.firstChild;
    if (!textNode) throw new Error("Expected paragraph text");
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });

  const blockTypes = [
    ["段落", 16],
    ["一级标题", 32],
    ["二级标题", 24],
    ["三级标题", 20],
    ["四级标题", 18],
    ["五级标题", 16],
    ["六级标题", 14],
  ] as const;
  for (const [label, size] of blockTypes) {
    await toolbar.getByRole("button", { name: /段落|标题/ }).dispatchEvent("pointerdown", pointer);
    await page.getByRole("menuitem", { name: label, exact: true }).dispatchEvent("pointerdown", pointer);
    await expect(toolbar.getByRole("button", { name: `当前字号 ${size}` })).toHaveText(String(size));
  }

  await toolbar.getByRole("button", { name: "选择字号" }).dispatchEvent("pointerdown", pointer);
  const sizeMenu = page.getByRole("listbox", { name: "字号" });
  await expect(sizeMenu).toBeVisible();
  await editor.click();
  await expect(sizeMenu).toBeHidden();
});

test("keeps one formatting toolbar above every text leaf with readable block menus", async ({ page }) => {
  await page.goto("/");
  const planFrame = page.locator(`${FRAME}[data-component-id="plan-1"]`);
  const firstLeaf = planFrame.locator("[data-text-leaf-id]").first();
  const firstToolbar = firstLeaf.getByRole("toolbar");
  await expect(firstToolbar).toBeVisible();
  const frameBounds = await planFrame.boundingBox();
  const closeBounds = await planFrame.getByRole("button", { name: "移除组件" }).boundingBox();
  expect(frameBounds).not.toBeNull();
  expect(closeBounds).not.toBeNull();
  expect(closeBounds?.width).toBeCloseTo(18, 1);
  expect(closeBounds?.height).toBeCloseTo(18, 1);
  expect(Math.abs(
    (closeBounds?.x ?? 0) + (closeBounds?.width ?? 0) / 2 -
      ((frameBounds?.x ?? 0) + (frameBounds?.width ?? 0)),
  )).toBeLessThanOrEqual(1.5);
  expect(Math.abs(
    (closeBounds?.y ?? 0) + (closeBounds?.height ?? 0) / 2 - (frameBounds?.y ?? 0),
  )).toBeLessThanOrEqual(1.5);
  expect(await firstToolbar.evaluate((element) =>
    Array.from(element.querySelectorAll<HTMLButtonElement>("button"))
      .filter((button) => button.getBoundingClientRect().width > 0)
      .every((button) => {
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return hit === button || button.contains(hit);
      }),
  )).toBe(true);

  await firstLeaf.hover();
  await firstLeaf.getByRole("button", { name: "左右拆分当前文案" }).click();
  await expect(planFrame.locator("[data-text-leaf-id]")).toHaveCount(2);
  for (const leaf of await planFrame.locator("[data-text-leaf-id]").all()) {
    const toolbar = leaf.getByRole("toolbar");
    await expect(toolbar).toBeVisible();
    expect(await toolbar.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  }
  await firstLeaf.hover();
  const firstSplitToolbar = firstLeaf.getByRole("toolbar");
  const rightScroll = firstSplitToolbar.getByRole("button", { name: "向右移动工具栏" });
  await expect(rightScroll).toBeVisible();
  await rightScroll.click();
  await expect.poll(() => firstSplitToolbar.locator(".preshot-toolbar-scroll").evaluate(
    (element) => element.scrollLeft,
  )).toBeGreaterThan(0);
  await expect(firstSplitToolbar.getByRole("button", { name: "向左移动工具栏" })).toBeVisible();

  await firstLeaf.getByRole("button", { name: /段落|标题/ }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const geometry = await menu.evaluate((element) => {
    const items = Array.from(element.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    return {
      width: element.getBoundingClientRect().width,
      items: items.map((item) => ({
        height: item.getBoundingClientRect().height,
        scrollHeight: item.scrollHeight,
        whiteSpace: getComputedStyle(item).whiteSpace,
      })),
    };
  });
  expect(geometry.width).toBeGreaterThanOrEqual(220);
  expect(geometry.items.every((item) =>
    item.height >= 36 && item.scrollHeight <= item.height + 1 && item.whiteSpace === "nowrap"
  )).toBe(true);
});

test("formats selected text with a custom RGB color", async ({ page }) => {
  await page.goto("/");
  const planFrame = page.locator(`${FRAME}[data-component-id="plan-1"]`);
  const editor = planFrame.locator('[contenteditable="true"]').first();
  const toolbar = planFrame.locator("[data-text-leaf-id]").first().getByRole("toolbar");
  await editor.click();
  await editor.evaluate((element) => {
    const textNode = element.querySelector("p")?.firstChild;
    if (!textNode) throw new Error("Expected paragraph text");
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new Event("mouseup", { bubbles: true }));
  });

  await toolbar.getByRole("button", { name: "选择文字颜色" }).click();
  await page.getByRole("option", { name: "功能青 #0891B2" }).click();
  await expect.poll(() => editor.innerHTML()).toContain("rgb(8, 145, 178)");
  await editor.evaluate((element) => {
    const textNode = element.querySelector("p")?.firstChild;
    if (!textNode) throw new Error("Expected paragraph text");
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new Event("mouseup", { bubbles: true }));
  });
  await toolbar.getByRole("button", { name: "选择文字颜色" }).click();
  await page.getByRole("button", { name: "更多颜色..." }).click();
  const customColorPanel = page.getByRole("dialog", { name: "更多颜色" });
  await expect(customColorPanel).toBeVisible();
  const customColorBounds = await customColorPanel.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      insideToolbar: element.closest(".preshot-tiptap-toolbar") !== null,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  expect(customColorBounds.insideToolbar).toBe(false);
  expect(customColorBounds.width).toBeCloseTo(260, 0);
  expect(customColorBounds.left).toBeGreaterThanOrEqual(8);
  expect(customColorBounds.top).toBeGreaterThanOrEqual(8);
  expect(customColorBounds.right).toBeLessThanOrEqual(customColorBounds.viewportWidth - 8);
  expect(customColorBounds.bottom).toBeLessThanOrEqual(customColorBounds.viewportHeight - 8);
  await expect(page.getByRole("application", { name: "圆形颜色选择盘" })).toBeVisible();
  await page.getByRole("spinbutton", { name: "R 颜色值" }).fill("194");
  await page.getByRole("spinbutton", { name: "G 颜色值" }).fill("56");
  await page.getByRole("spinbutton", { name: "B 颜色值" }).fill("92");
  await expect(page.getByText("#C2385C", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "应用", exact: true }).click();
  await expect.poll(() => editor.innerHTML()).toContain("rgb(194, 56, 92)");
  const appliedState = await editor.evaluate((element) => {
    const coloredText = element.querySelector<HTMLElement>('[style*="color"]');
    const selection = window.getSelection();
    return {
      cursor: getComputedStyle(element).cursor,
      coloredCursor: coloredText ? getComputedStyle(coloredText).cursor : null,
      selectedText: selection?.toString() ?? "",
      selectionCollapsed: selection?.isCollapsed ?? false,
    };
  });
  expect(appliedState).toEqual({
    cursor: "text",
    coloredCursor: "text",
    selectedText: "",
    selectionCollapsed: true,
  });
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改", {
    timeout: 10_000,
  });
  await page.reload();
  await expect.poll(() => editor.innerHTML()).toContain("rgb(194, 56, 92)");
});

test("opens every secondary formatting surface on pointerdown", async ({ page }) => {
  const editor = page.locator(`${FRAME}[data-component-id="plan-1"] [contenteditable="true"]`).first();
  const toolbar = page.locator(`${FRAME}[data-component-id="plan-1"] [data-text-leaf-id]`).first().getByRole("toolbar");
  const prepareSelection = async () => {
    await page.goto("/");
    await editor.evaluate((element) => {
      element.focus();
      const textNode = element.querySelector("p")?.firstChild;
      if (!textNode) throw new Error("Expected paragraph text");
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.waitForTimeout(100);
  };
  const pointerDown = async (name: string) => {
    await toolbar.getByRole("button", { name }).dispatchEvent("pointerdown", {
      button: 0,
      isPrimary: true,
      pointerType: "mouse",
    });
  };

  await prepareSelection();
  await pointerDown("段落");
  await expect(page.getByRole("menu")).toBeVisible();

  await prepareSelection();
  await pointerDown("选择字号");
  await expect(page.getByRole("listbox", { name: "字号" })).toBeVisible();

  await prepareSelection();
  await pointerDown("选择文字颜色");
  await expect(page.getByRole("listbox", { name: "文字颜色" })).toBeVisible();

  await prepareSelection();
  await pointerDown("添加链接");
  await expect(page.locator('input[name="url"]')).toBeVisible();
});

test("keeps every secondary formatting surface open after a full pointer click", async ({ page }) => {
  const editor = page.locator(`${FRAME}[data-component-id="plan-1"] [contenteditable="true"]`).first();
  const toolbar = page.locator(`${FRAME}[data-component-id="plan-1"] [data-text-leaf-id]`).first().getByRole("toolbar");
  const prepareSelection = async () => {
    await page.goto("/");
    await editor.evaluate((element) => {
      element.focus();
      const textNode = element.querySelector("p")?.firstChild;
      if (!textNode) throw new Error("Expected paragraph text");
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.waitForTimeout(100);
  };
  const pointerClick = async (name: string) => {
    const box = await toolbar.getByRole("button", { name }).boundingBox();
    if (!box) throw new Error(`Toolbar button ${name} is not visible`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(120);
    await page.mouse.up();
  };
  const expectOutsideToolbar = async (surface: Locator) => {
    await expect.poll(() => surface.evaluate((element) =>
      element.closest(".preshot-tiptap-toolbar") === null,
    )).toBe(true);
  };

  await prepareSelection();
  await pointerClick("段落");
  const blockMenu = page.getByRole("menu");
  await expect(blockMenu).toBeVisible();
  await expectOutsideToolbar(blockMenu);

  await prepareSelection();
  await pointerClick("选择字号");
  const sizeMenu = page.getByRole("listbox", { name: "字号" });
  await expect(sizeMenu).toBeVisible();
  await expectOutsideToolbar(sizeMenu);

  await prepareSelection();
  await pointerClick("选择文字颜色");
  const colorMenu = page.getByRole("listbox", { name: "文字颜色" });
  await expect(colorMenu).toBeVisible();
  await expectOutsideToolbar(colorMenu);

  await prepareSelection();
  await pointerClick("添加链接");
  const linkSurface = page.locator('form[aria-label="添加链接"]');
  await expect(linkSurface).toBeVisible();
  await expectOutsideToolbar(linkSurface);
});

test("applies every direct text style and representative submenu commands", async ({ page }) => {
  await page.goto("/");
  const editor = page.locator(`${FRAME}[data-component-id="plan-1"] [contenteditable="true"]`).first();
  const toolbar = page.locator(`${FRAME}[data-component-id="plan-1"] [data-text-leaf-id]`).first().getByRole("toolbar");
  const selectParagraph = async () => {
    await editor.evaluate((element) => {
      element.focus();
      const textNode = element.querySelector("p")?.firstChild;
      if (!textNode) throw new Error("Expected paragraph text");
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.waitForTimeout(100);
  };
  const pointerClick = async (locator: Locator) => {
    await locator.hover();
    await page.mouse.down();
    await page.waitForTimeout(80);
    await page.mouse.up();
  };
  const formattingControl = async (name: string, exact = false) => {
    const direct = toolbar.getByRole("button", { name, exact });
    if (await direct.isVisible()) return direct;
    const moreSurface = page.getByRole("dialog", { name: "更多格式" });
    if (!await moreSurface.isVisible()) {
      await toolbar.getByRole("button", { name: "更多格式" }).dispatchEvent("pointerdown", {
        button: 0,
        isPrimary: true,
        pointerType: "mouse",
      });
      await expect(moreSurface).toBeVisible();
    }
    return moreSurface.getByRole("button", { name, exact });
  };

  await selectParagraph();
  for (const name of ["加粗", "斜体", "下划线", "删除线"]) {
    await pointerClick(await formattingControl(name));
  }
  await expect.poll(() => editor.innerHTML()).toContain("<strong>");
  await expect.poll(() => editor.innerHTML()).toContain("<em>");
  await expect.poll(() => editor.evaluate((element) => {
    const mark = element.querySelector("em");
    if (!mark) return null;
    const style = getComputedStyle(mark);
    return [style.fontStyle, style.getPropertyValue("font-synthesis-style")];
  })).toEqual(["italic", "auto"]);
  await expect.poll(() => editor.innerHTML()).toContain("<u>");
  await expect.poll(() => editor.innerHTML()).toContain("<s>");

  await selectParagraph();
  await pointerClick(toolbar.getByRole("button", { name: "选择文字颜色" }));
  await pointerClick(page.getByRole("option", { name: "功能青 #0891B2" }));
  await expect.poll(() => editor.innerHTML()).toMatch(/#0891B2|rgb\(8, 145, 178\)/i);

  await selectParagraph();
  await pointerClick(await formattingControl("居中"));
  await expect(await formattingControl("居中")).toHaveAttribute("aria-pressed", "true");

  await selectParagraph();
  await pointerClick(await formattingControl("嵌套", true));
  await expect(await formattingControl("取消嵌套", true)).toBeEnabled();
  await pointerClick(await formattingControl("取消嵌套", true));

  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await selectParagraph();
  await pointerClick(toolbar.getByRole("button", { name: "段落" }));
  await pointerClick(page.getByRole("menuitem", { name: "二级标题", exact: true }));
  await expect.poll(() => editor.locator("h2").count()).toBeGreaterThan(1);
  await expect.poll(() => editor.locator("h2").last().evaluate((heading) =>
    heading.querySelector<HTMLElement>('[style*="font-size"]')?.style.fontSize ?? null,
  )).toBeNull();

  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await selectParagraph();
  await pointerClick(toolbar.getByRole("button", { name: "添加链接" }));
  await page.locator('input[name="url"]').fill("example.com");
  await page.getByRole("button", { name: "应用", exact: true }).click();
  await expect.poll(() => editor.innerHTML()).toContain('href="https://example.com"');
});

test("preserves the selection when formatting a narrow split text leaf", async ({ page }) => {
  await page.goto("/");
  const planFrame = page.locator(`${FRAME}[data-component-id="plan-1"]`);
  const firstLeaf = planFrame.locator("[data-text-leaf-id]").first();
  await firstLeaf.hover();
  await firstLeaf.getByRole("button", { name: "左右拆分当前文案" }).click();
  await expect(planFrame.locator("[data-text-leaf-id]")).toHaveCount(2);

  const rightHandle = planFrame.locator('[data-resize-handle="right"]');
  const handleBox = await rightHandle.boundingBox();
  if (!handleBox) throw new Error("Plan resize handle is not visible");
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x - 1_000, handleBox.y + handleBox.height / 2, { steps: 8 });
  await page.mouse.up();

  const editor = firstLeaf.locator('[contenteditable="true"]');
  await editor.evaluate((element) => {
    element.focus();
    const textNode = element.querySelector("p")?.firstChild;
    if (!textNode) throw new Error("Expected paragraph text");
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });

  await firstLeaf.getByRole("toolbar").getByRole("button", { name: "加粗" }).click();
  await expect.poll(() => editor.innerHTML()).toContain("<strong>");
});

test("converts selected text through every heading level", async ({ page }) => {
  await page.goto("/");
  const planFrame = page.locator(`${FRAME}[data-component-id="plan-1"]`);
  const editor = planFrame.locator('[contenteditable="true"]').first();
  const toolbar = planFrame.locator("[data-text-leaf-id]").first().getByRole("toolbar");
  const labels = ["一级标题", "二级标题", "三级标题", "四级标题", "五级标题", "六级标题"];

  for (const [index, label] of labels.entries()) {
    await editor.evaluate((element) => {
      const block = Array.from(element.querySelectorAll("p,h1,h2,h3,h4,h5,h6"))
        .find((candidate) => candidate.textContent?.includes("海滨的黄金时刻"));
      const textNode = block?.firstChild;
      if (!textNode) throw new Error("Expected plan text block");
      element.focus();
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await toolbar.getByRole("button", { name: /段落|标题/ }).click();
    await page.getByRole("menuitem", { name: label, exact: true }).click();
    await expect(editor.locator(`h${index + 1}`).filter({ hasText: "海滨的黄金时刻" })).toHaveCount(1);
  }
});

test("drags to reorder images within a reference component and commits the move", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改");

  // Find a reference component that has images (the seeded plan has one)
  // Wait for at least one image to be visible
  const firstImage = page.getByRole("img", { name: "参考图" }).first();
  await expect(firstImage).toBeVisible();

  // Find the parent component frame that contains this image
  const referenceFrame = page.locator('[data-component-frame="true"]').filter({ has: firstImage }).first();
  await expect(referenceFrame).toBeVisible();

  // The seeded reference has 2 images (img-1, img-2), enough to reorder
  // Capture the order of image IDs before the drag
  const before = await referenceFrame.locator('[data-image-id]').evaluateAll(els =>
    els.map(e => e.getAttribute("data-image-id"))
  );

  // Need at least 2 images to drag-reorder
  if (before.length < 2) {
    throw new Error("Not enough images to test reorder");
  }

  // Drag the FIRST image tile over the SECOND to reorder. Use a manual stepped gesture
  // (not Playwright dragTo, which does a single move) so dnd-kit's PointerSensor activates,
  // exactly like the component-reorder test above.
  const firstTile = referenceFrame.locator('[data-image-id]').first();
  const secondTile = referenceFrame.locator('[data-image-id]').nth(1);

  // Scroll the tiles into the viewport — they sit below the fold, and pointer events at
  // off-screen coordinates would miss them (elementFromPoint returns null there).
  await firstTile.scrollIntoViewIfNeeded();

  const firstBox = await firstTile.boundingBox();
  const secondBox = await secondTile.boundingBox();

  if (!firstBox || !secondBox) throw new Error("Image tiles not visible");

  await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(200);
  await page.mouse.move(firstBox.x + firstBox.width / 2 + 12, firstBox.y + firstBox.height / 2, {
    steps: 3,
  });
  await page.mouse.move(secondBox.x + secondBox.width / 2, secondBox.y + secondBox.height / 2, {
    steps: 6,
  });
  await page.mouse.move(secondBox.x + secondBox.width / 2, secondBox.y + secondBox.height / 2, {
    steps: 3,
  });
  await page.mouse.up();

  // Wait for the optimistic commit and capture the order after drag
  let after: (string | null)[] = [];
  for (let i = 0; i < 12; i++) {
    after = await referenceFrame.locator('[data-image-id]').evaluateAll((els) =>
      els.map((e) => e.getAttribute("data-image-id")),
    );
    if (JSON.stringify(after) !== JSON.stringify(before)) {
      break;
    }
    await page.waitForTimeout(250);
  }

  // Assert the drag actually reordered images
  expect([...after].sort()).toEqual([...before].sort()); // Same set of images
  expect(after).not.toEqual(before); // Order changed
  expect(after.indexOf(before[0])).not.toBe(0); // The dragged first image moved off index 0

  // A committed move keeps the status unsaved
  await expect(page.getByTestId("save-status")).toHaveText("有未保存的更改");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("keeps removed image-caption and description-hide controls out of new reference components", async ({ page }) => {
  await page.goto("/");

  // Insert a reference component
  await page.getByRole("button", { name: "插入组件" }).click();
  await page.getByRole("menuitem", { name: "图片组" }).click();

  // Wait for the new reference component to be visible (inserted at top)
  const newReferenceFrame = page.locator(FRAME).first();
  await expect(newReferenceFrame).toBeVisible();

  // Add an image to the new reference component
  // The in-memory adapter allows adding by just clicking the add button
  const addButton = newReferenceFrame.getByRole("button", { name: "添加参考图" }).first();
  await expect(addButton).toBeVisible();
  await addButton.click();

  // Wait for the image to be visible - use .first() since there may be other reference components
  await expect(newReferenceFrame.getByRole("img", { name: "参考图" }).first()).toBeVisible();

  const imageTile = newReferenceFrame.locator("[data-image-id]").first();
  await imageTile.hover();
  await expect(newReferenceFrame.getByRole("checkbox", { name: "隐藏" })).toHaveCount(0);
  await expect(newReferenceFrame.getByRole("textbox", { name: "图片说明 1" })).toHaveCount(0);
  await expect(imageTile.locator('[data-image-resize-handle="right"]')).toBeVisible();
});

test("exports the canvas to PDF without legacy image-caption controls", async ({ page }) => {
  await page.goto("/");
  await waitForReferenceImages(page);

  const referenceFrame = page.locator(`${FRAME}[data-component-id="ref-1"]`);
  const imageTile = referenceFrame.locator("[data-image-id]").first();
  await imageTile.hover();
  await expect(referenceFrame.getByRole("textbox", { name: "图片说明 1" })).toHaveCount(0);

  // Export to PDF
  await page.getByRole("button", { name: "导出 PDF" }).click();

  // Assert the button shows exporting state
  await expect(page.getByRole("button", { name: "正在导出…" })).toBeVisible();

  // Assert the button returns to normal state
  await expect(page.getByRole("button", { name: "导出 PDF" })).toBeVisible({ timeout: 30000 });

  // No error alerts
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("drags the right edge to resize component width", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改", {
    timeout: 10_000,
  });

  const frames = page.locator(FRAME);
  const firstFrame = frames.nth(0);

  await firstFrame.scrollIntoViewIfNeeded();

  // Get the initial width
  const initialBox = await firstFrame.boundingBox();
  if (!initialBox) throw new Error("component not visible");
  const initialWidth = initialBox.width;

  // Find the right edge resize handle
  const rightHandle = firstFrame.locator('[data-resize-handle="right"]');
  const handleBox = await rightHandle.boundingBox();
  if (!handleBox) throw new Error("right handle not visible");

  // Drag the handle to the left (shrink width) with manual stepped gesture
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x - 100, handleBox.y + handleBox.height / 2, { steps: 8 });
  await page.mouse.up();

  // Wait a moment for the optimistic commit
  await page.waitForTimeout(200);

  // Assert the width changed
  const newBox = await firstFrame.boundingBox();
  if (!newBox) throw new Error("component not visible after resize");
  expect(newBox.width).toBeLessThan(initialWidth - 50);

  // Assert save status changed to unsaved
  await expect(page.getByTestId("save-status")).toHaveText("有未保存的更改");
});

test("inserts component at top of canvas", async ({ page }) => {
  await page.goto("/");

  // Capture the first component ID before insert
  const initialFirst = await page.locator(FRAME).nth(0).getAttribute("data-component-id");

  // Insert a new plan component
  await page.getByRole("button", { name: "插入组件" }).click();
  await page.getByRole("menuitem", { name: "文案" }).click();

  // Wait for the new component to be added
  await page.waitForTimeout(300);

  // Capture the new first component ID
  const newFirst = await page.locator(FRAME).nth(0).getAttribute("data-component-id");

  // Assert a different component is now first
  expect(newFirst).not.toBe(initialFirst);

  // Assert the old first component is now at index 1
  const secondId = await page.locator(FRAME).nth(1).getAttribute("data-component-id");
  expect(secondId).toBe(initialFirst);
});

test("shows delete confirmation dialog and deletes component on confirm", async ({ page }) => {
  await page.goto("/");
  // Wait for the seeded components to render and settle before counting.
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改");
  await expect(page.locator(FRAME).first()).toBeVisible();

  // Count initial components
  const initialCount = await page.locator(FRAME).count();

  // Get the first component's delete button (the × button in the top bar)
  const firstFrame = page.locator(FRAME).nth(0);
  await firstFrame.scrollIntoViewIfNeeded();
  // Target the actual button element with the red background, not the draggable top bar
  const deleteButton = firstFrame.locator('button[aria-label="移除组件"]');

  // Click delete
  await deleteButton.click();

  // Assert the confirmation dialog appears
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("确定删除该组件？");

  // Wait a moment to ensure any deletion is prevented
  await page.waitForTimeout(200);

  // Assert component count is unchanged
  await expect(page.locator(FRAME)).toHaveCount(initialCount);

  // Click cancel
  await dialog.getByRole("button", { name: "取消" }).click();

  // Assert dialog closed and count still unchanged
  await expect(dialog).toBeHidden();
  await expect(page.locator(FRAME)).toHaveCount(initialCount);

  // Click delete again
  await deleteButton.click();
  await expect(dialog).toBeVisible();

  // Click confirm delete
  await dialog.getByRole("button", { name: "删除" }).click();

  // Assert component count decreased
  await expect(page.locator(FRAME)).toHaveCount(initialCount - 1);
  await expect(dialog).toBeHidden();
});

test("uses per-image edge handles alongside the group image-height stepper", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改");

  // Find a reference component (the seeded canvas has one)
  const firstImage = page.getByRole("img", { name: "参考图" }).first();
  await expect(firstImage).toBeVisible();

  const referenceFrame = page.locator('[data-component-frame="true"]').filter({ has: firstImage }).first();
  await referenceFrame.scrollIntoViewIfNeeded();

  const imageTile = referenceFrame.locator('[data-image-id]').first();
  await imageTile.hover();
  await expect(imageTile.locator('[data-image-resize-handle="left"]')).toBeVisible();
  await expect(imageTile.locator('[data-image-resize-handle="right"]')).toBeVisible();
  await expect(imageTile.locator('[data-image-resize-handle="top"]')).toBeVisible();
  await expect(imageTile.locator('[data-image-resize-handle="bottom"]')).toBeVisible();
  await expect(referenceFrame.getByRole("button", { name: "减小整体图片高度" })).toBeVisible();
  await expect(referenceFrame.getByRole("button", { name: "增大整体图片高度" })).toBeVisible();
  await expect(referenceFrame.getByRole("slider")).toHaveCount(0);
});

test("exports PDF and operation completes successfully", async ({ page }) => {
  await page.goto("/");
  await waitForReferenceImages(page);

  // Click export PDF button
  await page.getByRole("button", { name: "导出 PDF" }).click();

  // Assert the button shows exporting state
  await expect(page.getByRole("button", { name: "正在导出…" })).toBeVisible();

  // Assert the button returns to normal state (export completed)
  await expect(page.getByRole("button", { name: "导出 PDF" })).toBeVisible({ timeout: 30000 });

  // No error alerts
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("persists an edited canvas title without text leaf title controls", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改");

  const title = page.getByRole("textbox", { name: "画布标题" });
  const planFrame = page.locator(`${FRAME}[data-component-id="plan-1"]`);

  await title.fill("海滨肖像拍摄");
  await title.press("Enter");
  await expect(planFrame.getByRole("button", { name: "+ 插入标题" })).toHaveCount(0);
  await expect(planFrame.getByRole("textbox", { name: "子文案标题" })).toHaveCount(0);

  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改", { timeout: 10_000 });
  await page.reload();

  await expect(page.getByRole("textbox", { name: "画布标题" })).toHaveValue("海滨肖像拍摄");
  await expect(
    page.locator(`${FRAME}[data-component-id="plan-1"]`).getByRole("textbox", { name: "子文案标题" }),
  ).toHaveCount(0);
});

test("resizes and restores a tile while the lightbox keeps the full source image", async ({ page }) => {
  await page.goto("/");
  await waitForReferenceImages(page);
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改", {
    timeout: 10_000,
  });

  const tile = page.locator('[data-image-id="img-1"]');
  const followingTile = page.locator('[data-image-id="img-2"]');
  const tileImage = tile.getByRole("img", { name: "参考图" });
  const initialBox = await tile.boundingBox();
  const followingInitialBox = await followingTile.boundingBox();
  const fullSource = await tileImage.getAttribute("src");
  if (!initialBox || !followingInitialBox || !fullSource) {
    throw new Error("seeded image tile is not ready");
  }

  await tile.hover();
  const resizeHandle = tile.locator('[data-image-resize-handle="right"]');
  const resizeHandleBox = await resizeHandle.boundingBox();
  if (!resizeHandleBox) {
    throw new Error("image resize handle is not visible");
  }
  await page.mouse.move(resizeHandleBox.x + resizeHandleBox.width / 2, resizeHandleBox.y + resizeHandleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizeHandleBox.x - initialBox.width * 0.2, resizeHandleBox.y + resizeHandleBox.height / 2, {
    steps: 6,
  });

  await expect
    .poll(async () => (await followingTile.boundingBox())?.x ?? 0)
    .toBeLessThan(followingInitialBox.x);
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改");

  await page.mouse.up();

  await expect
    .poll(async () => (await tile.boundingBox())?.width ?? 0)
    .not.toBe(initialBox.width);
  const croppedBox = await tile.boundingBox();
  if (!croppedBox) {
    throw new Error("cropped tile is not visible");
  }

  await resizeHandle.evaluate((element) => (element as HTMLElement).blur());
  await page.mouse.move(0, 0);
  const openImage = tile.getByRole("button", { name: "选择参考图 1" });
  await openImage.dblclick();
  const lightbox = page.getByRole("dialog");
  await expect(lightbox).toBeVisible();
  await expect(lightbox.getByRole("img", { name: "参考图" })).toHaveAttribute("src", fullSource);
  await lightbox.getByRole("button", { name: "关闭图片" }).click();
  await expect(lightbox).toBeHidden();

  const resetSize = tile.getByRole("button", { name: "恢复默认图片尺寸" });
  await resetSize.focus();
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await tile.boundingBox())?.width ?? 0)
    .toBeGreaterThan(croppedBox.width);
});

test("steps a whole reference group by 4pt and persists the compact card", async ({ page }) => {
  await page.goto("/");
  await waitForReferenceImages(page);
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改", {
    timeout: 10_000,
  });

  const reference = page.locator(`${FRAME}[data-component-id="ref-1"]`);
  const decrease = reference.getByRole("button", { name: "减小整体图片高度" });
  const before = await reference.boundingBox();
  if (!before) {
    throw new Error("reference component is not visible");
  }

  const pixelInput = reference.getByRole("spinbutton", { name: "整体图片高度（像素）" });
  await expect(pixelInput).toHaveValue("181");
  await decrease.click();
  await expect(pixelInput).toHaveValue("176");
  await expect(reference.getByRole("slider")).toHaveCount(0);
  await expect.poll(async () => (await reference.boundingBox())?.height ?? 0).toBeLessThan(before.height);
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改", {
    timeout: 10_000,
  });

  await page.reload();
  await expect(reference.getByRole("spinbutton", { name: "整体图片高度（像素）" })).toHaveValue("176");
  await expect.poll(async () => (await reference.boundingBox())?.height ?? 0).toBeLessThan(before.height);
});

test("persists a committed image display size after reload", async ({ page }) => {
  await page.goto("/");
  await waitForReferenceImages(page);

  const tile = page.locator('[data-image-id="img-1"]');
  const initialBox = await tile.boundingBox();
  if (!initialBox) {
    throw new Error("seeded image tile is not ready");
  }
  await tile.hover();
  const resizeHandle = tile.locator('[data-image-resize-handle="right"]');
  const handleBox = await resizeHandle.boundingBox();
  if (!handleBox) {
    throw new Error("crop handle is not visible");
  }

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x - initialBox.width * 0.25, handleBox.y + handleBox.height / 2, {
    steps: 6,
  });
  await page.mouse.up();

  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改", { timeout: 10_000 });
  await page.reload();
  const resizedTile = page.locator('[data-image-id="img-1"]');
  await resizedTile.hover();
  await expect(resizedTile.getByRole("button", { name: "恢复默认图片尺寸" })).toBeVisible();
});

test("imports a Windows capture through the screenshot button", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("plan-canvas")).toBeVisible();
  const before = await page.locator("[data-image-id]").count();

  await page.getByRole("button", { name: "截图" }).first().click();

  await expect(page.locator("[data-image-id]")).toHaveCount(before + 1);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("keeps the group description visible without a hide toggle and exports successfully", async ({ page }) => {
  await page.goto("/");
  await waitForReferenceImages(page);

  const referenceFrame = page.locator(`${FRAME}[data-component-id="ref-1"]`);
  await expect(referenceFrame.getByRole("checkbox", { name: "隐藏" })).toHaveCount(0);
  await expect(referenceFrame.getByRole("group", { name: "分组描述" })).toBeVisible();

  const insertButton = page.getByRole("button", { name: "插入组件" });
  const exportButton = page.getByRole("button", { name: "导出 PDF" });
  const insertBox = await insertButton.boundingBox();
  const exportBox = await exportButton.boundingBox();
  if (!insertBox || !exportBox) {
    throw new Error("canvas toolbar actions are not visible");
  }
  expect(exportBox.x).toBeGreaterThan(insertBox.x);

  await exportButton.click();
  await expect(page.getByRole("button", { name: "正在导出…" })).toBeVisible();
  await expect(page.getByRole("button", { name: "导出 PDF" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
});
