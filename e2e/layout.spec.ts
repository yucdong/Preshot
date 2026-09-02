import { expect, test } from "@playwright/test";

async function insertImageGroup(page: import("@playwright/test").Page) {
  const editor = page.locator(".bn-editor");
  await editor.locator("p").last().click();
  await page.keyboard.type("/");
  await page.locator(".bn-mt-suggestion-menu-item-title", {
    hasText: "图片组",
  }).click();
}

test("keeps the default project panel actions fixed while the canvas is tall", async ({ page }) => {
  await page.goto("/");
  const newProject = page.getByRole("button", { name: "新建项目", exact: true });
  await expect(newProject).toBeVisible();
  const before = await newProject.boundingBox();

  // Grow the canvas so its content exceeds the viewport height and the middle panel
  // must scroll internally (rather than the whole page).
  for (let i = 0; i < 6; i++) {
    await insertImageGroup(page);
  }

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
    await insertImageGroup(page);
  }

  // The canvas panel itself must be the scroll container (not clipped by the shell).
  const scroller = page.getByTestId("canvas-scroller");
  const metrics = await scroller.evaluate((el) => ({
    scrollH: el.scrollHeight,
    clientH: el.clientHeight,
  }));
  expect(metrics.scrollH).toBeGreaterThan(metrics.clientH);

  // Scrolling the panel must reveal the last BlockNote image-group block.
  await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await page.waitForTimeout(150);
  const lastGroup = page.locator(".preshot-blocknote-image-group").last();
  await expect(lastGroup).toBeInViewport();
});

test("resizes side panels and restores defaults by double click", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("plan-document-canvas")).toBeVisible();
  await page.getByRole("button", { name: "显示助手面板" }).click();

  const projectSplitter = page.getByRole("separator", { name: "调整项目栏宽度" });
  const assistantSplitter = page.getByRole("separator", { name: "调整助手栏宽度" });
  const workspace = page.getByTestId("resizable-workspace");
  const projectBefore = Number(await projectSplitter.getAttribute("aria-valuenow"));
  const assistantBefore = Number(await assistantSplitter.getAttribute("aria-valuenow"));
  const projectBox = await projectSplitter.boundingBox();
  const assistantBox = await assistantSplitter.boundingBox();
  if (!projectBox || !assistantBox) {
    throw new Error("panel splitters are not visible");
  }

  await page.mouse.move(projectBox.x + projectBox.width / 2, projectBox.y + 120);
  await page.mouse.down();
  await page.mouse.move(projectBox.x + 42, projectBox.y + 120, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Number(await projectSplitter.getAttribute("aria-valuenow")))
    .toBeGreaterThan(projectBefore + 30);

  await page.mouse.move(assistantBox.x + assistantBox.width / 2, assistantBox.y + 120);
  await page.mouse.down();
  await page.mouse.move(assistantBox.x - 36, assistantBox.y + 120, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Number(await assistantSplitter.getAttribute("aria-valuenow")))
    .toBeGreaterThan(assistantBefore + 25);
  expect(await workspace.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);

  await projectSplitter.dblclick();
  await assistantSplitter.dblclick();
  await expect(projectSplitter).toHaveAttribute("aria-valuenow", "192");
  await expect(assistantSplitter).toHaveAttribute("aria-valuenow", "272");
});
