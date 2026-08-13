import { expect, test } from "@playwright/test";

test("auto-opens the most recently edited project into the workspace", async ({ page }) => {
  await page.goto("/");

  const nav = page.getByRole("navigation", { name: "项目" });
  await expect(
    nav.getByRole("button", { name: "打开项目 编辑大片示例" }),
  ).toHaveAttribute("aria-current", "page");

  // Assert the canvas is rendered (not the old plan panel)
  await expect(page.getByTestId("plan-document-canvas")).toBeVisible();
});
