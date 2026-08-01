import { expect, test } from "@playwright/test";

test("browses reference images in the auto-opened project", async ({ page }) => {
  await page.goto("/");

  const group = page.getByRole("group", { name: "Reference group: Lookbook" });
  await expect(group.getByRole("img", { name: "Reference image 1" })).toBeVisible();

  await group.getByRole("button", { name: "Open reference image 1" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close image" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("exports the plan to a pdf", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Export PDF" }).click();
  await expect(page.getByRole("button", { name: "Exporting…" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export PDF" })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("edits the photography plan with the block editor", async ({ page }) => {
  await page.goto("/");

  // Wait for the seeded plan body to hydrate before checking the save state, so the
  // assertion reflects a fully loaded editor rather than the default first-paint state.
  await expect(page.getByText("Golden hour on the waterfront. Bring the 85mm.")).toBeVisible();

  const saveStatus = page.getByTestId("save-status");
  // Opening a project must stay clean: hydrating the editor from stored HTML must not
  // emit normalized (lossy) HTML that flips the plan to unsaved (the critical fix). The
  // timeout stays under the 5s auto-save interval so a buggy dirty flip is caught before
  // auto-save could re-save and mask it back to "All changes saved".
  await expect(saveStatus).toHaveText("All changes saved", { timeout: 3000 });

  const editor = page.getByRole("group", { name: "Photography plan" }).locator("[contenteditable='true']");
  await editor.click();
  await page.keyboard.type("Sunrise call time 5am");
  await expect(page.getByText("Sunrise call time 5am")).toBeVisible();
  // A genuine edit must still propagate, so the provider marks the plan unsaved.
  await expect(saveStatus).toHaveText("Unsaved changes");
});

test("reorders a reference image by dragging and commits the move", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("save-status")).toHaveText("All changes saved");

  const group = page.getByRole("group", { name: "Reference group: Lookbook" });
  const first = group.getByRole("button", { name: "Open reference image 1" });
  const second = group.getByRole("button", { name: "Open reference image 2" });

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
  await expect(page.getByTestId("save-status")).toHaveText("Unsaved changes", { timeout: 3000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("drags a reference image into a newly-added empty group", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("save-status")).toHaveText("All changes saved");

  // Add a new empty reference group
  await page.getByRole("button", { name: "Add reference group" }).click();

  const sourceGroup = page.getByRole("group", { name: "Reference group: Lookbook" });
  const targetGroup = page.getByRole("group", { name: "Reference group: New group" });
  const tile = sourceGroup.getByRole("button", { name: "Open reference image 1" });
  const slot = targetGroup.getByRole("button", { name: "Add reference image" });

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
  await expect(page.getByTestId("save-status")).toHaveText("Unsaved changes", { timeout: 3000 });
  await expect(targetGroup.getByRole("button", { name: "Open reference image 1" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
