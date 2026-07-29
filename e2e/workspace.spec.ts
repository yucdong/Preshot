import { expect, test } from "@playwright/test";

test("auto-opens the most recently edited project into the workspace", async ({ page }) => {
  await page.goto("/");

  const nav = page.getByRole("navigation", { name: "Projects" });
  await expect(
    nav.getByRole("button", { name: "Open project Editorial Demo" }),
  ).toHaveAttribute("aria-current", "page");

  await expect(
    page.getByRole("button", { name: "Add reference group" }),
  ).toBeVisible();
});
