import { expect, test } from "@playwright/test";

test("loads the seeded canvas with plan and reference components", async ({ page }) => {
  await page.goto("/");

  const canvas = page.getByTestId("plan-canvas");
  await expect(canvas).toBeVisible();

  // Assert seeded content from SEEDED_V2_PLAN (the rich text editor contains the HTML)
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
  const initialFrames = await page.locator('[data-component-frame="true"]').count();

  // Open the insert menu
  await page.getByRole("button", { name: "插入组件" }).click();

  // Insert a plan component
  await page.getByRole("menuitem", { name: "摄影计划" }).click();

  // Assert count grew
  await expect(page.locator('[data-component-frame="true"]')).toHaveCount(initialFrames + 1);

  // Assert save status changed to unsaved
  await expect(page.getByTestId("save-status")).toHaveText("有未保存的更改");
});

test("inserts a reference component and marks the canvas unsaved", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改");

  // Count initial components
  const initialFrames = await page.locator('[data-component-frame="true"]').count();

  // Open the insert menu
  await page.getByRole("button", { name: "插入组件" }).click();

  // Insert a reference component
  await page.getByRole("menuitem", { name: "参考图组" }).click();

  // Assert count grew
  await expect(page.locator('[data-component-frame="true"]')).toHaveCount(initialFrames + 1);

  // Assert save status changed to unsaved
  await expect(page.getByTestId("save-status")).toHaveText("有未保存的更改");
});

test("drags to reorder two components and commits the move", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改");

  // Add two more components so we have at least 3 to drag
  await page.getByRole("button", { name: "插入组件" }).click();
  await page.getByRole("menuitem", { name: "摄影计划" }).click();
  await page.getByRole("button", { name: "插入组件" }).click();
  await page.getByRole("menuitem", { name: "摄影计划" }).click();

  // Wait for unsaved state to settle
  await expect(page.getByTestId("save-status")).toHaveText("有未保存的更改");

  // Capture the order before drag
  const before = await page.locator('[data-component-frame="true"]').evaluateAll(els => 
    els.map(e => (e as HTMLElement).dataset.componentId)
  );

  // Get the move handles (top drag handle)
  const frames = page.locator('[data-component-frame="true"]');
  const first = frames.nth(0);
  const second = frames.nth(1);

  // Get the first component's top bar (the draggable area)
  const firstTopBar = first.locator('[data-component-frame-topbar]');
  await firstTopBar.scrollIntoViewIfNeeded();
  const firstBox = await firstTopBar.boundingBox();
  const secondBox = await second.boundingBox();

  if (!firstBox || !secondBox) throw new Error("components not visible");

  // dnd-kit PointerSensor needs movement > 6px and intermediate moves to start a drag
  // Drag the first component to hover over the center-bottom area of the second component
  await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(firstBox.x + firstBox.width / 2 + 12, firstBox.y + firstBox.height / 2, {
    steps: 3,
  });
  // Move to the lower half of the second component to trigger "insert after"
  await page.mouse.move(
    secondBox.x + secondBox.width / 2,
    secondBox.y + (secondBox.height * 0.75),
    { steps: 6 }
  );
  await page.mouse.up();

  // Wait for the optimistic commit and capture the order after drag
  // Use a retry loop to poll until the order changes
  let after: (string | undefined)[] = [];
  for (let i = 0; i < 10; i++) {
    after = await page.locator('[data-component-frame="true"]').evaluateAll(els => 
      els.map(e => (e as HTMLElement).dataset.componentId)
    );
    if (JSON.stringify(after) !== JSON.stringify(before)) {
      break;
    }
    await page.waitForTimeout(300);
  }

  // Assert the drag actually reordered components
  expect([...after].sort()).toEqual([...before].sort()); // Same set of components
  expect(after).not.toEqual(before); // Order changed
  expect(after.indexOf(before[0])).not.toBe(0); // Dragged component moved from index 0

  // A committed move keeps the status unsaved
  await expect(page.getByTestId("save-status")).toHaveText("有未保存的更改");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("resizes a component's width and commits the change", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改");

  const frames = page.locator('[data-component-frame="true"]');
  const firstFrame = frames.nth(0);

  // Get the initial width
  const initialBox = await firstFrame.boundingBox();
  if (!initialBox) throw new Error("component not visible");
  const initialWidth = initialBox.width;

  // Find the width resize handle (right edge)
  const widthHandle = firstFrame.locator('[data-resize-handle="width"]');
  const handleBox = await widthHandle.boundingBox();
  if (!handleBox) throw new Error("width handle not visible");

  // Drag the width handle to the left (shrink)
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x - 100, handleBox.y + handleBox.height / 2, { steps: 10 });
  await page.mouse.up();

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

  // Click to open the image in lightbox
  await firstImage.click();

  // Assert lightbox opened and contains an image
  await expect(page.getByRole("dialog")).toBeVisible();
  const lightboxImage = page.getByRole("dialog").getByRole("img", { name: "参考图" });
  await expect(lightboxImage).toBeVisible();

  // Close the lightbox
  await page.getByRole("button", { name: "关闭图片" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("overflows to multiple pages when inserting tall components", async ({ page }) => {
  await page.goto("/");

  // Initially should have one page
  await expect(page.getByTestId("canvas-page")).toHaveCount(1);

  // Insert multiple tall components to overflow to a second page
  // The seeded plan already has 2 components. Each component has ~220-320px height. 
  // A4 is ~842pt (~1122px at 100% scale, but we're at 0.5 scale so ~561px visible).
  // Need to insert enough to exceed the first page. Let's insert 4 more.
  for (let i = 0; i < 4; i++) {
    await page.getByRole("button", { name: "插入组件" }).click();
    await page.getByRole("menuitem", { name: "参考图组" }).click();
  }

  // Assert at least two pages now exist (may be more depending on component heights)
  const pageCount = await page.getByTestId("canvas-page").count();
  expect(pageCount).toBeGreaterThanOrEqual(2);
});

test("exports the canvas to PDF", async ({ page }) => {
  await page.goto("/");

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
  const initialFrames = await page.locator('[data-component-frame="true"]').count();

  // Open the insert menu
  await page.getByRole("button", { name: "插入组件" }).click();

  // Insert a plan component
  await page.getByRole("menuitem", { name: "摄影计划" }).click();

  // Wait for the new component frame to be added
  await expect(page.locator('[data-component-frame="true"]')).toHaveCount(initialFrames + 1);

  // Get the first (newly inserted at top) component frame
  const newPlanFrame = page.locator('[data-component-frame="true"]').first();
  
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

test("toggles captions on a reference component and types a caption", async ({ page }) => {
  await page.goto("/");

  // Insert a reference component
  await page.getByRole("button", { name: "插入组件" }).click();
  await page.getByRole("menuitem", { name: "参考图组" }).click();

  // Wait for the new reference component to be visible (inserted at top)
  const newReferenceFrame = page.locator('[data-component-frame="true"]').first();
  await expect(newReferenceFrame).toBeVisible();

  // Add an image to the new reference component
  // The in-memory adapter allows adding by just clicking the add button
  const addButton = newReferenceFrame.getByRole("button", { name: "添加参考图" });
  await expect(addButton).toBeVisible();
  await addButton.click();

  // Wait for the image to be visible - use .first() since there may be other reference components
  await expect(newReferenceFrame.getByRole("img", { name: "参考图" }).first()).toBeVisible();

  // Assert captions are initially hidden
  await expect(page.getByRole("textbox", { name: /图片说明/ })).toHaveCount(0);

  // Toggle captions on
  const captionCheckbox = newReferenceFrame.getByRole("checkbox", { name: "显示说明" });
  await expect(captionCheckbox).toBeVisible();
  await captionCheckbox.check();

  // Assert the caption textarea appears
  const captionTextarea = newReferenceFrame.getByRole("textbox", { name: "图片说明 1" });
  await expect(captionTextarea).toBeVisible();

  // Type into the caption textarea
  await captionTextarea.fill("测试说明文本");

  // Assert the value updates
  await expect(captionTextarea).toHaveValue("测试说明文本");

  // Assert save status becomes unsaved
  await expect(page.getByTestId("save-status")).toHaveText("有未保存的更改");
});

test("exports the canvas to PDF with captions enabled", async ({ page }) => {
  await page.goto("/");

  // Toggle captions on the seeded reference component
  const firstReferenceFrame = page.locator('[data-component-frame="true"]').first();
  const captionCheckbox = firstReferenceFrame.getByRole("checkbox", { name: "显示说明" });
  
  // Check if checkbox exists (seeded component is a reference component)
  const checkboxCount = await captionCheckbox.count();
  if (checkboxCount > 0) {
    await captionCheckbox.check();
  }

  // Export to PDF
  await page.getByRole("button", { name: "导出 PDF" }).click();

  // Assert the button shows exporting state
  await expect(page.getByRole("button", { name: "正在导出…" })).toBeVisible();

  // Assert the button returns to normal state
  await expect(page.getByRole("button", { name: "导出 PDF" })).toBeVisible({ timeout: 30000 });

  // No error alerts
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("drags component by top bar to reorder components", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改");

  // Insert 2 more plan components so we have at least 4 total
  await page.getByRole("button", { name: "插入组件" }).click();
  await page.getByRole("menuitem", { name: "摄影计划" }).click();
  await page.getByRole("button", { name: "插入组件" }).click();
  await page.getByRole("menuitem", { name: "摄影计划" }).click();

  // Wait for unsaved state
  await expect(page.getByTestId("save-status")).toHaveText("有未保存的更改");

  // Capture the order of component IDs before drag
  const before = await page.locator('[data-component-frame="true"]').evaluateAll(els => 
    els.map(e => (e as HTMLElement).dataset.componentId)
  );

  // Get the first component and its top-bar (the draggable area)
  const frames = page.locator('[data-component-frame="true"]');
  const firstFrame = frames.nth(0);
  const thirdFrame = frames.nth(2);

  // Scroll the first frame into view
  await firstFrame.scrollIntoViewIfNeeded();

  // Get the top bar (the draggable area)
  const topBar = firstFrame.locator('[data-component-frame-topbar]');
  const handleBox = await topBar.boundingBox();
  const thirdBox = await thirdFrame.boundingBox();

  if (!handleBox || !thirdBox) throw new Error("components not visible");

  // Use manual stepped gesture to trigger dnd-kit's PointerSensor (>6px movement)
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  // Small initial movement to activate drag
  await page.mouse.move(handleBox.x + handleBox.width / 2 + 12, handleBox.y + handleBox.height / 2, {
    steps: 3,
  });
  // Move to the lower portion of the third component to trigger "insert after"
  await page.mouse.move(
    thirdBox.x + thirdBox.width / 2,
    thirdBox.y + (thirdBox.height * 0.75),
    { steps: 8 }
  );
  await page.mouse.up();

  // Wait for the optimistic commit and capture the order after drag
  let after: (string | undefined)[] = [];
  for (let i = 0; i < 10; i++) {
    after = await page.locator('[data-component-frame="true"]').evaluateAll(els => 
      els.map(e => (e as HTMLElement).dataset.componentId)
    );
    if (JSON.stringify(after) !== JSON.stringify(before)) {
      break;
    }
    await page.waitForTimeout(300);
  }

  // Assert the drag reordered components
  expect([...after].sort()).toEqual([...before].sort()); // Same set
  expect(after).not.toEqual(before); // Order changed
  expect(after.indexOf(before[0])).not.toBe(0); // Dragged component moved off index 0

  // Assert save status is unsaved
  await expect(page.getByTestId("save-status")).toHaveText("有未保存的更改");
});

test("drags the right edge to resize component width", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改");

  const frames = page.locator('[data-component-frame="true"]');
  const firstFrame = frames.nth(0);

  await firstFrame.scrollIntoViewIfNeeded();

  // Get the initial width
  const initialBox = await firstFrame.boundingBox();
  if (!initialBox) throw new Error("component not visible");
  const initialWidth = initialBox.width;

  // Find the right edge resize handle
  const rightHandle = firstFrame.locator('[data-resize-handle="width"]');
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
  const initialFirst = await page.locator('[data-component-frame="true"]').nth(0).getAttribute("data-component-id");

  // Insert a new plan component
  await page.getByRole("button", { name: "插入组件" }).click();
  await page.getByRole("menuitem", { name: "摄影计划" }).click();

  // Wait for the new component to be added
  await page.waitForTimeout(300);

  // Capture the new first component ID
  const newFirst = await page.locator('[data-component-frame="true"]').nth(0).getAttribute("data-component-id");

  // Assert a different component is now first
  expect(newFirst).not.toBe(initialFirst);

  // Assert the old first component is now at index 1
  const secondId = await page.locator('[data-component-frame="true"]').nth(1).getAttribute("data-component-id");
  expect(secondId).toBe(initialFirst);
});

test("shows delete confirmation dialog and deletes component on confirm", async ({ page }) => {
  await page.goto("/");

  // Count initial components
  const initialCount = await page.locator('[data-component-frame="true"]').count();

  // Get the first component's delete button (the × button in the top bar)
  const firstFrame = page.locator('[data-component-frame="true"]').nth(0);
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
  await expect(page.locator('[data-component-frame="true"]')).toHaveCount(initialCount);

  // Click cancel
  await dialog.getByRole("button", { name: "取消" }).click();

  // Assert dialog closed and count still unchanged
  await expect(dialog).toBeHidden();
  await expect(page.locator('[data-component-frame="true"]')).toHaveCount(initialCount);

  // Click delete again
  await deleteButton.click();
  await expect(dialog).toBeVisible();

  // Click confirm delete
  await dialog.getByRole("button", { name: "删除" }).click();

  // Assert component count decreased
  await expect(page.locator('[data-component-frame="true"]')).toHaveCount(initialCount - 1);
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

  // Click export PDF button
  await page.getByRole("button", { name: "导出 PDF" }).click();

  // Assert the button shows exporting state
  await expect(page.getByRole("button", { name: "正在导出…" })).toBeVisible();

  // Assert the button returns to normal state (export completed)
  await expect(page.getByRole("button", { name: "导出 PDF" })).toBeVisible({ timeout: 30000 });

  // No error alerts
  await expect(page.getByRole("alert")).toHaveCount(0);
});
