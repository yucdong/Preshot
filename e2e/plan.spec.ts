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
