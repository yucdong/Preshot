import "dotenv/config";
import { PlaywrightAgent } from "@midscene/web/playwright";
import { chromium } from "playwright";

const targetUrl = process.env.MIDSCENE_SMOKE_URL ?? "http://127.0.0.1:1420";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
let agent;

try {
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  agent = new PlaywrightAgent(page, {
    aiActionContext: "You are a Web UI testing expert who is familiar with Chinese interfaces.",
    groupName: "Preshot Midscene Environment Smoke",
    reportFileName: "preshot-environment-smoke.html",
  });
  await agent.aiAct("确认页面顶部显示 PRESHOT 品牌，并且主画布中可以看到文案卡片。不要修改页面内容。");
  console.log(`Midscene aiAct smoke passed: ${targetUrl}`);
} finally {
  await agent?.destroy();
  await browser.close();
}
