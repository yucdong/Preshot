import { expect, test } from "@playwright/test";

test("keeps the sidebar project actions fixed while the plan is tall", async ({ page }) => {
  await page.goto("/");
  const newProject = page.getByRole("button", { name: "New project", exact: true });
  await expect(newProject).toBeVisible();

  // Grow the plan so its content exceeds the viewport height and the middle panel
  // must scroll internally (rather than the whole page).
  for (let i = 0; i < 6; i++) {
    await page.getByRole("button", { name: "Add reference group" }).click();
  }

  const before = await newProject.boundingBox();

  // The window itself must not scroll — only the middle plan panel scrolls — so the
  // New/Open project actions stay pinned in the sidebar.
  await page.evaluate(() => window.scrollTo(0, 5000));
  await page.waitForTimeout(100);

  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const after = await newProject.boundingBox();
  expect(after?.y).toBeCloseTo(before?.y ?? -1, 0);
  await expect(newProject).toBeVisible();
  await expect(page.getByRole("button", { name: "Open project", exact: true })).toBeVisible();
});
