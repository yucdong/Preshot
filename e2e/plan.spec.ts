import { expect, test } from "@playwright/test";

test("browses reference images in the auto-opened project", async ({ page }) => {
  await page.goto("/");

  const group = page.getByRole("group", { name: "参考分组：造型参考" });
  await expect(group.getByRole("img", { name: "参考图" }).first()).toBeVisible();

  await group.getByRole("button", { name: "打开参考图 1" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "关闭图片" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("exports the plan to a pdf", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "导出 PDF" }).click();
  await expect(page.getByRole("button", { name: "正在导出…" })).toBeVisible();
  await expect(page.getByRole("button", { name: "导出 PDF" })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("edits the photography plan with the block editor", async ({ page }) => {
  await page.goto("/");

  // Wait for the seeded plan body to hydrate before checking the save state, so the
  // assertion reflects a fully loaded editor rather than the default first-paint state.
  await expect(page.getByText("海滨的黄金时刻。记得带 85mm 镜头。")).toBeVisible();

  const saveStatus = page.getByTestId("save-status");
  // Opening a project must stay clean: hydrating the editor from stored HTML must not
  // emit normalized (lossy) HTML that flips the plan to unsaved (the critical fix). The
  // timeout stays under the 5s auto-save interval so a buggy dirty flip is caught before
  // auto-save could re-save and mask it back to "已保存所有更改".
  await expect(saveStatus).toHaveText("已保存所有更改", { timeout: 3000 });

  const editor = page.getByRole("group", { name: "摄影计划" }).locator("[contenteditable='true']");
  await editor.click();
  await page.keyboard.type("Sunrise call time 5am");
  await expect(page.getByText("Sunrise call time 5am")).toBeVisible();
  // A genuine edit must still propagate, so the provider marks the plan unsaved.
  await expect(saveStatus).toHaveText("有未保存的更改");
});

test("reorders a reference image by dragging and commits the move", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改");

  const group = page.getByRole("group", { name: "参考分组：造型参考" });
  const first = group.getByRole("button", { name: "打开参考图 1" });
  const second = group.getByRole("button", { name: "打开参考图 2" });

  const from = await first.boundingBox();
  const to = await second.boundingBox();
  if (!from || !to) throw new Error("reference tiles not visible");

  // dnd-kit PointerSensor needs movement > 6px and intermediate moves to start a drag.
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2, { steps: 3 });
  await page.mouse.move(to.x + to.width * 0.75, to.y + to.height / 2, { steps: 6 });
  await page.mouse.up();

  // A committed move flips the plan to unsaved (auto-save handles persistence).
  await expect(page.getByTestId("save-status")).toHaveText("有未保存的更改", { timeout: 3000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("commits a reorder from a partial overlap (no need to fully cover the tile)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改");

  const group = page.getByRole("group", { name: "参考分组：造型参考" });
  const first = group.getByRole("button", { name: "打开参考图 1" });
  const second = group.getByRole("button", { name: "打开参考图 2" });

  const from = await first.boundingBox();
  const to = await second.boundingBox();
  if (!from || !to) throw new Error("reference tiles not visible");

  // Release just inside the second tile's left edge — a partial overlap that is well
  // short of its centre. The dragged image overlaps the second tile most, so the
  // largest-intersection collision + array-move commits the swap without the pointer
  // having to travel past the tile centre.
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2, { steps: 3 });
  await page.mouse.move(to.x + 12, to.y + to.height / 2, { steps: 6 });
  await page.mouse.up();

  await expect(page.getByTestId("save-status")).toHaveText("有未保存的更改", { timeout: 3000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("drags a reference image into a newly-added empty group", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改");

  // Add a new empty reference group
  await page.getByRole("button", { name: "添加参考分组" }).click();

  const sourceGroup = page.getByRole("group", { name: "参考分组：造型参考" });
  const targetGroup = page.getByRole("group", { name: "参考分组：新建分组" });
  const tile = sourceGroup.getByRole("button", { name: "打开参考图 1" });
  const slot = targetGroup.getByRole("button", { name: "添加参考图" });

  const from = await tile.boundingBox();
  const drop = await slot.boundingBox();
  if (!from || !drop) throw new Error("drag elements not visible");

  // dnd-kit PointerSensor needs movement > 6px and intermediate moves to start a drag.
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2, { steps: 3 });
  // Release on the empty group's slot — where the previewed tile lands and where a
  // user naturally drops (the dragged tile then sits under the pointer).
  await page.mouse.move(drop.x + drop.width / 2, drop.y + drop.height / 2, { steps: 8 });
  await page.mouse.up();

  // Assert the cross-group move committed
  await expect(page.getByTestId("save-status")).toHaveText("有未保存的更改", { timeout: 3000 });
  await expect(targetGroup.getByRole("button", { name: "打开参考图 1" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("drops an image onto an empty group's slot even next to a large group", async ({ page }) => {
  // A tall viewport keeps the source tile and the empty target visible without
  // scrolling; the point of this test is the collision target, not auto-scroll.
  await page.setViewportSize({ width: 1280, height: 2200 });
  await page.goto("/");
  await expect(page.getByTestId("save-status")).toHaveText("已保存所有更改");

  // Layout: 造型参考 (source) / empty target group / large neighbour group below it.
  await page.getByRole("button", { name: "添加参考分组" }).click();
  await page.getByRole("button", { name: "添加参考分组" }).click();
  const targetGroup = page.getByRole("group", { name: "参考分组：新建分组" }).nth(0);
  const neighbour = page.getByRole("group", { name: "参考分组：新建分组" }).nth(1);
  for (let i = 0; i < 8; i++) {
    await neighbour.getByRole("button", { name: "添加参考图" }).click();
  }

  const sourceGroup = page.getByRole("group", { name: "参考分组：造型参考" });
  const tile = sourceGroup.getByRole("button", { name: "打开参考图 1" });
  const slot = targetGroup.getByRole("button", { name: "添加参考图" });
  const from = await tile.boundingBox();
  const drop = await slot.boundingBox();
  if (!from || !drop) throw new Error("drag elements not visible");

  // Release on the empty group's "+" slot — the pointer-within collision must
  // target that group, not the larger neighbour below.
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2, { steps: 3 });
  await page.mouse.move(drop.x + drop.width / 2, drop.y + drop.height / 2, { steps: 10 });
  await page.mouse.up();

  await expect(page.getByTestId("save-status")).toHaveText("有未保存的更改", { timeout: 3000 });
  await expect(targetGroup.getByRole("button", { name: "打开参考图 1" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
