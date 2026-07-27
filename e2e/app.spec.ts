import { expect, test } from "@playwright/test";

test("opens the photography planning workspace", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Preshot" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Planning tools" }),
  ).toBeVisible();
  await expect(page.getByText("Start your photography plan")).toBeVisible();
});
