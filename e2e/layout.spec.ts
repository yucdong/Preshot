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

test("scrolls the middle plan panel to reach groups below the fold", async ({ page }) => {
  await page.goto("/");

  // Add enough reference groups that the plan overflows the panel height.
  for (let i = 0; i < 8; i++) {
    await page.getByRole("button", { name: "Add reference group" }).click();
  }

  // The plan panel itself must be the scroll container (not clipped by the shell).
  const scroller = page.locator('section[aria-label="Plan"] > div.overflow-y-auto');
  const metrics = await scroller.evaluate((el) => ({
    scrollH: el.scrollHeight,
    clientH: el.clientHeight,
  }));
  expect(metrics.scrollH).toBeGreaterThan(metrics.clientH);

  // Scrolling the panel must reveal the last group (below the fold initially).
  await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await page.waitForTimeout(150);
  const lastGroup = page.getByRole("group", { name: "Reference group: New group" }).last();
  await expect(lastGroup.getByRole("button", { name: "Add reference image" })).toBeInViewport();
});
