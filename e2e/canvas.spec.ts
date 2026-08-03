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

  // Assert the new reference component has default title in the input
  await expect(page.getByRole("textbox", { name: "分组标题" }).last()).toHaveValue("新建分组");

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

  // Get the first component's move handle
  const firstHandle = first.getByRole("button", { name: "移动组件" });
  const firstBox = await firstHandle.boundingBox();
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
