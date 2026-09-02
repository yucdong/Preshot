import { expect, test, type Page } from "@playwright/test";

const ARTIFACT_ROOT = "artifacts/agent-basic-regressions";

async function configureAgent(page: Page) {
  await page.getByRole("button", { name: "显示助手面板" }).click();
  const assistant = page.getByRole("complementary", { name: "助手" });
  await assistant.getByRole("button", { name: "打开模型设置" }).click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await settings.getByRole("button", { name: "测试连接" }).click();
  await expect(settings.getByLabel("模型", { exact: true }))
    .toHaveValue("preshot-text");
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    const bridge = window.__PRESHOT_AGENT_TEST__;
    if (!bridge) throw new Error("Agent E2E bridge is unavailable");
    await bridge.createSession("Responsive validation");
    await bridge.draftTextProposal("Responsive proposal text");
  });
  await assistant.getByRole("button", { name: "审阅更改" }).click();
  return assistant;
}

async function setAssistantWidth(page: Page, target: number) {
  const splitter = page.getByRole("separator", { name: "调整助手栏宽度" });
  await splitter.focus();
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const current = Number(await splitter.getAttribute("aria-valuenow"));
    if (current === target) return;
    await splitter.press(current < target ? "ArrowLeft" : "ArrowRight");
  }
  throw new Error(`Assistant width did not reach ${target}`);
}

test("validates exact assistant widths, proposal stacking, themes, and focus mode", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("complementary", { name: "助手" })).toHaveCount(0);
  const assistant = await configureAgent(page);

  const widths = [240, 272, 320, 420] as const;
  const measurements: Array<Record<string, unknown>> = [];
  for (const width of widths) {
    await setAssistantWidth(page, width);
    const panel = await assistant.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    const actionColumns = await page.locator(".agent-proposal-actions")
      .evaluate((element) =>
        getComputedStyle(element).gridTemplateColumns.split(" ").length
      );
    expect(Math.round(panel.width)).toBe(width);
    expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1);
    expect(actionColumns).toBe(width < 320 ? 1 : 2);
    measurements.push({ target: width, ...panel, actionColumns });
    await page.screenshot({
      path: `${ARTIFACT_ROOT}/assistant-${width}.png`,
      fullPage: true,
    });
  }

  await page.locator("header").getByRole("button", { name: "设置" }).click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await settings.getByRole("button", { name: /深色/ }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: `${ARTIFACT_ROOT}/assistant-dark-420.png`,
    fullPage: true,
  });

  await page.getByRole("button", { name: "进入专注模式" }).click();
  await expect(page.getByTestId("resizable-workspace"))
    .toHaveAttribute("data-focus-mode", "true");
  await page.getByRole("button", { name: "打开助手面板" }).click();
  await expect(page.getByRole("complementary", { name: "助手" })).toBeVisible();
  await page.screenshot({
    path: `${ARTIFACT_ROOT}/assistant-focus-mode.png`,
    fullPage: true,
  });

  await page.evaluate((value) => {
    localStorage.setItem("agent-responsive-measurements", JSON.stringify(value));
  }, measurements);
  expect(measurements).toHaveLength(4);
});

test("honors reduced motion and forced colors", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
    forcedColors: "active",
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:1425/", {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("button", { name: "显示助手面板" }).click();
  const button = page.getByRole("complementary", { name: "助手" })
    .getByRole("button", { name: "打开模型设置" });
  await expect(button).toBeVisible();
  await button.focus();
  const computed = await button.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      transitionDuration: style.transitionDuration,
      borderStyle: style.borderStyle,
      borderWidth: style.borderWidth,
    };
  });
  expect(Number.parseFloat(computed.transitionDuration)).toBeLessThanOrEqual(
    0.00001,
  );
  expect(computed.borderStyle).not.toBe("none");
  expect(Number.parseFloat(computed.borderWidth)).toBeGreaterThanOrEqual(1);
  await page.screenshot({
    path: `${ARTIFACT_ROOT}/assistant-forced-colors.png`,
    fullPage: true,
  });
  await context.close();
});
