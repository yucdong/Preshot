import { expect, test, type Page } from "@playwright/test";

async function componentOrder(page: Page) {
  return page.locator('[data-component-frame="true"]').evaluateAll((elements) =>
    elements.map((element) => (element as HTMLElement).dataset.componentId ?? ""),
  );
}

async function imageRowTops(frame: ReturnType<Page["locator"]>) {
  return frame.locator('[data-testid="image-region"]').evaluateAll((elements) => {
    const tops = elements.map((element) => Math.round((element as HTMLElement).getBoundingClientRect().top));
    return Array.from(new Set(tops)).sort((a, b) => a - b);
  });
}

test("plan card grows with text and avoids a large fixed blank area", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改");
  await expect(page.locator('[data-component-frame="true"]')).toHaveCount(2);

  const frame = page.locator('[data-component-frame="true"]').first();
  const frameBody = frame.locator("[data-component-frame-body]");
  const editorRoot = frame.getByRole("group", { name: "摄影计划" });
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
      return frameBody.evaluate((body) => {
        const bodyRect = body.getBoundingClientRect();
        const editorRect = body.querySelector('[role="group"]')?.getBoundingClientRect();
        const contentRect = body.querySelector('[contenteditable="true"]')?.getBoundingClientRect();
        if (!editorRect || !contentRect) {
          return false;
        }
        return [editorRect, contentRect].every(
          (rect) =>
            rect.top >= bodyRect.top - 1 &&
            rect.bottom <= bodyRect.bottom + 1,
        );
      });
    })
    .toBe(true);
  await expect(editorRoot).toBeVisible();
});

test("reference images wrap proportionally without an internal scrollbar", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-component-frame="true"]')).toHaveCount(2);

  const reference = page.locator('[data-component-frame="true"]').nth(1);
  const body = reference.getByTestId("reference-component-body");
  const images = reference.getByRole("img", { name: "参考图" });

  await reference.scrollIntoViewIfNeeded();
  await expect(images).toHaveCount(4);
  await expect(body).not.toHaveCSS("overflow-y", "auto");
  await expect(body).not.toHaveCSS("overflow-y", "scroll");

  const rowTops = await imageRowTops(reference);
  expect(rowTops.length).toBeGreaterThanOrEqual(2);

  const bodyMetrics = await body.evaluate((element) => {
    const node = element as HTMLElement;
    const tiles = Array.from(node.querySelectorAll('[data-testid="image-region"]')).map((tile) => {
      const rect = (tile as HTMLElement).getBoundingClientRect();
      const bodyRect = node.getBoundingClientRect();
      return { top: rect.top - bodyRect.top, bottom: rect.bottom - bodyRect.top };
    });

    return {
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      overflowY: window.getComputedStyle(node).overflowY,
      maxTileBottom: Math.max(...tiles.map((tile) => tile.bottom)),
    };
  });

  expect(Math.ceil(bodyMetrics.maxTileBottom)).toBeLessThanOrEqual(bodyMetrics.clientHeight + 1);
  expect(bodyMetrics.scrollHeight).toBeLessThanOrEqual(bodyMetrics.clientHeight + 1);
  expect(["auto", "scroll"]).not.toContain(bodyMetrics.overflowY);

  const containment = await reference.evaluate((frame) => {
    const frameRect = frame.getBoundingClientRect();
    const body = frame.querySelector('[data-testid="reference-component-body"]');
    if (!(body instanceof HTMLElement)) {
      return { bodyInside: false, tilesInside: false };
    }
    const bodyRect = body.getBoundingClientRect();
    const tiles = Array.from(
      body.querySelectorAll('[data-image-id], button[aria-label="添加参考图"]'),
    ).map((element) => element.getBoundingClientRect());
    const inside = (rect: DOMRect) =>
      rect.left >= frameRect.left - 1 &&
      rect.right <= frameRect.right + 1 &&
      rect.top >= frameRect.top - 1 &&
      rect.bottom <= frameRect.bottom + 1;

    return {
      bodyInside: inside(bodyRect),
      itemCount: tiles.length,
      tilesInside: tiles.every(inside),
    };
  });

  expect(containment.bodyInside).toBe(true);
  expect(containment.itemCount).toBe(5);
  expect(containment.tilesInside).toBe(true);
});

test("component drag shows a live placeholder, shows the overlay, and commits the reordered layout", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改");
  await expect(page.locator('[data-component-frame="true"]')).toHaveCount(2);

  const frames = page.locator('[data-component-frame="true"]');
  const handle = frames.first().locator("[data-component-frame-topbar]");
  const target = frames.nth(1);
  const before = await componentOrder(page);
  const draggedId = before[0];
  const targetId = before[1];
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

  await expect(page.locator('[data-drag-placeholder="component"]')).toHaveCount(0);
  await expect(page.getByTestId("drag-overlay-preview")).toHaveCount(0);
  await expect(page.getByTestId("save-status")).toHaveText("有未保存的更改");

  await expect.poll(() => componentOrder(page)).toEqual([targetId, draggedId]);
  await expect.poll(() => componentOrder(page)).toEqual([targetId, draggedId]);
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改", { timeout: 10_000 });
  await expect.poll(() => componentOrder(page)).toEqual([targetId, draggedId]);

  const committed = await componentOrder(page);
  expect([...committed].sort()).toEqual([...before].sort());
  expect(new Set(committed)).toEqual(new Set(before));
  expect(committed.indexOf(draggedId)).toBeGreaterThan(committed.indexOf(targetId));
  expect(committed).toEqual([targetId, draggedId]);
});
