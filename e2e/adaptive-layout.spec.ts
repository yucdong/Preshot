import { expect, test, type Page } from "@playwright/test";

async function componentOrder(page: Page) {
  return page.locator('[data-component-frame="true"]').evaluateAll((elements) =>
    elements.map((element) => (element as HTMLElement).dataset.componentId ?? ""),
  );
}

test("plan card grows with text and avoids a large fixed blank area", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改");
  await expect(page.locator('[data-component-frame="true"]')).toHaveCount(2);

  const frame = page.locator('[data-component-frame="true"]').first();
  const editor = frame.locator('[contenteditable="true"]').first();
  const before = await frame.boundingBox();

  if (!before) {
    throw new Error("plan frame not visible");
  }

  await editor.click();
  await page.keyboard.type("\n第一行\n第二行\n第三行\n第四行");

  await expect
    .poll(async () => (await frame.boundingBox())?.height ?? 0)
    .toBeGreaterThan(before.height);

  await expect
    .poll(async () => {
      const box = await frame.boundingBox();
      const editorHeight = await editor.evaluate((node) => (node as HTMLElement).scrollHeight);
      return box == null ? Number.POSITIVE_INFINITY : box.height - editorHeight;
    })
    .toBeLessThan(120);
});

test("reference images wrap proportionally without an internal scrollbar", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-component-frame="true"]')).toHaveCount(2);

  const reference = page.locator('[data-component-frame="true"]').nth(1);
  const body = reference.getByTestId("reference-component-body");
  const landscape = reference.getByRole("img", { name: "参考图" }).first();
  const portrait = reference.getByRole("img", { name: "参考图" }).nth(1);

  await reference.scrollIntoViewIfNeeded();
  await expect(body).not.toHaveCSS("overflow-y", "auto");
  await expect(reference.getByRole("img", { name: "参考图" })).toHaveCount(2);

  const landscapeBox = await landscape.boundingBox();
  const portraitBox = await portrait.boundingBox();

  if (!landscapeBox || !portraitBox) {
    throw new Error("seeded reference images not visible");
  }

  expect(landscapeBox.width).toBeGreaterThan(portraitBox.width);
});

test("component drag shows a live placeholder, shows the overlay, and commits the reordered layout", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改");
  await expect(page.locator('[data-component-frame="true"]')).toHaveCount(2);

  const frames = page.locator('[data-component-frame="true"]');
  const handle = frames.first().locator("[data-component-frame-topbar]");
  const target = frames.nth(1);
  const before = await componentOrder(page);
  const handleBox = await handle.boundingBox();
  const targetBox = await target.boundingBox();

  if (!handleBox || !targetBox) {
    throw new Error("component drag targets are not visible");
  }

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(200);
  await page.mouse.move(handleBox.x + handleBox.width / 2 + 12, handleBox.y + handleBox.height / 2, { steps: 3 });
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height * 0.75, { steps: 8 });

  await expect(page.locator('[data-drag-placeholder="component"]')).toBeVisible();
  await expect(page.getByTestId("drag-overlay-preview")).toBeVisible();

  await page.mouse.up();

  await expect
    .poll(() => componentOrder(page))
    .not.toEqual(before);
});
