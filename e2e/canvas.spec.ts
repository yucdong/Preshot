import { expect, test, type Locator, type Page } from "@playwright/test";

const FRAME = '[data-component-frame="true"]';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.sessionStorage.clear());
});

async function openCanvas(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("plan-canvas")).toBeVisible();
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改");
}

async function resizeWidth(page: Page, frame: Locator) {
  await frame.scrollIntoViewIfNeeded();
  const before = await frame.boundingBox();
  const handle = frame.locator('[data-resize="right"]');
  const handleBox = await handle.boundingBox();
  if (!before || !handleBox) {
    throw new Error("component resize targets are not visible");
  }

  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - before.width * 0.62, startY, { steps: 8 });
  await page.mouse.up();

  await expect
    .poll(async () => (await frame.boundingBox())?.width ?? 0)
    .toBeLessThan(before.width * 0.5);
}

test("loads the schema v6 browser seed with a visible reference description", async ({ page }) => {
  await openCanvas(page);

  await expect(page.locator(FRAME)).toHaveCount(2);
  const reference = page.locator(`${FRAME}[data-component-id="ref-1"]`);
  await expect(reference.getByRole("group", { name: "分组描述" })).toBeVisible();
  await expect(reference.getByRole("img", { name: "参考图" })).toHaveCount(4);
});

test("automatically packs components into one row after both widths shrink", async ({ page }) => {
  await openCanvas(page);

  const plan = page.locator(`${FRAME}[data-component-id="plan-1"]`);
  const reference = page.locator(`${FRAME}[data-component-id="ref-1"]`);
  await resizeWidth(page, plan);
  await resizeWidth(page, reference);

  const planBox = await plan.boundingBox();
  const referenceBox = await reference.boundingBox();
  if (!planBox || !referenceBox) {
    throw new Error("resized components are not visible");
  }

  expect(referenceBox.x).toBeGreaterThan(planBox.x);
  expect(referenceBox.y).toBeCloseTo(planBox.y, 1);
  await expect(page.getByTestId("save-status")).toHaveText("有未保存的更改");
});

test("places export after the insert action in the toolbar", async ({ page }) => {
  await openCanvas(page);

  const insertButton = page.getByRole("button", { name: "插入组件" });
  const exportButton = page.getByRole("button", { name: "导出 PDF" });
  const insertBox = await insertButton.boundingBox();
  const exportBox = await exportButton.boundingBox();
  if (!insertBox || !exportBox) {
    throw new Error("canvas toolbar actions are not visible");
  }

  expect(exportBox.x).toBeGreaterThan(insertBox.x);
});

test("reveals import and screenshot actions when hovering the final image slot", async ({ page }) => {
  await openCanvas(page);

  const finalSlot = page.getByTestId("image-add-slot").last();
  await finalSlot.scrollIntoViewIfNeeded();
  const actions = finalSlot.getByTestId("image-action-buttons");
  await finalSlot.hover();

  await expect
    .poll(() => actions.evaluate((element) => getComputedStyle(element).opacity))
    .toBe("1");
  await expect(finalSlot.getByRole("button", { name: "添加参考图" })).toBeVisible();
  await expect(finalSlot.getByRole("button", { name: "截图" })).toBeVisible();
});

test("exposes all four component-edge resize handles", async ({ page }) => {
  await openCanvas(page);

  const frame = page.locator(`${FRAME}[data-component-id="plan-1"]`);
  for (const [edge, label] of [
    ["left", "调整组件左侧"],
    ["right", "调整组件右侧"],
    ["top", "调整组件顶部"],
    ["bottom", "调整组件底部"],
  ]) {
    const handle = frame.locator(`[data-resize="${edge}"]`);
    await expect(handle).toHaveAttribute("aria-label", label);
    await expect(handle).toHaveAttribute("role", "separator");
  }
});

test("resizes one image independently and resets it to the group default", async ({ page }) => {
  await openCanvas(page);

  const tile = page.locator('[data-image-id="img-1"]');
  const handle = tile.locator('[data-image-resize-handle="bottom"]');
  await handle.scrollIntoViewIfNeeded();
  const handleBox = await handle.boundingBox();
  if (!handleBox) {
    throw new Error("image resize handle is not visible");
  }

  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY - 30, { steps: 6 });
  await page.mouse.up();

  const reset = tile.getByRole("button", { name: "恢复默认图片尺寸" });
  await expect(reset).toBeVisible();
  await tile.hover();
  await reset.click();
  await expect(reset).toHaveCount(0);
});

test("hides only the group description while the independent caption editor remains available", async ({ page }) => {
  await openCanvas(page);

  const reference = page.locator(`${FRAME}[data-component-id="ref-1"]`);
  const description = reference.getByRole("group", { name: "分组描述" });
  const tile = reference.locator('[data-image-id="img-1"]');
  const caption = tile.getByRole("textbox", { name: "图片说明 1" });

  await tile.hover();
  await caption.fill("独立拍摄说明");
  await expect(caption).toHaveValue("独立拍摄说明");
  await reference.getByRole("checkbox", { name: "隐藏" }).check();

  await expect(description).toHaveCount(0);
  await expect(caption).toHaveValue("独立拍摄说明");
});

test("imports a browser screen capture through the reference toolbar", async ({ page }) => {
  await openCanvas(page);

  const reference = page.locator(`${FRAME}[data-component-id="ref-1"]`);
  const before = await reference.locator("[data-image-id]").count();
  await reference.getByRole("button", { name: "截图" }).first().click();

  await expect(reference.locator("[data-image-id]")).toHaveCount(before + 1, {
    timeout: 10_000,
  });
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("exports the seeded v6 canvas without a user-visible error", async ({ page }) => {
  await openCanvas(page);

  await page.getByRole("button", { name: "导出 PDF" }).click();
  await expect(page.getByRole("button", { name: "正在导出…" })).toBeVisible();
  await expect(page.getByRole("button", { name: "导出 PDF" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("alert")).toHaveCount(0);
});
