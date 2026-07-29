import { expect, test } from "@playwright/test";

test("opens a recent project from the launcher", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Recent projects" }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Open project Editorial Demo" })
    .click();

  await expect(page.getByText("Editorial Demo")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add reference group" })).toBeVisible();
});
