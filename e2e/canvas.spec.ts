import { expect, test, type Page } from "@playwright/test";

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

async function shrinkFrame(page: Page, frame: ReturnType<Page["locator"]>) {
  const before = await frame.boundingBox();
  const handle = frame.locator('[data-resize-handle="right"]');
  const handleBox = await handle.boundingBox();
  if (!before || !handleBox) {
    throw new Error("component resize targets are not visible");
  }

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x - before.width * 0.7, handleBox.y + handleBox.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect
    .poll(async () => (await frame.boundingBox())?.width ?? 0)
    .toBeLessThan(before.width);
}

async function dragComponentAcrossTarget(
  page: Page,
  source: ReturnType<Page["locator"]>,
  target: ReturnType<Page["locator"]>,
  targetX: "before" | "after",
) {
  const handle = source.getByRole("button", { name: "拖动以移动或交换位置", exact: true });
  const handleBox = await handle.boundingBox();
  const nameBox = await source.getByRole("textbox", { name: "组件名称" }).boundingBox();
  const removeBox = await source.getByRole("button", { name: "移除组件" }).boundingBox();
  const targetBox = await target.boundingBox();
  if (!handleBox || !nameBox || !removeBox || !targetBox) {
    throw new Error("component drag targets are not visible");
  }

  const dragStartX = (nameBox.x + nameBox.width + removeBox.x) / 2;
  const dragStartY = handleBox.y + handleBox.height / 2;
  await page.mouse.move(dragStartX, dragStartY);
  await page.mouse.down();
  await page.waitForTimeout(200);
  await page.mouse.move(dragStartX + 12, dragStartY, { steps: 3 });
  await expect(page.locator('[data-drag-placeholder="component"]').first()).toBeVisible();
  await page.mouse.move(
    targetX === "before" ? targetBox.x + 1 : targetBox.x + targetBox.width - 1,
    targetBox.y + targetBox.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
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

test("uses flat component order for drag reordering", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.goto("/");
  await waitForReferenceImages(page);

  const planFrame = page.locator(`${FRAME}[data-component-id="plan-1"]`);
  const referenceFrame = page.locator(`${FRAME}[data-fragment-id="ref-1::0"]`);
  await shrinkFrame(page, planFrame);
  await shrinkFrame(page, referenceFrame);
  await dragComponentAcrossTarget(page, referenceFrame, planFrame, "before");
  await expect.poll(() => componentOrder(page)).toEqual(["ref-1", "plan-1"]);
});

test("does not render logical row drop targets", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId(/row-drop-zone:/)).toHaveCount(0);
});

test("reorders a component even when both components are full width", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改");

  const planFrame = page.locator(`${FRAME}[data-component-id="plan-1"]`);
  const referenceFrame = page.locator(`${FRAME}[data-fragment-id="ref-1::0"]`);
  await dragComponentAcrossTarget(page, planFrame, referenceFrame, "after");

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

test("edits an independent image caption on hover in a new reference component", async ({ page }) => {
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

  const hideDescription = newReferenceFrame.getByRole("checkbox", { name: "隐藏" });
  await expect(hideDescription).not.toBeChecked();
  await expect(newReferenceFrame.getByText("参考图说明")).toBeVisible();

  const imageTile = newReferenceFrame.locator("[data-image-id]").first();
  await imageTile.hover();
  const captionTextarea = newReferenceFrame.getByRole("textbox", { name: "图片说明 1" });
  await expect(captionTextarea).toBeVisible();

  // Type into the caption textarea
  await captionTextarea.fill("测试说明文本");

  // Assert the value updates
  await expect(captionTextarea).toHaveValue("测试说明文本");

  // Assert save status becomes unsaved
  await expect(page.getByTestId("save-status")).toHaveText("有未保存的更改");
});

test("exports the canvas to PDF with an independent image caption", async ({ page }) => {
  await page.goto("/");
  await waitForReferenceImages(page);

  const referenceFrame = page.locator(`${FRAME}[data-component-id="ref-1"]`);
  const imageTile = referenceFrame.locator("[data-image-id]").first();
  await imageTile.hover();
  await referenceFrame.getByRole("textbox", { name: "图片说明 1" }).fill("PDF 独立说明");

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
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改");

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

test("adjusts reference component image height with stepper", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改");

  // Find a reference component (the seeded canvas has one)
  const firstImage = page.getByRole("img", { name: "参考图" }).first();
  await expect(firstImage).toBeVisible();

  const referenceFrame = page.locator('[data-component-frame="true"]').filter({ has: firstImage }).first();
  await referenceFrame.scrollIntoViewIfNeeded();

  // Get a reference image tile's initial height
  const imageTile = referenceFrame.locator('[data-image-id]').first();
  const initialBox = await imageTile.boundingBox();
  if (!initialBox) throw new Error("image tile not visible");
  const initialHeight = initialBox.height;

  // Find the image height stepper buttons
  // The increment button should have "+" text or aria-label
  const incrementButton = referenceFrame.getByRole("button", { name: /增加|increment/i });

  // If not found, try finding by text content
  const stepperButtons = await referenceFrame.getByRole("button").all();
  let foundIncrement = false;
  for (const btn of stepperButtons) {
    const text = await btn.textContent();
    if (text?.includes("+")) {
      await btn.click();
      foundIncrement = true;
      break;
    }
  }

  if (!foundIncrement && await incrementButton.count() > 0) {
    await incrementButton.click();
  } else if (!foundIncrement) {
    // Fallback: look for any button near the reference frame that might be the stepper
    throw new Error("Could not find image height increment button");
  }

  // Wait for the change to apply
  await page.waitForTimeout(300);

  // Assert the image tile height changed
  const newBox = await imageTile.boundingBox();
  if (!newBox) throw new Error("image tile not visible after adjustment");
  expect(newBox.height).not.toBe(initialHeight);

  // Assert save status changed to unsaved
  await expect(page.getByTestId("save-status")).toHaveText("有未保存的更改");
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

test("persists an edited canvas title and component name after reload", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改");

  const title = page.getByRole("textbox", { name: "画布标题" });
  const planName = page
    .locator(`${FRAME}[data-component-id="plan-1"]`)
    .getByRole("textbox", { name: "组件名称" });

  await title.fill("海滨肖像拍摄");
  await title.press("Enter");
  await planName.fill("拍摄文案");
  await planName.press("Enter");

  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改", { timeout: 10_000 });
  await page.reload();

  await expect(page.getByRole("textbox", { name: "画布标题" })).toHaveValue("海滨肖像拍摄");
  await expect(
    page.locator(`${FRAME}[data-component-id="plan-1"]`).getByRole("textbox", { name: "组件名称" }),
  ).toHaveValue("拍摄文案");
});

test("resizes and restores a tile while the lightbox keeps the full source image", async ({ page }) => {
  await page.goto("/");
  await waitForReferenceImages(page);

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

test("hides the group description from the canvas and still exports successfully", async ({ page }) => {
  await page.goto("/");
  await waitForReferenceImages(page);

  const referenceFrame = page.locator(`${FRAME}[data-component-id="ref-1"]`);
  const hideDescription = referenceFrame.getByRole("checkbox", { name: "隐藏" });
  await hideDescription.check();
  await expect(referenceFrame.getByRole("group", { name: "分组描述" })).toHaveCount(0);

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
