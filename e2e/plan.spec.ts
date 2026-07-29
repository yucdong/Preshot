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
