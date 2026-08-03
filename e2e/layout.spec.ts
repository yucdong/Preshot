import { expect, test } from "@playwright/test";

test("keeps the sidebar project actions fixed while the canvas is tall", async ({ page }) => {
  await page.goto("/");
  const newProject = page.getByRole("button", { name: "新建项目", exact: true });
  await expect(newProject).toBeVisible();

  // Grow the canvas so its content exceeds the viewport height and the middle panel
  // must scroll internally (rather than the whole page).
  for (let i = 0; i < 6; i++) {
    await page.getByRole("button", { name: "插入组件" }).click();
    await page.getByRole("menuitem", { name: "参考图组" }).click();
  }

  const before = await newProject.boundingBox();

  // The window itself must not scroll — only the middle canvas panel scrolls — so the
  // New/Open project actions stay pinned in the sidebar.
  await page.evaluate(() => window.scrollTo(0, 5000));
  await page.waitForTimeout(100);

  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const after = await newProject.boundingBox();
  expect(after?.y).toBeCloseTo(before?.y ?? -1, 0);
  await expect(newProject).toBeVisible();
  await expect(page.getByRole("button", { name: "打开项目", exact: true })).toBeVisible();
});

test("scrolls the middle canvas panel to reach components below the fold", async ({ page }) => {
  await page.goto("/");

  // Add enough components that the canvas overflows the panel height.
  for (let i = 0; i < 8; i++) {
    await page.getByRole("button", { name: "插入组件" }).click();
    await page.getByRole("menuitem", { name: "参考图组" }).click();
  }

  // The canvas panel itself must be the scroll container (not clipped by the shell).
  // The structure is: div.flex.h-full.flex-col > div.flex-1.overflow-auto
  const scroller = page.locator('div.flex-1.overflow-auto.bg-stone-100');
  const metrics = await scroller.evaluate((el) => ({
    scrollH: el.scrollHeight,
    clientH: el.clientHeight,
  }));
  expect(metrics.scrollH).toBeGreaterThan(metrics.clientH);

  // Scrolling the panel must reveal the last canvas page (below the fold initially).
  await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await page.waitForTimeout(150);
  const lastPage = page.getByTestId("canvas-page").last();
  await expect(lastPage).toBeInViewport();
});
