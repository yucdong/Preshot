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
