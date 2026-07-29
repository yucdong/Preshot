import { expect, test } from "@playwright/test";

test("opens a project and browses reference images", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open project Editorial Demo" }).click();

  const group = page.getByRole("group", { name: "Reference group: Lookbook" });
  await expect(group.getByRole("img", { name: "Reference image 1" })).toBeVisible();

  await group.getByRole("button", { name: "Open reference image 1" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close image" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
});
